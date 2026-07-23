import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import {
  isValidNormalizedPhone,
  normalizePhone,
  requireSalesFunnelRole,
} from "@/lib/sales-funnel/server";
import { readGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";

function rupiah(value: number): string {
  return "Rp " + Math.round(value || 0).toLocaleString("id-ID");
}

function tanggal(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Kirim summary order quotation sebagai teks WA ke PIC (EPIC-022 Fase F2,
 * keputusan owner #4). Sukses kirim: status draft → terkirim + tercatat
 * sebagai aktivitas `wa` di timeline deal.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const { id } = await params;
    // Cek akses dgn fetch minimal DULU (pola findAccessibleQuotation)
    const ref = await queryOne<{ id: string; deal_id: string }>(
      `SELECT id, deal_id FROM crm.crm_sales_quotations
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!ref) {
      return NextResponse.json(
        { success: false, error: "Quotation tidak ditemukan" },
        { status: 404 }
      );
    }
    const { deal, forbidden } = await findAccessibleDeal(ref.deal_id, user);
    if (forbidden || !deal) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const quotation = await queryOne<{
      id: string;
      deal_id: string;
      quote_number: string;
      status: string;
      use_ppn: boolean;
      ppn_persen: string;
      subtotal: string;
      ppn_nominal: string;
      total: string;
      notes: string | null;
      valid_until: string | null;
      deal_title: string;
      event_date: string | null;
      org_name: string;
      pic_name: string;
      pic_phone: string;
      branch_name: string | null;
    }>(
      `SELECT q.id, q.deal_id, q.quote_number, q.status, q.use_ppn,
              q.ppn_persen, q.subtotal, q.ppn_nominal, q.total, q.notes,
              q.valid_until,
              d.title AS deal_title, d.event_date,
              l.org_name, l.pic_name, l.pic_phone, b.name AS branch_name
       FROM crm.crm_sales_quotations q
       JOIN crm.crm_sales_deals d ON d.id = q.deal_id
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
       LEFT JOIN configuration.branches b ON b.id = q.branch_id
       WHERE q.id = $1 AND q.deleted_at IS NULL`,
      [id]
    );
    if (!quotation) {
      return NextResponse.json(
        { success: false, error: "Quotation tidak ditemukan" },
        { status: 404 }
      );
    }

    const config = readGatewayConfig();
    if (!config) {
      return NextResponse.json(
        { success: false, error: "WA gateway belum dikonfigurasi" },
        { status: 503 }
      );
    }

    // Rem anti-spam sama dengan kirim cepat deal: 1 kirim per deal / 60 dtk
    const recentSend = await queryOne<{ id: string }>(
      `SELECT id FROM crm.crm_sales_activities
       WHERE deal_id = $1 AND activity_type = 'wa' AND deleted_at IS NULL
         AND created_at > now() - interval '60 seconds'
       LIMIT 1`,
      [quotation.deal_id]
    );
    if (recentSend) {
      return NextResponse.json(
        { success: false, error: "Tunggu sebentar — pesan ke PIC deal ini baru saja dikirim" },
        { status: 429 }
      );
    }

    const targetPhone = normalizePhone(quotation.pic_phone);
    if (!isValidNormalizedPhone(targetPhone)) {
      return NextResponse.json(
        { success: false, error: "No. WA PIC tidak valid" },
        { status: 400 }
      );
    }

    const items = await query<{
      description: string;
      item_type: string;
      qty: string;
      unit_price: string;
      line_total: string;
    }>(
      `SELECT description, item_type, qty, unit_price, line_total
       FROM crm.crm_sales_quotation_items
       WHERE quotation_id = $1 ORDER BY sort_order ASC`,
      [id]
    );

    const lines = [
      `*PENAWARAN ${quotation.quote_number}*`,
      quotation.branch_name ? `_${quotation.branch_name}_` : null,
      ``,
      `Halo ${quotation.pic_name}, berikut ringkasan penawaran untuk *${quotation.deal_title}* (${quotation.org_name}):`,
      ``,
      ...items.map((item) => {
        const qty = Number(item.qty).toLocaleString("id-ID");
        const unit = item.item_type === "produk" ? " pax" : "x";
        return `• ${item.description} — ${qty}${unit} @ ${rupiah(Number(item.unit_price))} = *${rupiah(Number(item.line_total))}*`;
      }),
      ``,
      `Subtotal: ${rupiah(Number(quotation.subtotal))}`,
      quotation.use_ppn
        ? `PPN ${Number(quotation.ppn_persen)}%: ${rupiah(Number(quotation.ppn_nominal))}`
        : null,
      `*TOTAL: ${rupiah(Number(quotation.total))}*`,
      ``,
      quotation.event_date ? `Tanggal acara: ${tanggal(quotation.event_date)}` : null,
      quotation.valid_until
        ? `Penawaran berlaku s.d. ${tanggal(quotation.valid_until)}`
        : null,
      quotation.notes ? `Catatan: ${quotation.notes}` : null,
      ``,
      `Bila sudah sesuai, mohon konfirmasinya ya 🙏`,
    ].filter((line) => line !== null);

    const result = await sendGatewayText(config, {
      target: targetPhone,
      message: lines.join("\n"),
    });
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.reason ?? "Gagal mengirim WA" },
        { status: 502 }
      );
    }

    // Jejak + transisi status dalam satu transaksi
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO crm.crm_sales_activities
           (company_id, branch_id, deal_id, activity_type, notes, done_at,
            owner_user_id, created_by)
         VALUES ($1, $2, $3, 'wa', $4, now(), $5, $5)`,
        [
          deal.company_id,
          deal.branch_id,
          deal.id,
          `Kirim quotation ${quotation.quote_number} (${rupiah(Number(quotation.total))}) ke ${quotation.pic_name}`,
          user.id,
        ]
      );
      if (quotation.status === "draft") {
        await client.query(
          `UPDATE crm.crm_sales_quotations
           SET status = 'terkirim', updated_at = now()
           WHERE id = $1 AND status = 'draft'`,
          [id]
        );
      }
    });

    return successResponse(
      { message_id: result.messageId ?? null },
      `Quotation terkirim ke ${quotation.pic_name}`
    );
  } catch (err) {
    console.error("[sales-funnel] send quotation wa error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mengirim quotation" },
      { status: 500 }
    );
  }
}
