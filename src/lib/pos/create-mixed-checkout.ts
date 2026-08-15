import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { withTransaction } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { awardCrmXpForPosOrder, syncPosCustomerOrderStats } from "@/lib/crm/loyalty-engine";
import { AccountingPostError } from "@/lib/pos/accounting-posting";
import {
  allocateCheckoutCharges,
  shouldCreateCheckout,
  uniqueStallIds,
} from "@/lib/pos/central-cashier";
import {
  getXenditQrCode,
  getXenditQrCodeByReferenceId,
  getXenditQrPayments,
  isXenditQrPaid,
  loadActiveXenditConfig,
} from "@/lib/payments/xendit";
import { normalizeGuestCount } from "@/lib/pos/guest-count";
import {
  buildKitchenPrintJobs,
  normalizeStation,
} from "@/lib/pos/kitchen-station";
import {
  claimMerchandiseStock,
  restoreMerchandiseStock,
  type MerchStockClaim,
} from "@/lib/pos/merchandise-stock";
import { buildCostSnapshot, loadPosProductCostMap } from "@/lib/pos/purchasing-sync";

export const MIXED_STALL_FORBIDDEN_MESSAGE =
  "Keranjang campur stall hanya untuk kasir pusat";
export const MIXED_SPLIT_UNSUPPORTED_MESSAGE =
  "Split bill belum didukung untuk checkout multi-stall";
export const MISSING_PRODUCT_STALL_MESSAGE =
  "Ada produk tanpa stall — tidak bisa dimasukkan ke keranjang";
export const MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE =
  "Pembayaran NFC Tab / Gift Card belum didukung untuk checkout multi-stall";
export const CHECKOUT_QRIS_MISSING_MESSAGE = "QRIS belum dibuat untuk checkout ini";
export const CHECKOUT_QRIS_UNPAID_MESSAGE = "QRIS belum lunas";

export class MixedCheckoutError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "MixedCheckoutError";
    this.status = status;
  }
}

export type MixedCheckoutGuardResult =
  | { ok: true; createCheckout: boolean; stallIds: string[] }
  | { ok: false; message: string };

export type MixedCheckoutItem = {
  product_id?: string;
  sku_id?: string;
  product_name?: string;
  product_sku?: string;
  quantity?: number | string;
  unit_price?: number | string;
  variant_price_adjustment?: number | string;
  modifier_price_adjustment?: number | string;
  variants?: unknown[];
  modifiers?: unknown[];
  station?: string;
  discount_type?: string | null;
  discount_value?: number | string | null;
  discount_amount?: number | string;
  warehouse_id?: string;
};

export type MixedCheckoutCartSnapshot = {
  items: MixedCheckoutItem[];
  warehouseByProduct: Record<string, string>;
  orderType: string;
  guestCount: number;
  notes: string | null;
  specialRequests: string | null;
  chargesBreakdown: unknown;
  cashierId: string;
  serverId: string | null;
  sessionUserId: string;
  discountReason: string | null;
};

export type CreateMixedCheckoutInput = {
  items: MixedCheckoutItem[];
  warehouseByProduct: Map<string, string | null>;
  orderType?: string;
  customerId?: string | null;
  cashierId: string;
  serverId?: string | null;
  tableId?: string | null;
  guestCount?: unknown;
  discountAmount?: number | string;
  discountReason?: string | null;
  taxAmount?: number | string;
  serviceChargeAmount?: number | string;
  otherChargesAmount?: number | string;
  chargesBreakdown?: unknown;
  totalAmount?: number | string;
  paymentMethod?: string;
  paymentStatus?: string | null;
  amountPaid?: number | string;
  arkCoinsUsed?: number | string;
  notes?: string | null;
  specialRequests?: string | null;
  branchId?: string | null;
  shiftId?: string | null;
  companyId?: string | null;
  sessionUserId: string;
};

export type MixedCheckoutResult = {
  checkoutId: string;
  checkoutNumber: string;
  queueNumber: string;
  orderIds: string[];
};

type BuiltLine = MixedCheckoutItem & {
  warehouseId: string;
  qty: number;
  unitPrice: number;
  lineSubtotal: number;
  lineDiscount: number;
  lineTotal: number;
};

function isMissingColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; message?: string };
  return (
    candidate.code === "42703" ||
    /column .* does not exist/i.test(candidate.message ?? "")
  );
}

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function lineItemSubtotal(item: MixedCheckoutItem): number {
  const qty = toNumber(item.quantity, 1) || 1;
  const unit = toNumber(item.unit_price);
  const variantAdj = toNumber(item.variant_price_adjustment);
  const modifierAdj = toNumber(item.modifier_price_adjustment);
  return (unit + variantAdj + modifierAdj) * qty;
}

