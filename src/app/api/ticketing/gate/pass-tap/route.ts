import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { PoolClient } from "pg";
import { successResponse } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  TICKETING_OPERATOR_ROLES,
  isValidNfcUid,
  normalizeNfcUid,
  requireTicketingContext,
  type TicketingContext,
} from "@/lib/ticketing/server";
import { todayInJakarta } from "@/lib/ticketing/booking";

// EPIC-028 Fase C — validasi masuk Season Pass di gate / reader keliling.
// Input `code` bisa QR access_token (64 hex), pass_code (SP-…), atau UID gelang
// NFC tertaut. Validasi berlapis: status → masa berlaku → blackout → kebijakan
// entry (1×/hari, tak terbatas, jatah kunjungan). Semua dicatat di
// ticket_pass_entries.

const tapSchema = z.object({
  code: z.string().trim().min(1).max(120),
  gate_label: z.string().trim().max(60).optional(),
});

type PassTapResult =
  | "granted"
  | "denied_expired"
  | "denied_duplicate"
  | "denied_quota"
  | "denied_inactive"
  | "denied_blackout"
  | "bukan-pass";

interface PassRow {
  id: string;
  pass_code: string;
  holder_name: string;
  status: string;
  entry_policy: string;
  valid_from: string | null;
  valid_until: string | null;
  visit_quota_total: number | null;
  visit_quota_used: number;
  band_uid: string | null;
  ticket_product_id: string;
  product_name: string;
}

const HEX64 = /^[0-9a-f]{64}$/i;

async function resolvePass(
  client: PoolClient,
  ctx: TicketingContext,
  raw: string
): Promise<PassRow | null> {
  const base = `
    SELECT sp.id, sp.pass_code, sp.holder_name, sp.status, sp.entry_policy,
           sp.valid_from::text AS valid_from, sp.valid_until::text AS valid_until,
           sp.visit_quota_total, sp.visit_quota_used, sp.band_uid,
           sp.ticket_product_id, tp.name AS product_name
    FROM ticketing.ticket_season_passes sp
    JOIN ticketing.ticket_products tp ON tp.id = sp.ticket_product_id
    WHERE sp.branch_id = $1 AND sp.company_id = $2 AND `;
  let where: string;
  let key: string;
  if (HEX64.test(raw)) {
    where = "sp.access_token = $3";
    key = raw.toLowerCase();
  } else if (/^SP-/i.test(raw)) {
    where = "sp.pass_code = $3";
    key = raw.toUpperCase();
  } else {
    const uid = normalizeNfcUid(raw);
    if (!isValidNfcUid(uid)) return null;
    where = "sp.band_uid = $3";
    key = uid;
  }
  const res = await client.query<PassRow>(
    `${base}${where} LIMIT 1 FOR UPDATE OF sp`,
    [ctx.branchId, ctx.companyId, key]
  );
  return res.rows[0] ?? null;
}

async function logEntry(
  client: PoolClient,
  ctx: TicketingContext,
  pass: PassRow,
  entryDate: string,
  gateLabel: string,
  result: PassTapResult
) {
  await client.query(
    `INSERT INTO ticketing.ticket_pass_entries
       (company_id, branch_id, season_pass_id, entry_date, entry_policy,
        gate_label, band_uid, result, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      ctx.companyId,
      ctx.branchId,
      pass.id,
      entryDate,
      pass.entry_policy,
      gateLabel,
      pass.band_uid,
      result,
      ctx.user.id,
    ]
  );
}

export async function POST(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  const rate = checkRateLimit(`ticketing-pass-gate:${ctx.user.id}`, 120);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak scan — tunggu sebentar" },
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
    const gateLabel = parsed.data.gate_label?.trim() || "gate-pass";

    const outcome = await withTransaction(async (client) => {
      const pass = await resolvePass(client, ctx, parsed.data.code);
      if (!pass) {
        return {
          ok: false,
          result: "bukan-pass" as PassTapResult,
          reason: "Kode tidak dikenal sebagai Season Pass",
        };
      }

      const today = todayInJakarta();
      const denied = (result: PassTapResult, reason: string) => ({
        ok: false,
        result,
        reason,
        holder_name: pass.holder_name,
        pass_code: pass.pass_code,
        ticket_type_name: pass.product_name,
      });

      if (pass.status !== "active") {
        await logEntry(client, ctx, pass, today, gateLabel, "denied_inactive");
        return denied(
          "denied_inactive",
          pass.status === "pending"
            ? "Pass belum aktif (menunggu pembayaran)"
            : `Pass berstatus ${pass.status}`
        );
      }
      if (
        (pass.valid_from && today < pass.valid_from) ||
        (pass.valid_until && today > pass.valid_until)
      ) {
        await logEntry(client, ctx, pass, today, gateLabel, "denied_expired");
        return denied("denied_expired", "Pass di luar masa berlaku");
      }

      const blackout = await client.query(
        `SELECT 1 FROM ticketing.ticket_product_dates
         WHERE ticket_product_id = $1 AND date_kind = 'blackout'
           AND is_active = true AND $2::date BETWEEN start_date AND end_date
         LIMIT 1`,
        [pass.ticket_product_id, today]
      );
      if (blackout.rows.length > 0) {
        await logEntry(client, ctx, pass, today, gateLabel, "denied_blackout");
        return denied("denied_blackout", "Tanggal ini blackout untuk pass ini");
      }

      if (pass.entry_policy === "limited_visits") {
        const total = pass.visit_quota_total ?? 0;
        if (pass.visit_quota_used >= total) {
          await logEntry(client, ctx, pass, today, gateLabel, "denied_quota");
          return denied("denied_quota", "Jatah kunjungan sudah habis");
        }
        await client.query(
          `UPDATE ticketing.ticket_season_passes
           SET visit_quota_used = visit_quota_used + 1, updated_at = now()
           WHERE id = $1`,
          [pass.id]
        );
        await logEntry(client, ctx, pass, today, gateLabel, "granted");
        return {
          ok: true,
          result: "granted" as PassTapResult,
          holder_name: pass.holder_name,
          pass_code: pass.pass_code,
          ticket_type_name: pass.product_name,
          valid_until: pass.valid_until,
          entry_policy: pass.entry_policy,
          remaining_quota: total - pass.visit_quota_used - 1,
        };
      }

      // once_per_day: cek entri granted hari ini (unique index = backstop race)
      if (pass.entry_policy === "once_per_day") {
        const dup = await client.query(
          `SELECT 1 FROM ticketing.ticket_pass_entries
           WHERE season_pass_id = $1 AND entry_date = $2 AND result = 'granted'
           LIMIT 1`,
          [pass.id, today]
        );
        if (dup.rows.length > 0) {
          await logEntry(client, ctx, pass, today, gateLabel, "denied_duplicate");
          return denied("denied_duplicate", "Pass sudah dipakai masuk hari ini");
        }
      }

      // unlimited & once_per_day (lolos cek) → granted
      await logEntry(client, ctx, pass, today, gateLabel, "granted");
      return {
        ok: true,
        result: "granted" as PassTapResult,
        holder_name: pass.holder_name,
        pass_code: pass.pass_code,
        ticket_type_name: pass.product_name,
        valid_until: pass.valid_until,
        entry_policy: pass.entry_policy,
      };
    });

    return successResponse(outcome);
  } catch (err) {
    console.error("[ticketing] pass gate tap error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memproses scan pass" },
      { status: 500 }
    );
  }
}
