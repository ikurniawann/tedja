import { z } from "zod";
import type { PoolClient } from "pg";
import { isValidCalendarDate } from "./server";

// Batas selaras presisi kolom numeric(14,2) — line_total maks 12 digit
const MAX_LINE_TOTAL = 999_999_999_999;

export const QUOTATION_STATUSES = [
  "draft",
  "terkirim",
  "diterima",
  "ditolak",
] as const;

export const quotationItemSchema = z
  .object({
    item_type: z.enum(["produk", "bebas"]).default("bebas"),
    product_id: z.string().uuid().optional().nullable(),
    description: z.string().trim().min(1).max(300),
    qty: z.number().positive().max(100_000),
    unit_price: z.number().min(0).max(999_999_999),
  })
  .refine((v) => v.item_type !== "produk" || Boolean(v.product_id), {
    message: "Baris produk wajib memilih produk katalog",
  })
  .refine((v) => v.qty * v.unit_price <= MAX_LINE_TOTAL, {
    message: "Jumlah baris melebihi batas nilai (12 digit)",
  });

export const quotationPayloadSchema = z.object({
  use_ppn: z.boolean().default(true),
  ppn_persen: z.number().min(0).max(100).default(11),
  notes: z.string().trim().max(2000).optional().nullable(),
  valid_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isValidCalendarDate, { message: "Tanggal tidak valid" })
    .optional()
    .nullable()
    .or(z.literal("")),
  items: z.array(quotationItemSchema).min(1).max(100),
});

export type QuotationPayload = z.infer<typeof quotationPayloadSchema>;

/** Hitung total server-side — jangan pernah percaya angka dari klien. */
export function computeTotals(payload: QuotationPayload): {
  subtotal: number;
  ppnNominal: number;
  total: number;
  lines: Array<QuotationPayload["items"][number] & { line_total: number }>;
} {
  const lines = payload.items.map((item) => ({
    ...item,
    line_total: Math.round(item.qty * item.unit_price * 100) / 100,
  }));
  const subtotal =
    Math.round(lines.reduce((acc, line) => acc + line.line_total, 0) * 100) / 100;
  const ppnNominal = payload.use_ppn
    ? Math.round(subtotal * payload.ppn_persen) / 100
    : 0;
  const total = Math.round((subtotal + ppnNominal) * 100) / 100;
  return { subtotal, ppnNominal, total, lines };
}

/** Validasi semua product_id baris produk ada & aktif di katalog. */
export async function validateProducts(
  client: PoolClient,
  payload: QuotationPayload
): Promise<string | null> {
  const productIds = [
    ...new Set(
      payload.items
        .filter((item) => item.item_type === "produk" && item.product_id)
        .map((item) => item.product_id as string)
    ),
  ];
  if (productIds.length === 0) return null;
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM pos.pos_products
     WHERE id = ANY($1::uuid[]) AND is_active = true`,
    [productIds]
  );
  if (rows.length !== productIds.length) {
    return "Ada produk yang tidak ditemukan atau nonaktif di katalog";
  }
  return null;
}

/** Sisipkan semua baris item dalam SATU pernyataan (dipanggil dalam transaksi). */
export async function insertItems(
  client: PoolClient,
  quotationId: string,
  lines: ReturnType<typeof computeTotals>["lines"]
): Promise<void> {
  if (lines.length === 0) return;
  const values: unknown[] = [];
  const rows = lines.map((line, index) => {
    values.push(
      quotationId,
      line.item_type,
      line.item_type === "produk" ? line.product_id : null,
      line.description,
      line.qty,
      line.unit_price,
      line.line_total,
      index
    );
    const base = index * 8;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
  });
  await client.query(
    `INSERT INTO crm.crm_sales_quotation_items
       (quotation_id, item_type, product_id, description, qty,
        unit_price, line_total, sort_order)
     VALUES ${rows.join(", ")}`,
    values
  );
}