export function guardMixedCheckoutCart(input: {
  productIds: string[];
  warehouseByProduct: Map<string, string | null>;
  canSellMixed: boolean;
  hasSplits?: boolean;
}): MixedCheckoutGuardResult {
  for (const id of input.productIds) {
    const warehouseId = input.warehouseByProduct.get(id);
    if (!warehouseId) {
      return { ok: false, message: MISSING_PRODUCT_STALL_MESSAGE };
    }
  }

  const stallIds = uniqueStallIds(
    input.productIds.map((id) => input.warehouseByProduct.get(id) ?? null)
  );

  if (shouldCreateCheckout(stallIds) && !input.canSellMixed) {
    return { ok: false, message: MIXED_STALL_FORBIDDEN_MESSAGE };
  }
  if (shouldCreateCheckout(stallIds) && input.hasSplits) {
    return { ok: false, message: MIXED_SPLIT_UNSUPPORTED_MESSAGE };
  }

  return {
    ok: true,
    createCheckout: shouldCreateCheckout(stallIds),
    stallIds,
  };
}

export function groupItemsByStall<T>(
  items: T[],
  warehouseOf: (item: T) => string | null | undefined
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const warehouseId = warehouseOf(item);
    if (!warehouseId) continue;
    const list = grouped.get(warehouseId) ?? [];
    list.push(item);
    grouped.set(warehouseId, list);
  }
  return grouped;
}

export function shouldInsertCheckoutChildren(input: {
  paymentMethod: string;
  paymentStatus?: string | null;
  amountPaid: number;
  total: number;
}): boolean {
  if (String(input.paymentStatus || "").toLowerCase() === "unpaid") return false;
  if (input.paymentMethod === "qris" && input.amountPaid < input.total) return false;
  return true;
}

export function resolveOrderSoldFrom(input: { isCentralCashier: boolean }): "central" | "stall" {
  return input.isCentralCashier ? "central" : "stall";
}

export function shouldReuseCheckoutQris(checkout: {
  xendit_qr_id?: string | null;
  xendit_external_id?: string | null;
}): boolean {
  return resolveCheckoutQrisAction(checkout) !== "create";
}

export function resolveCheckoutQrisAction(checkout: {
  xendit_qr_id?: string | null;
  xendit_external_id?: string | null;
}): "reuse_qr_id" | "lookup_external_id" | "create" {
  if (checkout.xendit_qr_id) return "reuse_qr_id";
  if (checkout.xendit_external_id) return "lookup_external_id";
  return "create";
}

export function rejectUnsupportedMixedTender(
  paymentMethod: string
): { ok: true } | { ok: false; message: string } {
  if (paymentMethod === "nfc_tab" || paymentMethod === "gift_card") {
    return { ok: false, message: MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE };
  }
  return { ok: true };
}

export function resolveLineWarehouse(
  item: MixedCheckoutItem,
  warehouseByProduct: Map<string, string | null>
): string {
  const productId = String(item.product_id || "");
  return warehouseByProduct.get(productId) || "";
}

export function allocateCheckoutTender(amountPaid: number, childTotals: number[]): number[] {
  return allocateAmount(amountPaid, childTotals);
}

export function settleMixedCheckoutTender(input: {
  totalAmount: number;
  amountPaid?: number;
}): { amountPaid: number; changeAmount: number } {
  const amountPaid =
    input.amountPaid != null && Number.isFinite(input.amountPaid)
      ? input.amountPaid
      : input.totalAmount;
  return {
    amountPaid,
    changeAmount: Math.max(0, amountPaid - input.totalAmount),
  };
}

export function assertCheckoutQrisReadyToComplete(input: {
  xenditQrId?: string | null;
  xenditExternalId?: string | null;
  paid: boolean;
}): { ok: true } | { ok: false; message: string } {
  if (!input.xenditQrId && !input.xenditExternalId) {
    return { ok: false, message: CHECKOUT_QRIS_MISSING_MESSAGE };
  }
  if (!input.paid) {
    return { ok: false, message: CHECKOUT_QRIS_UNPAID_MESSAGE };
  }
  return { ok: true };
}

export function shouldSyncCustomerStatsOnFinalize(input: {
  alreadyHadChildren: boolean;
}): boolean {
  return !input.alreadyHadChildren;
}

function allocateAmount(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => Math.floor((total * w) / sum));
  const remainder = total - raw.reduce((a, b) => a + b, 0);
  const largest = weights.indexOf(Math.max(...weights));
  if (remainder !== 0 && largest >= 0) raw[largest] += remainder;
  return raw;
}

function buildLines(
  items: MixedCheckoutItem[],
  warehouseByProduct: Map<string, string | null>
): BuiltLine[] {
  return items.map((item) => {
    const warehouseId = resolveLineWarehouse(item, warehouseByProduct);
    const qty = toNumber(item.quantity, 1) || 1;
    const unitPrice =
      toNumber(item.unit_price) +
      toNumber(item.variant_price_adjustment) +
      toNumber(item.modifier_price_adjustment);
    const lineSubtotal = unitPrice * qty;
    const lineDiscount = Math.max(0, toNumber(item.discount_amount));
    return {
      ...item,
      warehouseId,
      qty,
      unitPrice,
      lineSubtotal,
      lineDiscount,
      lineTotal: Math.max(0, lineSubtotal - lineDiscount),
    };
  });
}

