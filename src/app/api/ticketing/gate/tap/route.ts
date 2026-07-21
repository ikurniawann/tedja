import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import type { PoolClient } from "pg";
import {
  TICKETING_OPERATOR_ROLES,
  isValidNfcUid,
  normalizeNfcUid,
  requireTicketingContext,
  type TicketingContext,
} from "@/lib/ticketing/server";
import {
  resolveVariantPriceOnDate,
  todayJakartaDate,
} from "@/lib/ticketing/pricing-server";
import { canCharge, computeTabSummary } from "@/lib/ticketing/tab";

const tapSchema = z.object({
  nfc_uid: z.string().trim().min(1).max(80),
  gate_label: z.string().trim().max(60).optional(),
});

export type GateTapResult =
  | "masuk"
  | "masuk-lagi"
  | "ditolak-gelang-tak-dikenal"
  | "ditolak-tanpa-kunjungan"
  | "ditolak-sudah-masuk"
  | "ditolak-saldo-kurang"
  | "ditolak-plafon"
  | "ditolak-tanpa-kanal"
  | "ditolak-harga-belum-diisi";

interface TapOutcome {
  result: GateTapResult;
  ok: boolean;
  reason?: string;
  contact_name?: string;
  ticket_type_name?: string;
  band_label?: string | null;
  charged_amount?: number;
}

