import { query, withTransaction } from "@/lib/db";
import type { PoolClient } from "pg";
import {
  type OfferRuleInput,
  type OfferType,
  validateOfferRule,
} from "@/lib/promo/offer-rules";

export type OfferRuleRow = {
  id: string;
  company_id: string;
  branch_id: string;
  offer_type: OfferType;
  name: string;
  description: string | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  bundle_price: string | null;
  buy_qty: number | null;
  get_qty: number | null;
  get_mode: string | null;
  volume_basis: string | null;
  volume_min: string | null;
  discount_type: string | null;
  discount_value: string | null;
  created_at: string;
  updated_at: string;
};

export type OfferRuleItemRow = {
  id: string;
  rule_id: string;
  role: string;
  product_id: string;
  qty: string;
  sort_order: number;
  product_name?: string | null;
};

export type OfferRuleDetail = OfferRuleRow & { items: OfferRuleItemRow[] };

export async function listOfferRules(input: {
  companyId: string;
  branchId: string;
  offerType: OfferType;
}): Promise<OfferRuleDetail[]> {
  const rules = await query<OfferRuleRow>(
    `SELECT id, company_id, branch_id, offer_type, name, description,
            valid_from::text, valid_until::text, is_active,
            bundle_price::text, buy_qty, get_qty, get_mode,
            volume_basis, volume_min::text, discount_type, discount_value::text,
            created_at, updated_at
     FROM promo.offer_rules
     WHERE company_id = $1 AND branch_id = $2 AND offer_type = $3
     ORDER BY created_at DESC`,
    [input.companyId, input.branchId, input.offerType]
  );
  if (rules.length === 0) return [];

  const ids = rules.map((r) => r.id);
  const items = await query<OfferRuleItemRow>(
    `SELECT i.id, i.rule_id, i.role, i.product_id, i.qty::text, i.sort_order,
            p.name AS product_name
     FROM promo.offer_rule_items i
     LEFT JOIN pos.pos_products p ON p.id = i.product_id
     WHERE i.rule_id = ANY($1::uuid[])
     ORDER BY i.sort_order, i.created_at`,
    [ids]
  );

  const byRule = new Map<string, OfferRuleItemRow[]>();
  for (const item of items) {
    const list = byRule.get(item.rule_id) ?? [];
    list.push(item);
    byRule.set(item.rule_id, list);
  }

  return rules.map((rule) => ({
    ...rule,
    items: byRule.get(rule.id) ?? [],
  }));
}

export async function getOfferRule(input: {
  id: string;
  companyId: string;
  branchId: string;
}): Promise<OfferRuleDetail | null> {
  const rows = await query<OfferRuleRow>(
    `SELECT id, company_id, branch_id, offer_type, name, description,
            valid_from::text, valid_until::text, is_active,
            bundle_price::text, buy_qty, get_qty, get_mode,
            volume_basis, volume_min::text, discount_type, discount_value::text,
            created_at, updated_at
     FROM promo.offer_rules
     WHERE id = $1 AND company_id = $2 AND branch_id = $3
     LIMIT 1`,
    [input.id, input.companyId, input.branchId]
  );
  const rule = rows[0];
  if (!rule) return null;

  const items = await query<OfferRuleItemRow>(
    `SELECT i.id, i.rule_id, i.role, i.product_id, i.qty::text, i.sort_order,
            p.name AS product_name
     FROM promo.offer_rule_items i
     LEFT JOIN pos.pos_products p ON p.id = i.product_id
     WHERE i.rule_id = $1
     ORDER BY i.sort_order, i.created_at`,
    [rule.id]
  );

  return { ...rule, items };
}

async function replaceItems(
  client: PoolClient,
  ruleId: string,
  items: OfferRuleInput["items"]
) {
  await client.query(`DELETE FROM promo.offer_rule_items WHERE rule_id = $1`, [
    ruleId,
  ]);
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    await client.query(
      `INSERT INTO promo.offer_rule_items (rule_id, role, product_id, qty, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        ruleId,
        item.role,
        item.product_id,
        Number(item.qty) > 0 ? Number(item.qty) : 1,
        item.sort_order ?? i,
      ]
    );
  }
}

export async function createOfferRule(input: {
  companyId: string;
  branchId: string;
  userId: string;
  payload: OfferRuleInput;
}): Promise<OfferRuleDetail> {
  const error = validateOfferRule(input.payload);
  if (error) throw new Error(error);

  const p = input.payload;
  const id = await withTransaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO promo.offer_rules (
         company_id, branch_id, offer_type, name, description,
         valid_from, valid_until, is_active,
         bundle_price, buy_qty, get_qty, get_mode,
         volume_basis, volume_min, discount_type, discount_value, created_by
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6::date,$7::date,$8,
         $9,$10,$11,$12,
         $13,$14,$15,$16,$17
       ) RETURNING id`,
      [
        input.companyId,
        input.branchId,
        p.offer_type,
        p.name.trim(),
        p.description?.trim() || null,
        p.valid_from || null,
        p.valid_until || null,
        p.is_active !== false,
        p.bundle_price ?? null,
        p.buy_qty ?? null,
        p.get_qty ?? null,
        p.get_mode ?? null,
        p.volume_basis ?? null,
        p.volume_min ?? null,
        p.discount_type ?? null,
        p.discount_value ?? null,
        input.userId,
      ]
    );
    const ruleId = inserted.rows[0]!.id;
    await replaceItems(client, ruleId, p.items);
    return ruleId;
  });

  const detail = await getOfferRule({
    id,
    companyId: input.companyId,
    branchId: input.branchId,
  });
  if (!detail) throw new Error("Gagal memuat aturan yang baru dibuat");
  return detail;
}