async function nextCheckoutNumber(client: PoolClient): Promise<string> {
  const prefixRes = await client.query<{ prefix: string }>(
    `SELECT 'CHK-' || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD') AS prefix`
  );
  const prefix = prefixRes.rows[0]?.prefix || "CHK-00000000";
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `pos_checkout_number:${prefix}`,
  ]);
  const seqRes = await client.query<{ seq: number }>(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(checkout_number FROM LENGTH($1) + 2) AS integer)), 0) + 1 AS seq
     FROM pos.pos_checkouts
     WHERE checkout_number LIKE $1 || '-%'`,
    [prefix]
  );
  const seq = Number(seqRes.rows[0]?.seq) || 1;
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

async function generateOrderNumber(client: PoolClient): Promise<string> {
  const result = await client.query<{ value: string }>(
    "SELECT generate_order_number() AS value"
  );
  return String(result.rows[0]?.value || "");
}

async function generateQueueNumber(
  client: PoolClient,
  companyId: string | null,
  branchId: string | null
): Promise<string> {
  const result = await client.query<{ value: string }>(
    "SELECT generate_queue_number($1, $2) AS value",
    [companyId, branchId]
  );
  return result.rows[0]?.value != null ? String(result.rows[0].value) : "";
}

type CheckoutRow = {
  id: string;
  checkout_number: string;
  queue_number: string | null;
  payment_status: string;
  payment_method: string | null;
  company_id: string | null;
  branch_id: string | null;
  table_id: string | null;
  customer_id: string | null;
  cashier_id: string;
  shift_id: string | null;
  subtotal: string | number;
  discount_amount: string | number;
  tax_amount: string | number;
  service_charge_amount: string | number;
  other_charges_amount: string | number;
  total_amount: string | number;
  amount_paid: string | number;
  change_amount: string | number;
  ark_coins_used?: string | number | null;
  notes: string | null;
  cart_snapshot?: MixedCheckoutCartSnapshot | null;
  xendit_qr_id?: string | null;
  xendit_external_id?: string | null;
};

async function loadCheckout(
  client: PoolClient,
  checkoutId: string
): Promise<CheckoutRow | null> {
  try {
    const result = await client.query<CheckoutRow>(
      `SELECT id, checkout_number, queue_number, payment_status, payment_method,
              company_id, branch_id, table_id, customer_id, cashier_id, shift_id,
              subtotal, discount_amount, tax_amount, service_charge_amount,
              other_charges_amount, total_amount, amount_paid, change_amount,
              notes, cart_snapshot, xendit_qr_id, xendit_external_id
       FROM pos.pos_checkouts
       WHERE id = $1
       FOR UPDATE`,
      [checkoutId]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    const result = await client.query<CheckoutRow>(
      `SELECT id, checkout_number, queue_number, payment_status, payment_method,
              company_id, branch_id, table_id, customer_id, cashier_id, shift_id,
              subtotal, discount_amount, tax_amount, service_charge_amount,
              other_charges_amount, total_amount, amount_paid, change_amount,
              notes
       FROM pos.pos_checkouts
       WHERE id = $1
       FOR UPDATE`,
      [checkoutId]
    );
    return result.rows[0] ?? null;
  }
}

async function insertCheckout(
  client: PoolClient,
  row: {
    checkoutNumber: string;
    queueNumber: string;
    companyId: string | null;
    branchId: string | null;
    tableId: string | null;
    customerId: string | null;
    cashierId: string;
    shiftId: string | null;
    paymentMethod: string;
    paymentStatus: string;
    subtotal: number;
    discountAmount: number;
    taxAmount: number;
    serviceChargeAmount: number;
    otherChargesAmount: number;
    totalAmount: number;
    amountPaid: number;
    changeAmount: number;
    notes: string | null;
    snapshot: MixedCheckoutCartSnapshot;
  }
): Promise<{ id: string; checkout_number: string; queue_number: string | null }> {
  const params = [
    row.checkoutNumber,
    row.queueNumber,
    row.companyId,
    row.branchId,
    row.tableId,
    row.customerId,
    row.cashierId,
    row.shiftId,
    row.paymentMethod,
    row.paymentStatus,
    row.subtotal,
    row.discountAmount,
    row.taxAmount,
    row.serviceChargeAmount,
    row.otherChargesAmount,
    row.totalAmount,
    row.amountPaid,
    row.changeAmount,
    row.notes,
    JSON.stringify(row.snapshot),
  ];
  try {
    const result = await client.query<{
      id: string;
      checkout_number: string;
      queue_number: string | null;
    }>(
      `INSERT INTO pos.pos_checkouts (
         checkout_number, queue_number, company_id, branch_id, table_id, customer_id,
         cashier_id, shift_id, payment_method, payment_status, subtotal, discount_amount,
         tax_amount, service_charge_amount, other_charges_amount, total_amount,
         amount_paid, change_amount, notes, cart_snapshot
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9::pos_payment_method,$10::pos_payment_status,
         $11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb
       )
       RETURNING id, checkout_number, queue_number`,
      params
    );
    const inserted = result.rows[0];
    if (!inserted) throw new MixedCheckoutError("Gagal membuat checkout", 500);
    return inserted;
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    const result = await client.query<{
      id: string;
      checkout_number: string;
      queue_number: string | null;
    }>(
      `INSERT INTO pos.pos_checkouts (
         checkout_number, queue_number, company_id, branch_id, table_id, customer_id,
         cashier_id, shift_id, payment_method, payment_status, subtotal, discount_amount,
         tax_amount, service_charge_amount, other_charges_amount, total_amount,
         amount_paid, change_amount, notes
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9::pos_payment_method,$10::pos_payment_status,
         $11,$12,$13,$14,$15,$16,$17,$18,$19
       )
       RETURNING id, checkout_number, queue_number`,
      params.slice(0, 19)
    );
    const inserted = result.rows[0];
    if (!inserted) throw new MixedCheckoutError("Gagal membuat checkout", 500);
    return inserted;
  }
}

async function insertChildOrder(
  client: PoolClient,
  row: {
    orderNumber: string;
    queueNumber: string;
    orderType: string;
    paymentStatus: string;
    paymentMethod: string;
    companyId: string | null;
    branchId: string | null;
    warehouseId: string;
    checkoutId: string;
    customerId: string | null;
    cashierId: string;
    serverId: string | null;
    tableId: string | null;
    guestCount: number;
    shiftId: string | null;
    subtotal: number;
    discount: number;
    discountReason: string | null;
    tax: number;
    serviceCharge: number;
    otherCharges: number;
    total: number;
    amountPaid: number;
    changeAmount: number;
    notes: string | null;
    specialRequests: string | null;
  }
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO pos.pos_orders (
       id, order_number, queue_number, order_type, status, payment_status, payment_method,
       company_id, branch_id, warehouse_id, checkout_id, sold_from,
       customer_id, cashier_id, server_id, table_id, guest_count, shift_id,
       subtotal, discount_amount, discount_reason, tax_amount, service_charge_amount,
       other_charges_amount, charges_breakdown, total_amount, amount_paid, change_amount,
       notes, special_requests, ordered_at
     ) VALUES (
       $1,$2,$3,$4::pos_order_type,'pending',$5::pos_payment_status,$6::pos_payment_method,
       $7,$8,$9,$10,'central',
       $11,$12,$13,$14,$15,$16,
       $17,$18,$19,$20,$21,
       $22,'[]'::jsonb,$23,$24,$25,
       $26,$27, now()
     )`,
    [
      id,
      row.orderNumber,
      row.queueNumber,
      row.orderType,
      row.paymentStatus,
      row.paymentMethod,
      row.companyId,
      row.branchId,
      row.warehouseId,
      row.checkoutId,
      row.customerId,
      row.cashierId,
      row.serverId,
      row.tableId,
      row.guestCount,
      row.shiftId,
      row.subtotal,
      row.discount,
      row.discountReason,
      row.tax,
      row.serviceCharge,
      row.otherCharges,
      row.total,
      row.amountPaid,
      row.changeAmount,
      row.notes,
      row.specialRequests,
    ]
  );
  return id;
}