async function logGateEvent(
  client: PoolClient,
  ctx: TicketingContext,
  input: {
    bandUid: string;
    bandId: string | null;
    visitId: string | null;
    gateLabel: string;
    result: GateTapResult;
  }
) {
  await client.query(
    `INSERT INTO ticketing.ticket_gate_events
       (company_id, branch_id, band_uid, band_id, visit_id, gate_label,
        result, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ctx.companyId,
      ctx.branchId,
      input.bandUid,
      input.bandId,
      input.visitId,
      input.gateLabel,
      input.result,
      ctx.user.id,
    ]
  );
}

/**
 * Tap gelang di gate. Tap pertama yang lolos guard men-charge tiket ke tab
 * (harga snapshot hasil resolve matriks hari ini); tap ulang mengikuti
 * kebijakan re-entry venue. Semua tap — diterima maupun ditolak — tercatat
 * di ticket_gate_events.
 */
export async function POST(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  // Gate men-tap terus-menerus — longgar tapi tetap berpagar
  const rate = checkRateLimit(`ticketing-gate:${ctx.user.id}`, 120);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak tap — tunggu sebentar" },
      { status: 429 }
    );
  }

  try {
    const parsed = tapSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const uid = normalizeNfcUid(parsed.data.nfc_uid);
    const gateLabel = parsed.data.gate_label?.trim() || "gate-1";
    if (!isValidNfcUid(uid)) {
      return NextResponse.json(
        { success: false, error: "UID gelang tidak valid" },
        { status: 400 }
      );
    }

    const outcome = await withTransaction(async (client): Promise<TapOutcome> => {
      const bandResult = await client.query<{ id: string; label: string | null }>(
        `SELECT id, label FROM ticketing.ticket_bands
         WHERE branch_id = $1 AND company_id = $2 AND nfc_uid = $3`,
        [ctx.branchId, ctx.companyId, uid]
      );
      const band = bandResult.rows[0];
      if (!band) {
        await logGateEvent(client, ctx, {
          bandUid: uid,
          bandId: null,
          visitId: null,
          gateLabel,
          result: "ditolak-gelang-tak-dikenal",
        });
        return {
          result: "ditolak-gelang-tak-dikenal",
          ok: false,
          reason: "Gelang tidak terdaftar di registry venue",
        };
      }

      // Visit aktif utk gelang ini + kunci visit (serialisasi dgn settle/F&B)
      const vbResult = await client.query<{
        visit_band_id: string;
        visit_id: string;
        variant_id: string;
        ticket_product_id: string;
        ticket_type_name: string;
        re_entry_policy: string;
        entered_at: string | null;
        contact_name: string;
        payment_mode: "postpaid" | "prepaid";
        credit_limit: string | null;
        channel_id: string | null;
        visit_status: string;
      }>(
        `SELECT vb.id AS visit_band_id, vb.visit_id, vb.variant_id,
                tp.id AS ticket_product_id,
                tp.name || ' — ' || pv.name AS ticket_type_name,
                tp.re_entry_policy, vb.entered_at,
                v.contact_name, v.payment_mode, v.credit_limit, v.channel_id,
                v.status AS visit_status
         FROM ticketing.ticket_visit_bands vb
         JOIN ticketing.ticket_visits v ON v.id = vb.visit_id
         JOIN ticketing.ticket_product_variants pv ON pv.id = vb.variant_id
         JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
         WHERE vb.band_id = $1 AND vb.status = 'aktif'
         ORDER BY vb.created_at DESC
         LIMIT 1
         FOR UPDATE OF vb, v`,
        [band.id]
      );
      const vb = vbResult.rows[0];
      if (!vb || vb.visit_status !== "open") {
        await logGateEvent(client, ctx, {
          bandUid: uid,
          bandId: band.id,
          visitId: vb?.visit_id ?? null,
          gateLabel,
          result: "ditolak-tanpa-kunjungan",
        });
        return {
          result: "ditolak-tanpa-kunjungan",
          ok: false,
          reason: "Gelang tidak terikat kunjungan terbuka — daftar di loket dulu",
          band_label: band.label,
        };
      }

      // Tap ulang → kebijakan re-entry TICKET ybs (revisi owner: per produk)
      if (vb.entered_at !== null) {
        const policy = vb.re_entry_policy || "sekali-masuk";
        if (policy === "bebas-keluar-masuk") {
          await logGateEvent(client, ctx, {
            bandUid: uid,
            bandId: band.id,
            visitId: vb.visit_id,
            gateLabel,
            result: "masuk-lagi",
          });
          return {
            result: "masuk-lagi",
            ok: true,
            contact_name: vb.contact_name,
            ticket_type_name: vb.ticket_type_name,
            band_label: band.label,
          };
        }
        await logGateEvent(client, ctx, {
          bandUid: uid,
          bandId: band.id,
          visitId: vb.visit_id,
          gateLabel,
          result: "ditolak-sudah-masuk",
        });
        return {
          result: "ditolak-sudah-masuk",
          ok: false,
          reason: "Tiket sudah dipakai masuk (kebijakan sekali masuk)",
          contact_name: vb.contact_name,
          ticket_type_name: vb.ticket_type_name,
          band_label: band.label,
        };
      }

      // Tap pertama → charge tiket dengan harga hasil resolve matriks
      if (!vb.channel_id) {
        await logGateEvent(client, ctx, {
          bandUid: uid,
          bandId: band.id,
          visitId: vb.visit_id,
          gateLabel,
          result: "ditolak-tanpa-kanal",
        });
        return {
          result: "ditolak-tanpa-kanal",
          ok: false,
          reason: "Kunjungan tanpa kanal penjualan — hubungi supervisor",
          contact_name: vb.contact_name,
          ticket_type_name: vb.ticket_type_name,
        };
      }
      const visitDate = todayJakartaDate();
      const resolved = await resolveVariantPriceOnDate(client, {
        companyId: ctx.companyId,
        branchId: ctx.branchId,
        variantId: vb.variant_id,
        channelId: vb.channel_id,
        visitDate,
      });
      if (!resolved.ok) {
        await logGateEvent(client, ctx, {
          bandUid: uid,
          bandId: band.id,
          visitId: vb.visit_id,
          gateLabel,
          result: "ditolak-harga-belum-diisi",
        });
        return {
          result: "ditolak-harga-belum-diisi",
          ok: false,
          reason:
            resolved.reason === "tanggal-diblok"
              ? "Tanggal ini diblok untuk kanal kunjungan — hubungi supervisor"
              : `Harga ${vb.ticket_type_name} belum diisi — lengkapi di Master Ticket`,
          contact_name: vb.contact_name,
          ticket_type_name: vb.ticket_type_name,
        };
      }

      // Harga 0 = tiket gratis/comp yang sah — masuk tanpa baris ledger
      if (resolved.price === 0) {
        await client.query(
          `UPDATE ticketing.ticket_visit_bands
           SET entered_at = now(), updated_at = now() WHERE id = $1`,
          [vb.visit_band_id]
        );
        await logGateEvent(client, ctx, {
          bandUid: uid,
          bandId: band.id,
          visitId: vb.visit_id,
          gateLabel,
          result: "masuk",
        });
        return {
          result: "masuk",
          ok: true,
          contact_name: vb.contact_name,
          ticket_type_name: vb.ticket_type_name,
          band_label: band.label,
          charged_amount: 0,
        };
      }

      const chargesResult = await client.query<{
        direction: "debit" | "kredit";
        amount: string;
      }>(
        `SELECT direction, amount FROM ticketing.ticket_visit_charges
         WHERE visit_id = $1`,
        [vb.visit_id]
      );
      const summary = computeTabSummary(
        chargesResult.rows.map((c) => ({
          direction: c.direction,
          amount: Number(c.amount),
        }))
      );
      const guard = canCharge({
        paymentMode: vb.payment_mode,
        summary,
        amount: resolved.price,
        creditLimit: vb.credit_limit === null ? null : Number(vb.credit_limit),
      });
      if (!guard.ok) {
        const result =
          vb.payment_mode === "prepaid"
            ? ("ditolak-saldo-kurang" as const)
            : ("ditolak-plafon" as const);
        await logGateEvent(client, ctx, {
          bandUid: uid,
          bandId: band.id,
          visitId: vb.visit_id,
          gateLabel,
          result,
        });
        return {
          result,
          ok: false,
          reason: guard.reason,
          contact_name: vb.contact_name,
          ticket_type_name: vb.ticket_type_name,
        };
      }

      await client.query(
        `INSERT INTO ticketing.ticket_visit_charges
           (company_id, branch_id, visit_id, band_id, charge_type, direction,
            description, amount, price_context, created_by)
         VALUES ($1, $2, $3, $4, 'tiket', 'debit', $5, $6, $7, $8)`,
        [
          ctx.companyId,
          ctx.branchId,
          vb.visit_id,
          band.id,
          `Tiket ${vb.ticket_type_name} (${resolved.seasonKind}, ${visitDate})`,
          resolved.price,
          JSON.stringify({
            ticket_product_id: vb.ticket_product_id,
            variant_id: vb.variant_id,
            season_kind: resolved.seasonKind,
            channel_id: vb.channel_id,
            visit_date: visitDate,
          }),
          ctx.user.id,
        ]
      );
      await client.query(
        `UPDATE ticketing.ticket_visit_bands
         SET entered_at = now(), updated_at = now() WHERE id = $1`,
        [vb.visit_band_id]
      );
      await logGateEvent(client, ctx, {
        bandUid: uid,
        bandId: band.id,
        visitId: vb.visit_id,
        gateLabel,
        result: "masuk",
      });
      return {
        result: "masuk",
        ok: true,
        contact_name: vb.contact_name,
        ticket_type_name: vb.ticket_type_name,
        band_label: band.label,
        charged_amount: resolved.price,
      };
    });

    return successResponse(outcome);
  } catch (err) {
    console.error("[ticketing] gate tap error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memproses tap gate" },
      { status: 500 }
    );
  }
}