export async function updateOfferRule(input: {
  id: string;
  companyId: string;
  branchId: string;
  payload: OfferRuleInput;
}): Promise<OfferRuleDetail> {
  const existing = await getOfferRule({
    id: input.id,
    companyId: input.companyId,
    branchId: input.branchId,
  });
  if (!existing) throw new Error("Aturan tidak ditemukan");

  const payload: OfferRuleInput = {
    ...input.payload,
    offer_type: existing.offer_type,
  };
  const error = validateOfferRule(payload);
  if (error) throw new Error(error);

  const p = payload;
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE promo.offer_rules SET
         name = $2,
         description = $3,
         valid_from = $4::date,
         valid_until = $5::date,
         is_active = $6,
         bundle_price = $7,
         buy_qty = $8,
         get_qty = $9,
         get_mode = $10,
         volume_basis = $11,
         volume_min = $12,
         discount_type = $13,
         discount_value = $14,
         updated_at = now()
       WHERE id = $1 AND company_id = $15 AND branch_id = $16`,
      [
        input.id,
        p.name.trim(),
        p.description?.trim() || null,
        p.valid_from || null,
        p.valid_until || null,
        p.is_active !== false,
        p.bundle_price ?? null,
        p.buy_qty ?? null,
        p.get_qty ?? null,
        p.get_mode ?? null,
        p.volume_basis ?? null,
        p.volume_min ?? null,
        p.discount_type ?? null,
        p.discount_value ?? null,
        input.companyId,
        input.branchId,
      ]
    );
    await replaceItems(client, input.id, p.items);
  });

  const detail = await getOfferRule({
    id: input.id,
    companyId: input.companyId,
    branchId: input.branchId,
  });
  if (!detail) throw new Error("Gagal memuat aturan");
  return detail;
}

export async function deleteOfferRule(input: {
  id: string;
  companyId: string;
  branchId: string;
}): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM promo.offer_rules
     WHERE id = $1 AND company_id = $2 AND branch_id = $3
     RETURNING id`,
    [input.id, input.companyId, input.branchId]
  );
  return rows.length > 0;
}

/** Active rules in date window for POS (all offer types). */
export async function listActiveOfferRules(input: {
  companyId: string;
  branchId: string;
  todayIsoDate: string;
}): Promise<OfferRuleDetail[]> {
  const rules = await query<OfferRuleRow>(
    `SELECT id, company_id, branch_id, offer_type, name, description,
            valid_from::text, valid_until::text, is_active,
            bundle_price::text, buy_qty, get_qty, get_mode,
            volume_basis, volume_min::text, discount_type, discount_value::text,
            created_at, updated_at
     FROM promo.offer_rules
     WHERE company_id = $1
       AND branch_id = $2
       AND is_active = true
       AND (valid_from IS NULL OR valid_from <= $3::date)
       AND (valid_until IS NULL OR valid_until >= $3::date)
     ORDER BY offer_type, created_at DESC`,
    [input.companyId, input.branchId, input.todayIsoDate]
  );
  if (rules.length === 0) return [];

  const ids = rules.map((r) => r.id);
  const items = await query<OfferRuleItemRow>(
    `SELECT i.id, i.rule_id, i.role, i.product_id, i.qty::text, i.sort_order,
            p.name AS product_name
     FROM promo.offer_rule_items i
     LEFT JOIN pos.pos_products p ON p.id = i.product_id
     WHERE i.rule_id = ANY($1::uuid[])
     ORDER BY i.sort_order, i.created_at`,
    [ids]
  );

  const byRule = new Map<string, OfferRuleItemRow[]>();
  for (const item of items) {
    const list = byRule.get(item.rule_id) ?? [];
    list.push(item);
    byRule.set(item.rule_id, list);
  }

  return rules.map((rule) => ({
    ...rule,
    items: byRule.get(rule.id) ?? [],
  }));
}

export function toOfferEvalRules(details: OfferRuleDetail[]) {
  return details.map((rule) => ({
    id: rule.id,
    offer_type: rule.offer_type,
    name: rule.name,
    description: rule.description,
    bundle_price: rule.bundle_price != null ? Number(rule.bundle_price) : null,
    buy_qty: rule.buy_qty,
    get_qty: rule.get_qty,
    get_mode:
      rule.get_mode === "same_as_buy" || rule.get_mode === "specific_products"
        ? rule.get_mode
        : null,
    volume_basis:
      rule.volume_basis === "qty" || rule.volume_basis === "spend"
        ? rule.volume_basis
        : null,
    volume_min: rule.volume_min != null ? Number(rule.volume_min) : null,
    discount_type:
      rule.discount_type === "percent" || rule.discount_type === "fixed"
        ? rule.discount_type
        : null,
    discount_value:
      rule.discount_value != null ? Number(rule.discount_value) : null,
    items: rule.items.map((item) => ({
      role: item.role as "component" | "buy" | "get" | "eligible",
      product_id: item.product_id,
      qty: Number(item.qty) || 1,
    })),
  }));
}