async function insertChildItems(
  client: PoolClient,
  orderId: string,
  lines: BuiltLine[],
  costMap: Map<string, { cost_price?: number | string | null }>,
  merchClaimedIds: Set<string>
) {
  for (const line of lines) {
    const costSnapshot = buildCostSnapshot(
      line.product_id ? costMap.get(line.product_id) : undefined,
      line.qty,
      line.lineTotal
    );
    const discType =
      line.discount_type === "percent" || line.discount_type === "fixed"
        ? line.discount_type
        : null;
    const discValue =
      line.discount_value == null || line.discount_value === ""
        ? null
        : toNumber(line.discount_value);
    const station = normalizeStation(line.station, String(line.product_name || ""), "");
    await client.query(
      `INSERT INTO pos.pos_order_items (
         order_id, product_id, sku_id, product_name, product_sku, variants, modifiers,
         quantity, unit_price, subtotal, discount_type, discount_value, discount_amount,
         total_amount, xp_earned, station, kitchen_status, inventory_deducted,
         cost_price, cost_total, gross_profit, gross_margin_pct
       ) VALUES (
         $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,
         $8,$9,$10,$11,$12,$13,
         $14,0,$15,'pending',$16,
         $17,$18,$19,$20
       )`,
      [
        orderId,
        line.product_id || null,
        line.sku_id || null,
        line.product_name || "Unknown",
        String(line.product_sku || line.product_id || "").slice(0, 50),
        JSON.stringify(line.variants || []),
        JSON.stringify(line.modifiers || []),
        line.qty,
        line.unitPrice,
        line.lineSubtotal,
        discType,
        discValue,
        line.lineDiscount,
        line.lineTotal,
        station,
        line.product_id ? merchClaimedIds.has(String(line.product_id)) : false,
        costSnapshot.cost_price,
        costSnapshot.cost_total,
        costSnapshot.gross_profit,
        costSnapshot.gross_margin_pct,
      ]
    );
  }
}

