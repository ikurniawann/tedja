import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import {
  isValidNormalizedPhone,
  normalizePhone,
  renderWaTemplate,
  requireSalesFunnelRole,
} from "@/lib/sales-funnel/server";
import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";

const sendWaSchema = z
  .object({
    template_id: z.string().uuid().optional().nullable(),
    message: z.string().trim().max(2000).optional().nullable(),
  })
  .refine((v) => v.template_id || v.message, {
    message: "Pilih template atau tulis pesan",
  });

const EVENT_LABELS: Record<string, string> = {
  gathering: "gathering",
  "field-trip": "field trip",
  "ulang-tahun": "acara ulang tahun",
  "buyout-venue": "buyout venue",
  lainnya: "acara",
};

/**
 * Kirim cepat WA ke PIC deal via gateway (EPIC-022 Fase C). Pesan yang
 * terkirim otomatis dicatat sebagai aktivitas tipe `wa` yang selesai —
 * timeline deal jadi jejak komunikasi.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const { id } = await params;
    const { deal, forbidden } = await findAccessibleDeal(id, user);
    if (forbidden) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    if (!deal) {
      return NextResponse.json(
        { success: false, error: "Deal tidak ditemukan" },
        { status: 404 }
      );
    }

    const parsed = sendWaSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const config = await loadGatewayConfig();
    if (!config) {
      return NextResponse.json(
        { success: false, error: "WA gateway belum dikonfigurasi" },
        { status: 503 }
      );
    }

    // Rem anti-spam: gateway = satu nomor WA bersama seluruh platform,
    // hujan pesan ke satu PIC berisiko banned. Maks 1 kirim per deal / 60 dtk.
    const recentSend = await queryOne<{ id: string }>(
      `SELECT id FROM crm.crm_sales_activities
       WHERE deal_id = $1 AND activity_type = 'wa' AND deleted_at IS NULL
         AND created_at > now() - interval '60 seconds'
       LIMIT 1`,
      [id]
    );
    if (recentSend) {
      return NextResponse.json(
        {
          success: false,
          error: "Tunggu sebentar — pesan ke PIC deal ini baru saja dikirim",
        },
        { status: 429 }
      );
    }

    const context = await queryOne<{
      title: string;
      event_type: string;
      event_date: string | null;
      org_name: string;
      pic_name: string;
      pic_phone: string;
      venue_name: string | null;
    }>(
      `SELECT d.title, d.event_type, d.event_date,
              l.org_name, l.pic_name, l.pic_phone, b.name AS venue_name
       FROM crm.crm_sales_deals d
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
       LEFT JOIN configuration.branches b ON b.id = d.branch_id
       WHERE d.id = $1`,
      [id]
    );
    if (!context) {
      return NextResponse.json(
        { success: false, error: "Deal tidak ditemukan" },
        { status: 404 }
      );
    }

    let message = parsed.data.message?.trim() ?? "";
    if (parsed.data.template_id) {
      const template = await queryOne<{ body: string }>(
        `SELECT body FROM crm.crm_sales_wa_templates
         WHERE id = $1 AND is_active = true`,
        [parsed.data.template_id]
      );
      if (!template) {
        return NextResponse.json(
          { success: false, error: "Template tidak ditemukan" },
          { status: 404 }
        );
      }
      message = template.body;
    }

    message = renderWaTemplate(message, {
      pic: context.pic_name,
      instansi: context.org_name,
      acara: EVENT_LABELS[context.event_type] ?? "acara",
      tanggal_acara: context.event_date
        ? new Date(context.event_date).toLocaleDateString("id-ID", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : "",
      venue: context.venue_name,
    });
    if (!message) {
      return NextResponse.json(
        { success: false, error: "Pesan kosong setelah render template" },
        { status: 400 }
      );
    }

    // Guard defensif di titik kirim (pola watcher) — jangan percaya data lama
    const targetPhone = normalizePhone(context.pic_phone);
    if (!isValidNormalizedPhone(targetPhone)) {
      return NextResponse.json(
        { success: false, error: "No. WA PIC tidak valid" },
        { status: 400 }
      );
    }

    const result = await sendGatewayText(config, {
      target: targetPhone,
      message,
    });
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.reason ?? "Gagal mengirim WA" },
        { status: 502 }
      );
    }

    // Jejak komunikasi di timeline — aktivitas `wa` langsung selesai
    await queryOne(
      `INSERT INTO crm.crm_sales_activities
         (company_id, branch_id, deal_id, activity_type, notes, done_at,
          owner_user_id, created_by)
       VALUES ($1, $2, $3, 'wa', $4, now(), $5, $5)
       RETURNING id`,
      [
        deal.company_id,
        deal.branch_id,
        deal.id,
        `Kirim WA ke ${context.pic_name}: ${message.slice(0, 500)}`,
        user.id,
      ]
    );

    return successResponse(
      { message_id: result.messageId ?? null },
      `Pesan terkirim ke ${context.pic_name}`
    );
  } catch (err) {
    console.error("[sales-funnel] send wa error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mengirim WA" },
      { status: 500 }
    );
  }
}
