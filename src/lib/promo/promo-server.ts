// EPIC-032 Fase A2 — sisi server engine promo: preview validasi (read-only)
// dan siklus hidup pemakaian kode: HOLD (klaim transaksional di bawah
// advisory lock) → CAPTURE (terpakai final) → RELEASE (lepas + kembalikan
// jatah). Pola anti-race = EPIC-031: lock → hitung live → putuskan; lock
// per CAMPAIGN karena limit campaign melintasi banyak kode (batch voucher).

import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import {
  PROMO_REJECT_MESSAGES,
  evaluatePromo,
  type PromoCampaignRule,
  type PromoCodeState,
  type PromoRejectReason,
  type PromoScope,
} from "./promo";

export interface PromoVenueScope {
  companyId: string;
  branchId: string;
}

export type PromoChannel = Exclude<PromoScope, "semua">;

export type PromoContextType = "ticket_booking" | "pos_order";

/** Baris gabungan kode + campaign hasil lookup. */
export interface PromoCodeRow {
  code_id: string;
  code: string;
  code_usage_limit: number | null;
  code_usage_count: number;
  code_is_active: boolean;
  campaign_id: string;
  campaign_name: string;
  discount_type: "percent" | "fixed";
  value: number;
  max_discount: number | null;
  min_purchase: number;
  valid_from: string | null;
  valid_until: string | null;
  usage_limit: number | null;
  per_phone_limit: number | null;
  scope: PromoScope;
  campaign_is_active: boolean;
}

/** Error ber-statusCode — pola staff-passes/CapacityFullError. */
export class PromoRejectedError extends Error {
  statusCode = 422 as const;
  reason: PromoRejectReason;
  constructor(reason: PromoRejectReason) {
    super(PROMO_REJECT_MESSAGES[reason]);
    this.name = "PromoRejectedError";
    this.reason = reason;
  }
}

const todayJakartaDate = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(
    new Date()
  );

const CODE_JOIN_SELECT = `
  SELECT k.id AS code_id, k.code, k.usage_limit AS code_usage_limit,
         k.usage_count AS code_usage_count, k.is_active AS code_is_active,
         c.id AS campaign_id, c.name AS campaign_name, c.discount_type,
         c.value::float8 AS value, c.max_discount::float8 AS max_discount,
         c.min_purchase::float8 AS min_purchase,
         c.valid_from::text AS valid_from, c.valid_until::text AS valid_until,
         c.usage_limit, c.per_phone_limit, c.scope,
         c.is_active AS campaign_is_active
  FROM promo.promo_codes k
  JOIN promo.promo_campaigns c ON c.id = k.campaign_id`;

/** Lookup kode per venue — case-insensitive (kode disimpan apa adanya). */
async function findCodeRows(
  scope: PromoVenueScope,
  code: string,
  runner: <T>(sql: string, params: unknown[]) => Promise<T[]>
): Promise<PromoCodeRow | null> {
  const rows = await runner<PromoCodeRow>(
    `${CODE_JOIN_SELECT}
     WHERE k.branch_id = $1 AND k.company_id = $2 AND upper(k.code) = upper($3)
     LIMIT 1`,
    [scope.branchId, scope.companyId, code.trim()]
  );
  return rows[0] ?? null;
}

const toRule = (row: PromoCodeRow): PromoCampaignRule => ({
  discount_type: row.discount_type,
  value: row.value,
  max_discount: row.max_discount,
  min_purchase: row.min_purchase,
  valid_from: row.valid_from,
  valid_until: row.valid_until,
  usage_limit: row.usage_limit,
  per_phone_limit: row.per_phone_limit,
  scope: row.scope,
  is_active: row.campaign_is_active,
});

const toCodeState = (row: PromoCodeRow): PromoCodeState => ({
  is_active: row.code_is_active,
  usage_limit: row.code_usage_limit,
  usage_count: row.code_usage_count,
});