async function insertChildrenForCheckout(
  client: PoolClient,
  input: {
    checkout: {
      id: string;
      queue_number: string | null;
      payment_status: string;
      payment_method: string | null;
      company_id: string | null;
      branch_id: string | null;
      table_id: string | null;
      customer_id: string | null;
      cashier_id: string;
      shift_id: string | null;
      discount_amount: string | number;
      tax_amount: string | number;
      service_charge_amount: string | number;
      other_charges_amount: string | number;
      amount_paid: string | number;
      change_amount: string | number;
    };
    snapshot: MixedCheckoutCartSnapshot;
    warehouseByProduct: Map<string, string | null>;
    merchClaimedIds: Set<string>;
    costMap: Map<string, { cost_price?: number | string | null }>;
  }
): Promise<string[]> {
  const lines = buildLines(input.snapshot.items, input.warehouseByProduct);
  const grouped = groupItemsByStall(lines, (line) => line.warehouseId);
  const slices = [...grouped.entries()].map(([warehouseId, stallLines]) => ({
    warehouseId,
    subtotal: stallLines.reduce((sum, line) => sum + line.lineSubtotal, 0),
    lines: stallLines,
  }));
  if (slices.length < 2) {
    throw new MixedCheckoutError("Checkout multi-stall membutuhkan item dari minimal 2 stall");
  }

  const allocated = allocateCheckoutCharges({
    slices: slices.map((slice) => ({
      warehouseId: slice.warehouseId,
      subtotal: slice.subtotal,
    })),
    discount: toNumber(input.checkout.discount_amount),
    tax: toNumber(input.checkout.tax_amount),
    serviceCharge: toNumber(input.checkout.service_charge_amount),
    otherCharges: toNumber(input.checkout.other_charges_amount),
  });
  const paidParts = allocateCheckoutTender(
    toNumber(input.checkout.amount_paid),
    allocated.map((row) => row.total)
  );
  const queueNumber = String(input.checkout.queue_number || "");
  const orderIds: string[] = [];

  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index];
    const charges = allocated[index];
    if (!slice || !charges) continue;
    const orderNumber = await generateOrderNumber(client);
    const orderId = await insertChildOrder(client, {
      orderNumber,
      queueNumber,
      orderType: input.snapshot.orderType,
      paymentStatus: input.checkout.payment_status,
      paymentMethod: input.checkout.payment_method || "cash",
      companyId: input.checkout.company_id,
      branchId: input.checkout.branch_id,
      warehouseId: slice.warehouseId,
      checkoutId: input.checkout.id,
      customerId: input.checkout.customer_id,
      cashierId: input.checkout.cashier_id,
      serverId: input.snapshot.serverId,
      tableId: input.checkout.table_id,
      guestCount: input.snapshot.guestCount,
      shiftId: input.checkout.shift_id,
      subtotal: slice.subtotal,
      discount: charges.discount,
      discountReason: input.snapshot.discountReason,
      tax: charges.tax,
      serviceCharge: charges.serviceCharge,
      otherCharges: charges.otherCharges,
      total: charges.total,
      amountPaid: paidParts[index] ?? 0,
      changeAmount: index === 0 ? toNumber(input.checkout.change_amount) : 0,
      notes: input.snapshot.notes,
      specialRequests: input.snapshot.specialRequests,
    });
    await insertChildItems(
      client,
      orderId,
      slice.lines,
      input.costMap,
      input.merchClaimedIds
    );
    await client.query(
      `INSERT INTO pos.pos_order_status_history (order_id, from_status, to_status, changed_by, notes)
       VALUES ($1, NULL, 'pending', $2, $3)`,
      [
        orderId,
        input.checkout.cashier_id,
        input.checkout.payment_status === "paid"
          ? "Order created and paid from central checkout"
          : "Order created from central checkout",
      ]
    );
    orderIds.push(orderId);
  }

  return orderIds;
}

async function finalizePaidChildren(input: {
  orderIds: string[];
  customerId?: string | null;
  sessionUserId: string;
  paymentMethod: string;
  branchId?: string | null;
  alreadyHadChildren?: boolean;
}) {
  if (input.orderIds.length === 0) return;
  const db = createPgClient();
  const { data: orders } = await db
    .from("pos_orders")
    .select("id, order_number, queue_number, order_type, table_id, total_amount, warehouse_id")
    .in("id", input.orderIds);

  const { data: itemRows } = await db
    .from("pos_order_items")
    .select(
      "id, order_id, product_id, product_name, product_sku, variants, modifiers, quantity, unit_price, total_amount, station"
    )
    .in("order_id", input.orderIds);

  const itemsByOrder = new Map<string, typeof itemRows>();
  for (const row of itemRows || []) {
    const list = itemsByOrder.get(String(row.order_id)) ?? [];
    list.push(row);
    itemsByOrder.set(String(row.order_id), list);
  }

  for (const order of orders || []) {
    const childItems = itemsByOrder.get(String(order.id)) || [];
    const { data: existingJobs } = await db
      .from("pos_print_jobs")
      .select("id")
      .eq("order_id", String(order.id))
      .limit(1);
    if (existingJobs && existingJobs.length > 0) continue;
    const printJobs = buildKitchenPrintJobs(order as Record<string, unknown>, childItems || []);
    if (printJobs.length > 0) {
      const { error: printJobError } = await db.from("pos_print_jobs").insert(printJobs);
      const duplicate =
        printJobError?.code === "23505" ||
        /duplicate key|unique/i.test(printJobError?.message ?? "");
      if (
        printJobError &&
        !duplicate &&
        printJobError.code !== "42P01" &&
        printJobError.code !== "PGRST205"
      ) {
        console.warn("[pos] mixed checkout print jobs:", printJobError.message);
      }
    }
  }

  if (
    input.customerId &&
    shouldSyncCustomerStatsOnFinalize({
      alreadyHadChildren: Boolean(input.alreadyHadChildren),
    })
  ) {
    const total = (orders || []).reduce(
      (sum, order) => sum + toNumber(order.total_amount),
      0
    );
    await syncPosCustomerOrderStats(db, input.customerId, total);
  }

  for (const order of orders || []) {
    const childItems = itemsByOrder.get(String(order.id)) || [];
    await awardCrmXpForPosOrder(db, {
      orderId: String(order.id),
      customerId: input.customerId || null,
      totalAmount: toNumber(order.total_amount),
      items: childItems || [],
      outletId: input.branchId,
      paymentMethod: input.paymentMethod,
    });
    try {
      const { postPosSaleAccountingJournals } = await import("@/lib/pos/accounting-posting");
      await postPosSaleAccountingJournals({
        db,
        orderId: String(order.id),
        userId: input.sessionUserId,
        paymentMethod: input.paymentMethod,
      });
    } catch (err) {
      if (err instanceof AccountingPostError) {
        console.error(`[pos] accounting post failed: order=${order.id}:`, err);
      } else {
        throw err;
      }
    }
  }
}

