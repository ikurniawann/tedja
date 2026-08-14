import { query, queryOne } from "@/lib/db";
import {
  DEFAULT_POS_PAYMENT_METHODS,
  isPosPaymentMethodCode,
  type PosPaymentHandler,
  type PosPaymentMethod,
  type PosPaymentMethodCode,
} from "@/lib/pos/payment-methods";

type PaymentMethodRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  handler: string;
  is_active: boolean;
  sort_order: number;
  requires_cash_input: boolean;
};

function mapRow(row: PaymentMethodRow): PosPaymentMethod | null {
  if (!isPosPaymentMethodCode(row.code)) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description || "",
    icon: row.icon || "banknote",
    handler: row.handler as PosPaymentHandler,
    is_active: Boolean(row.is_active),
    sort_order: Number(row.sort_order) || 100,
    requires_cash_input: Boolean(row.requires_cash_input),
  };
}

export async function listPosPaymentMethods(opts?: {
  activeOnly?: boolean;
}): Promise<PosPaymentMethod[]> {
  try {
    const rows = await query<PaymentMethodRow>(
      `SELECT id, code, name, description, icon, handler,
              is_active, sort_order, requires_cash_input
       FROM pos.payment_methods
       WHERE ($1::boolean IS NOT TRUE OR is_active = true)
       ORDER BY sort_order ASC, name ASC`,
      [opts?.activeOnly === true]
    );
    return rows
      .map(mapRow)
      .filter((row): row is PosPaymentMethod => row !== null);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "42P01") {
      const list = DEFAULT_POS_PAYMENT_METHODS;
      return opts?.activeOnly ? list.filter((m) => m.is_active) : list;
    }
    throw err;
  }
}

export async function updatePosPaymentMethod(
  code: string,
  patch: {
    name?: string;
    description?: string;
    is_active?: boolean;
    sort_order?: number;
  }
): Promise<PosPaymentMethod | null> {
  if (!isPosPaymentMethodCode(code)) return null;

  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (patch.name !== undefined) add("name", patch.name);
  if (patch.description !== undefined) add("description", patch.description);
  if (patch.is_active !== undefined) add("is_active", patch.is_active);
  if (patch.sort_order !== undefined) add("sort_order", patch.sort_order);

  if (sets.length === 1) {
    return queryOne<PaymentMethodRow>(
      `SELECT id, code, name, description, icon, handler,
              is_active, sort_order, requires_cash_input
       FROM pos.payment_methods WHERE code = $1`,
      [code]
    ).then((row) => (row ? mapRow(row) : null));
  }

  values.push(code);
  const row = await queryOne<PaymentMethodRow>(
    `UPDATE pos.payment_methods
     SET ${sets.join(", ")}
     WHERE code = $${values.length}
     RETURNING id, code, name, description, icon, handler,
               is_active, sort_order, requires_cash_input`,
    values
  );
  return row ? mapRow(row) : null;
}