/** Hitungan hidup (held/captured) — dipanggil DI BAWAH lock utk jalur tulis. */
async function loadUsageCounts(
  campaignId: string,
  phone: string | null,
  runner: <T>(sql: string, params: unknown[]) => Promise<T[]>
): Promise<{ campaignUsed: number; phoneUsed: number }> {
  const rows = await runner<{ campaign_used: string; phone_used: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status <> 'released') AS campaign_used,
       COUNT(*) FILTER (WHERE status <> 'released' AND phone = $2) AS phone_used
     FROM promo.promo_redemptions
     WHERE campaign_id = $1`,
    [campaignId, phone]
  );
  return {
    campaignUsed: Number(rows[0]?.campaign_used ?? 0),
    phoneUsed: Number(rows[0]?.phone_used ?? 0),
  };
}

export type PromoPreview =
  | {
      ok: true;
      discount: number;
      campaign_name: string;
      discount_type: "percent" | "fixed";
    }
  | { ok: false; reason: PromoRejectReason; message: string };

/**
 * Preview READ-ONLY utk endpoint validasi (wizard/kasir): tanpa lock,
 * tanpa klaim — indikatif; kebenaran final tetap `holdPromoRedemption`
 * di dalam transaksi create. Kode tak dikenal = pesan sama dgn nonaktif
 * (anti-enumerasi kode).
 */
export async function previewPromoCode(input: {
  scope: PromoVenueScope;
  code: string;
  channel: PromoChannel;
  subtotal: number;
  phone: string | null;
}): Promise<PromoPreview> {
  const poolRunner = <T>(sql: string, params: unknown[]) =>
    query<T & Record<string, unknown>>(sql, params) as Promise<T[]>;
  const row = await findCodeRows(input.scope, input.code, poolRunner);
  if (!row) {
    return {
      ok: false,
      reason: "nonaktif",
      message: PROMO_REJECT_MESSAGES["nonaktif"],
    };
  }
  const counts = await loadUsageCounts(row.campaign_id, input.phone, poolRunner);
  const result = evaluatePromo(toRule(row), toCodeState(row), {
    today: todayJakartaDate(),
    channel: input.channel,
    subtotal: input.subtotal,
    campaignUsedCount: counts.campaignUsed,
    phoneUsedCount: counts.phoneUsed,
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      message: PROMO_REJECT_MESSAGES[result.reason],
    };
  }
  return {
    ok: true,
    discount: result.discount,
    campaign_name: row.campaign_name,
    discount_type: row.discount_type,
  };
}

export interface PromoHold {
  redemptionId: string;
  codeId: string;
  campaignName: string;
  discount: number;
}

/**
 * Klaim kode DI DALAM transaksi pemanggil: advisory lock per campaign →
 * muat ulang kode+campaign → hitung pemakaian live → evaluasi → naikkan
 * usage_count + insert redemption `held`. Throw PromoRejectedError (422)
 * bila tak lolos. Unique index context = backstop 1 kode per transaksi.
 */
export async function holdPromoRedemption(
  client: PoolClient,
  input: {
    scope: PromoVenueScope;
    code: string;
    channel: PromoChannel;
    contextType: PromoContextType;
    contextId: string;
    subtotal: number;
    phone: string | null;
    customerId?: string | null;
  }
): Promise<PromoHold> {
  const clientRunner = <T>(sql: string, params: unknown[]) =>
    client.query<T & Record<string, unknown>>(sql, params).then((r) => r.rows as T[]);

  // Lookup awal hanya utk tahu campaign_id (kunci lock)
  const initial = await findCodeRows(input.scope, input.code, clientRunner);
  if (!initial) throw new PromoRejectedError("nonaktif");

  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext('promo'), hashtext($1::text))`,
    [initial.campaign_id]
  );

  // Muat ULANG di bawah lock — usage_count/status bisa berubah
  const row = await findCodeRows(input.scope, input.code, clientRunner);
  if (!row) throw new PromoRejectedError("nonaktif");

  const counts = await loadUsageCounts(row.campaign_id, input.phone, clientRunner);
  const result = evaluatePromo(toRule(row), toCodeState(row), {
    today: todayJakartaDate(),
    channel: input.channel,
    subtotal: input.subtotal,
    campaignUsedCount: counts.campaignUsed,
    phoneUsedCount: counts.phoneUsed,
  });
  if (!result.ok) throw new PromoRejectedError(result.reason);

  await client.query(
    `UPDATE promo.promo_codes
     SET usage_count = usage_count + 1, updated_at = now()
     WHERE id = $1`,
    [row.code_id]
  );
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO promo.promo_redemptions
       (company_id, branch_id, code_id, campaign_id, campaign_name,
        discount_type, value, context_type, context_id, phone, customer_id,
        discount_amount, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'held')
     RETURNING id`,
    [
      input.scope.companyId,
      input.scope.branchId,
      row.code_id,
      row.campaign_id,
      row.campaign_name,
      row.discount_type,
      row.value,
      input.contextType,
      input.contextId,
      input.phone,
      input.customerId ?? null,
      result.discount,
    ]
  );
  return {
    redemptionId: inserted.rows[0].id,
    codeId: row.code_id,
    campaignName: row.campaign_name,
    discount: result.discount,
  };
}

type Runner = Pick<PoolClient, "query">;

/**
 * Tandai pemakaian FINAL (mis. webhook PAID). Idempoten: hanya baris
 * `held` yang berubah. Return true bila ada yang berubah.
 */
export async function capturePromoRedemption(
  runner: Runner,
  contextType: PromoContextType,
  contextId: string
): Promise<boolean> {
  const result = await runner.query(
    `UPDATE promo.promo_redemptions
     SET status = 'captured', updated_at = now()
     WHERE context_type = $1 AND context_id = $2 AND status = 'held'`,
    [contextType, contextId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Lepas pemakaian (kedaluwarsa/batal/void) + kembalikan jatah kode.
 * Idempoten: baris `released` tidak disentuh ulang; usage_count dijaga
 * tidak minus (GREATEST). Return true bila ada yang dilepas.
 */
export async function releasePromoRedemption(
  runner: Runner,
  contextType: PromoContextType,
  contextId: string
): Promise<boolean> {
  const released = await runner.query<{ code_id: string }>(
    `UPDATE promo.promo_redemptions
     SET status = 'released', updated_at = now()
     WHERE context_type = $1 AND context_id = $2 AND status <> 'released'
     RETURNING code_id`,
    [contextType, contextId]
  );
  for (const row of released.rows) {
    await runner.query(
      `UPDATE promo.promo_codes
       SET usage_count = GREATEST(usage_count - 1, 0), updated_at = now()
       WHERE id = $1`,
      [row.code_id]
    );
  }
  return released.rows.length > 0;
}