function snapshotFromInput(
  input: CreateMixedCheckoutInput,
  lines: BuiltLine[]
): MixedCheckoutCartSnapshot {
  const warehouseByProduct: Record<string, string> = {};
  for (const line of lines) {
    if (line.product_id) warehouseByProduct[line.product_id] = line.warehouseId;
  }
  return {
    items: lines.map((line) => ({
      ...line,
      warehouse_id: line.warehouseId,
    })),
    warehouseByProduct,
    orderType: input.orderType || "dine_in",
    guestCount: normalizeGuestCount(input.guestCount),
    notes: input.notes || null,
    specialRequests: input.specialRequests || null,
    chargesBreakdown: Array.isArray(input.chargesBreakdown) ? input.chargesBreakdown : [],
    cashierId: input.cashierId,
    serverId: input.serverId || null,
    sessionUserId: input.sessionUserId,
    discountReason: input.discountReason || null,
  };
}

export async function createMixedCheckout(
  input: CreateMixedCheckoutInput
): Promise<MixedCheckoutResult> {
  const lines = buildLines(input.items, input.warehouseByProduct);
  const missing = lines.find((line) => !line.warehouseId);
  if (missing) {
    throw new MixedCheckoutError(MISSING_PRODUCT_STALL_MESSAGE);
  }

  const stallIds = uniqueStallIds(lines.map((line) => line.warehouseId));
  if (!shouldCreateCheckout(stallIds)) {
    throw new MixedCheckoutError("Checkout multi-stall membutuhkan item dari minimal 2 stall");
  }

  const grouped = groupItemsByStall(lines, (line) => line.warehouseId);
  const slices = stallIds.map((warehouseId) => ({
    warehouseId,
    subtotal: (grouped.get(warehouseId) || []).reduce(
      (sum, line) => sum + line.lineSubtotal,
      0
    ),
  }));
  const discountAmount = toNumber(input.discountAmount);
  const taxAmount = toNumber(input.taxAmount);
  const serviceChargeAmount = toNumber(input.serviceChargeAmount);
  const otherChargesAmount = toNumber(input.otherChargesAmount);
  const allocated = allocateCheckoutCharges({
    slices,
    discount: discountAmount,
    tax: taxAmount,
    serviceCharge: serviceChargeAmount,
    otherCharges: otherChargesAmount,
  });
  const serverSubtotal = slices.reduce((sum, slice) => sum + slice.subtotal, 0);
  const serverTotal = allocated.reduce((sum, row) => sum + row.total, 0);
  const paymentMethod = input.paymentMethod || "cash";
  const tenderGuard = rejectUnsupportedMixedTender(paymentMethod);
  if (!tenderGuard.ok) {
    throw new MixedCheckoutError(tenderGuard.message);
  }
  const amountPaid = toNumber(input.amountPaid);
  const arkUsed = toNumber(input.arkCoinsUsed);
  const insertChildren = shouldInsertCheckoutChildren({
    paymentMethod,
    paymentStatus: input.paymentStatus,
    amountPaid: amountPaid + arkUsed,
    total: serverTotal,
  });
  const paymentStatus = insertChildren ? "paid" : "unpaid";

  if (insertChildren && amountPaid + arkUsed < serverTotal) {
    throw new MixedCheckoutError("Payment insufficient");
  }
  if (paymentMethod === "ark_coin") {
    if (!input.customerId) {
      throw new MixedCheckoutError("Pembayaran ARK Coin membutuhkan customer");
    }
    if (arkUsed < serverTotal) {
      throw new MixedCheckoutError("Pembayaran ARK Coin harus menutup seluruh total order");
    }
  }

  const db = createPgClient();
  const venue = await getCrmDefaultVenue(db);
  const companyId = input.companyId || venue.companyId;
  const branchId = input.branchId || venue.branchId;
  const snapshot = snapshotFromInput(input, lines);
  const changeAmount = Math.max(0, amountPaid + arkUsed - serverTotal);

  let merchClaims: MerchStockClaim[] = [];
  let merchClaimedIds = new Set<string>();
  if (insertChildren) {
    const merchClaimResult = await claimMerchandiseStock(db, input.items);
    if (!merchClaimResult.ok) {
      throw new MixedCheckoutError(merchClaimResult.reason, merchClaimResult.status);
    }
    merchClaims = merchClaimResult.claims;
    merchClaimedIds = new Set(merchClaims.map((claim) => claim.productId));
  }

  const costMap = insertChildren
    ? await loadPosProductCostMap(
        db,
        input.items.map((item) => String(item.product_id || "")).filter(Boolean)
      )
    : new Map();

  try {
    const created = await withTransaction(async (client) => {
      const checkoutNumber = await nextCheckoutNumber(client);
      const queueNumber = await generateQueueNumber(client, companyId, branchId);
      const checkout = await insertCheckout(client, {
        checkoutNumber,
        queueNumber,
        companyId,
        branchId,
        tableId: input.tableId || null,
        customerId: input.customerId || null,
        cashierId: input.cashierId,
        shiftId: input.shiftId || null,
        paymentMethod,
        paymentStatus,
        subtotal: serverSubtotal,
        discountAmount,
        taxAmount,
        serviceChargeAmount,
        otherChargesAmount,
        totalAmount: serverTotal,
        amountPaid,
        changeAmount,
        notes: input.notes || null,
        snapshot,
      });

      let orderIds: string[] = [];
      if (insertChildren) {
        orderIds = await insertChildrenForCheckout(client, {
          checkout: {
            id: checkout.id,
            queue_number: checkout.queue_number,
            payment_status: paymentStatus,
            payment_method: paymentMethod,
            company_id: companyId,
            branch_id: branchId,
            table_id: input.tableId || null,
            customer_id: input.customerId || null,
            cashier_id: input.cashierId,
            shift_id: input.shiftId || null,
            discount_amount: discountAmount,
            tax_amount: taxAmount,
            service_charge_amount: serviceChargeAmount,
            other_charges_amount: otherChargesAmount,
            amount_paid: amountPaid,
            change_amount: changeAmount,
          },
          snapshot,
          warehouseByProduct: input.warehouseByProduct,
          merchClaimedIds,
          costMap,
        });
      }

      return {
        checkoutId: checkout.id,
        checkoutNumber: checkout.checkout_number,
        queueNumber: checkout.queue_number || queueNumber,
        orderIds,
      };
    });

    if (paymentMethod === "ark_coin" && input.customerId && created.orderIds[0]) {
      const { error: coinError } = await db.rpc("update_ark_coin_balance", {
        p_customer_id: input.customerId,
        p_amount: -arkUsed,
        p_type: "payment",
        p_order_id: created.orderIds[0],
      });
      if (coinError) {
        await withTransaction(async (client) => {
          if (created.orderIds.length > 0) {
            await client.query(
              `DELETE FROM pos.pos_print_jobs WHERE order_id = ANY($1::uuid[])`,
              [created.orderIds]
            ).catch(() => {});
            await client.query(
              `DELETE FROM pos.pos_order_status_history WHERE order_id = ANY($1::uuid[])`,
              [created.orderIds]
            );
            await client.query(
              `DELETE FROM pos.pos_order_items WHERE order_id = ANY($1::uuid[])`,
              [created.orderIds]
            );
            await client.query(`DELETE FROM pos.pos_orders WHERE checkout_id = $1`, [
              created.checkoutId,
            ]);
          }
          await client.query(`DELETE FROM pos.pos_checkouts WHERE id = $1`, [
            created.checkoutId,
          ]);
        }).catch((cleanupErr) =>
          console.error("[pos] mixed checkout ARK compensation failed:", cleanupErr)
        );
        throw new MixedCheckoutError(
          coinError.message?.includes("Insufficient")
            ? "Saldo ARK Coin tidak cukup"
            : "Gagal memproses ARK Coin"
        );
      }
    }

    merchClaims = [];

    if (insertChildren) {
      await finalizePaidChildren({
        orderIds: created.orderIds,
        customerId: input.customerId,
        sessionUserId: input.sessionUserId,
        paymentMethod,
        branchId,
      });
    }

    return created;
  } catch (error) {
    if (merchClaims.length > 0) {
      await restoreMerchandiseStock(db, merchClaims).catch((restoreErr) =>
        console.error("[pos] mixed checkout merch restore failed:", restoreErr)
      );
    }
    throw error;
  }
}

function parseSnapshot(checkout: CheckoutRow): MixedCheckoutCartSnapshot | null {
  const raw = checkout.cart_snapshot as unknown;
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as MixedCheckoutCartSnapshot;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as MixedCheckoutCartSnapshot;
  return null;
}

async function confirmStoredCheckoutQrisPaid(input: {
  xenditQrId?: string | null;
  xenditExternalId?: string | null;
}) {
  const hasQr = assertCheckoutQrisReadyToComplete({
    xenditQrId: input.xenditQrId,
    xenditExternalId: input.xenditExternalId,
    paid: true,
  });
  if (!hasQr.ok) {
    throw new MixedCheckoutError(hasQr.message, 409);
  }

  const xendit = await loadActiveXenditConfig();
  let qrId = String(input.xenditQrId || "");
  let remote: Record<string, unknown>;
  if (qrId) {
    remote = await getXenditQrCode(xendit.secretKey, qrId);
  } else {
    remote = await getXenditQrCodeByReferenceId(
      xendit.secretKey,
      String(input.xenditExternalId)
    );
    qrId = String(remote.id || "");
  }

  let paid = isXenditQrPaid(remote);
  if (!paid && qrId) {
    try {
      const payments = await getXenditQrPayments(xendit.secretKey, qrId);
      paid = isXenditQrPaid({ payments });
    } catch {
      // payments endpoint is optional; QR detail may already be enough
    }
  }

  const ready = assertCheckoutQrisReadyToComplete({
    xenditQrId: input.xenditQrId || qrId,
    xenditExternalId: input.xenditExternalId,
    paid,
  });
  if (!ready.ok) {
    throw new MixedCheckoutError(ready.message, 409);
  }
}

export async function completeMixedCheckout(
  checkoutId: string
): Promise<{ orderIds: string[] }> {
  const db = createPgClient();

  const existing = await db
    .from("pos_orders")
    .select("id")
    .eq("checkout_id", checkoutId);
  const existingIds = ((existing.data || []) as Array<{ id: string }>).map((row) =>
    String(row.id)
  );

  const { data: preview, error: previewError } = await db
    .from("pos_checkouts")
    .select(
      "id, customer_id, cashier_id, payment_method, branch_id, cart_snapshot, xendit_qr_id, xendit_external_id"
    )
    .eq("id", checkoutId)
    .maybeSingle();
  if (previewError) throw previewError;
  if (!preview) {
    throw new MixedCheckoutError("Checkout tidak ditemukan", 404);
  }

  const previewSnapshot = parseSnapshot(preview as CheckoutRow);

  if (existingIds.length > 0) {
    await finalizePaidChildren({
      orderIds: existingIds,
      customerId: preview.customer_id,
      sessionUserId: previewSnapshot?.sessionUserId || String(preview.cashier_id || ""),
      paymentMethod: String(preview.payment_method || "qris"),
      branchId: preview.branch_id,
      alreadyHadChildren: true,
    });
    return { orderIds: existingIds };
  }

  await confirmStoredCheckoutQrisPaid({
    xenditQrId: preview.xendit_qr_id,
    xenditExternalId: preview.xendit_external_id,
  });

  let merchClaims: MerchStockClaim[] = [];
  try {
    const created = await withTransaction(async (client) => {
      const checkout = await loadCheckout(client, checkoutId);
      if (!checkout) {
        throw new MixedCheckoutError("Checkout tidak ditemukan", 404);
      }
      const already = await client.query<{ id: string }>(
        `SELECT id FROM pos.pos_orders WHERE checkout_id = $1`,
        [checkoutId]
      );
      if (already.rows.length > 0) {
        return {
          orderIds: already.rows.map((row) => row.id),
          snapshot: parseSnapshot(checkout),
          checkout,
          reusedExistingChildren: true,
        };
      }

      const snapshot = parseSnapshot(checkout);
      if (!snapshot?.items?.length) {
        throw new MixedCheckoutError("Checkout tidak punya item untuk diselesaikan", 409);
      }

      const settled = settleMixedCheckoutTender({
        totalAmount: toNumber(checkout.total_amount),
      });
      await client.query(
        `UPDATE pos.pos_checkouts
         SET payment_status = 'paid',
             amount_paid = $2,
             change_amount = $3,
             updated_at = now()
         WHERE id = $1`,
        [checkoutId, settled.amountPaid, settled.changeAmount]
      );

      const warehouseByProduct = new Map(
        Object.entries(snapshot.warehouseByProduct || {})
      );
      const merchClaimResult = await claimMerchandiseStock(db, snapshot.items);
      if (!merchClaimResult.ok) {
        throw new MixedCheckoutError(merchClaimResult.reason, merchClaimResult.status);
      }
      merchClaims = merchClaimResult.claims;
      const costMap = await loadPosProductCostMap(
        db,
        snapshot.items.map((item) => String(item.product_id || "")).filter(Boolean)
      );
      const settledCheckout = {
        ...checkout,
        payment_status: "paid",
        amount_paid: settled.amountPaid,
        change_amount: settled.changeAmount,
      };
      const orderIds = await insertChildrenForCheckout(client, {
        checkout: settledCheckout,
        snapshot,
        warehouseByProduct,
        merchClaimedIds: new Set(merchClaims.map((claim) => claim.productId)),
        costMap,
      });
      return { orderIds, snapshot, checkout: settledCheckout, reusedExistingChildren: false };
    });

    merchClaims = [];
    await finalizePaidChildren({
      orderIds: created.orderIds,
      customerId: created.checkout.customer_id,
      sessionUserId: created.snapshot?.sessionUserId || created.checkout.cashier_id,
      paymentMethod: created.checkout.payment_method || "qris",
      branchId: created.checkout.branch_id,
      alreadyHadChildren: created.reusedExistingChildren,
    });
    return { orderIds: created.orderIds };
  } catch (error) {
    if (merchClaims.length > 0) {
      await restoreMerchandiseStock(db, merchClaims).catch((restoreErr) =>
        console.error("[pos] complete mixed merch restore failed:", restoreErr)
      );
    }
    throw error;
  }
}
