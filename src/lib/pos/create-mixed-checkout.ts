import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { withTransaction } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { awardCrmXpForPosOrder, syncPosCustomerOrderStats } from "@/lib/crm/loyalty-engine";
import { AccountingPostError } from "@/lib/pos/accounting-posting";
import {
  MIXED_ARK_UNSUPPORTED_MESSAGE,
  MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE,
  MIXED_PROMO_UNSUPPORTED_MESSAGE,
  MIXED_SPLIT_UNSUPPORTED_MESSAGE,
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
import {
  planCheckoutAppend,
  resolvePaidMixedOnOccupiedTable,
  resolveTableSaleTarget,
} from "@/lib/pos/table-sale-target";
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
import { resolvePaymentCatalogStamp } from "@/lib/pos/payment-methods";

export {
  MIXED_ARK_UNSUPPORTED_MESSAGE,
  MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE,
  MIXED_PROMO_UNSUPPORTED_MESSAGE,
  MIXED_SPLIT_UNSUPPORTED_MESSAGE,
} from "@/lib/pos/central-cashier";

export const CHECKOUT_CANCELLED_NOTE = "cancelled";
export const CHECKOUT_CANCEL_HAS_CHILDREN_MESSAGE =
  "Checkout dengan pesanan tidak bisa dibatalkan";
export const CHECKOUT_CANCEL_PAID_MESSAGE = "Checkout sudah lunas";

export const MIXED_STALL_FORBIDDEN_MESSAGE =
  "Keranjang campur stall hanya untuk kasir pusat";
export const MISSING_PRODUCT_STALL_MESSAGE =
  "Ada produk tanpa stall — tidak bisa dimasukkan ke keranjang";
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
  promoCode?: string | null;
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
  /** Restaurant open-bill: insert unpaid children so KDS/floor can see them. */
  forceInsertChildren?: boolean;
  /** Append mixed items onto the table's existing unpaid central checkout. */
  reuseUnpaidTableCheckout?: boolean;
  paymentMethodCode?: string | null;
  paymentMethodName?: string | null;
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
    candidate.code === "PGRST204" ||
    /column .* does not exist/i.test(candidate.message ?? "")
  );
}

async function stampPaymentCatalog(
  client: PoolClient,
  input: {
    checkoutId?: string | null;
    orderIds?: string[];
    code?: string | null;
    name?: string | null;
  }
) {
  const stamp = resolvePaymentCatalogStamp({
    code: input.code,
    name: input.name,
  });
  if (!stamp.payment_method_code && !stamp.payment_method_name) return;
  try {
    if (input.checkoutId) {
      await client.query(
        `UPDATE pos.pos_checkouts
         SET payment_method_code = $2, payment_method_name = $3, updated_at = now()
         WHERE id = $1`,
        [input.checkoutId, stamp.payment_method_code, stamp.payment_method_name]
      );
    }
    if (input.orderIds && input.orderIds.length > 0) {
      await client.query(
        `UPDATE pos.pos_orders
         SET payment_method_code = $2, payment_method_name = $3, updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [input.orderIds, stamp.payment_method_code, stamp.payment_method_name]
      );
    }
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
  }
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

export function rejectMixedPromo(input: {
  discountAmount?: number | string | null;
  promoCode?: string | null;
}): { ok: true } | { ok: false; message: string } {
  if (String(input.promoCode || "").trim()) {
    return { ok: false, message: MIXED_PROMO_UNSUPPORTED_MESSAGE };
  }
  if (toNumber(input.discountAmount) > 0) {
    return { ok: false, message: MIXED_PROMO_UNSUPPORTED_MESSAGE };
  }
  return { ok: true };
}

export function guardMixedCheckoutCart(input: {
  productIds: string[];
  warehouseByProduct: Map<string, string | null>;
  canSellMixed: boolean;
  hasSplits?: boolean;
  discountAmount?: number | string | null;
  promoCode?: string | null;
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
  if (shouldCreateCheckout(stallIds)) {
    const promoGuard = rejectMixedPromo({
      discountAmount: input.discountAmount,
      promoCode: input.promoCode,
    });
    if (!promoGuard.ok) return promoGuard;
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

const CHECKOUT_BILL_METHODS = new Set(["cash", "qris", "credit", "debit", "credit_card"]);

export function resolveCheckoutBillTender(input: {
  paymentMethod?: string | null;
  amountPaid?: number | null;
  totalAmount: number;
}):
  | { ok: true; paymentMethod: string; amountPaid: number; changeAmount: number }
  | { ok: false; message: string } {
  const raw = String(input.paymentMethod || "").trim();
  if (!raw) {
    return { ok: false, message: "Metode pembayaran wajib" };
  }
  const unsupported = rejectUnsupportedMixedTender(raw);
  if (!unsupported.ok) return unsupported;
  if (raw === "ark_coin") {
    return { ok: false, message: MIXED_ARK_UNSUPPORTED_MESSAGE };
  }
  const paymentMethod = raw === "credit_card" ? "credit" : raw;
  if (!CHECKOUT_BILL_METHODS.has(raw) && !CHECKOUT_BILL_METHODS.has(paymentMethod)) {
    return { ok: false, message: "Metode pembayaran tidak didukung untuk tagihan checkout" };
  }
  if (input.amountPaid == null || !Number.isFinite(Number(input.amountPaid))) {
    return { ok: false, message: "Nominal pembayaran wajib" };
  }
  const settled = settleMixedCheckoutTender({
    totalAmount: input.totalAmount,
    amountPaid: Number(input.amountPaid),
  });
  if (settled.amountPaid < input.totalAmount) {
    return { ok: false, message: "Nominal tunai kurang dari total tagihan" };
  }
  return { ok: true, paymentMethod, ...settled };
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

export type XenditPaidWebhookAction =
  | { type: "credit_topup" }
  | { type: "complete_checkout"; checkoutId: string }
  | { type: "noop_checkout"; checkoutId: string }
  | { type: "ignore" };

export function resolveXenditPaidWebhookAction(input: {
  topupId?: string | null;
  checkoutId?: string | null;
  childCount: number;
}): XenditPaidWebhookAction {
  if (input.topupId) return { type: "credit_topup" };
  const checkoutId = String(input.checkoutId || "").trim();
  if (!checkoutId) return { type: "ignore" };
  if (input.childCount > 0) return { type: "noop_checkout", checkoutId };
  return { type: "complete_checkout", checkoutId };
}

export type CompleteMixedCheckoutTender = {
  paymentMethod?: string | null;
  amountPaid?: number | null;
  paymentMethodCode?: string | null;
  paymentMethodName?: string | null;
};

export type CompleteMixedCheckoutOptions = {
  /** Webhook already verified paid; skip Xendit GET re-confirm. */
  paymentAlreadyConfirmed?: boolean;
};

export function mustConfirmStoredCheckoutQris(input: {
  paymentMethod: string;
  paymentAlreadyConfirmed?: boolean;
  hasExistingChildren?: boolean;
}): boolean {
  void input.hasExistingChildren;
  return input.paymentMethod === "qris" && !input.paymentAlreadyConfirmed;
}

export function isCancelledCheckout(input: {
  notes?: string | null;
  table_id?: string | null;
}): boolean {
  return String(input.notes || "").trim().toLowerCase().startsWith(CHECKOUT_CANCELLED_NOTE);
}

export function canCancelUnpaidChildlessCheckout(input: {
  paymentStatus?: string | null;
  childCount: number;
  notes?: string | null;
}): { ok: true } | { ok: false; message: string } {
  if (isCancelledCheckout({ notes: input.notes })) {
    return { ok: true };
  }
  if (String(input.paymentStatus || "unpaid").toLowerCase() === "paid") {
    return { ok: false, message: CHECKOUT_CANCEL_PAID_MESSAGE };
  }
  if (input.childCount > 0) {
    return { ok: false, message: CHECKOUT_CANCEL_HAS_CHILDREN_MESSAGE };
  }
  return { ok: true };
}

export function unpaidChildlessCheckoutCancelPatch(): {
  table_id: null;
  notes: string;
} {
  return { table_id: null, notes: CHECKOUT_CANCELLED_NOTE };
}

export function unpaidCheckoutScopeSql(input: {
  companyId?: string | null;
  branchId?: string | null;
  startParam: number;
}): { sql: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  let index = input.startParam;
  if (input.companyId) {
    parts.push(`company_id = $${index++}`);
    params.push(input.companyId);
  }
  if (input.branchId) {
    parts.push(`branch_id = $${index++}`);
    params.push(input.branchId);
  }
  return {
    sql: parts.map((part) => ` AND ${part}`).join(""),
    params,
  };
}

export function resolveCompleteCheckoutTender(input: {
  tender?: CompleteMixedCheckoutTender;
  storedPaymentMethod?: string | null;
  totalAmount: number;
}): { paymentMethod: string | null; amountPaid: number } {
  const tender = input.tender || {};
  const paymentMethod = String(tender.paymentMethod || input.storedPaymentMethod || "").trim() || null;
  const amountPaid =
    tender.amountPaid != null && Number.isFinite(Number(tender.amountPaid))
      ? Number(tender.amountPaid)
      : input.totalAmount;
  return { paymentMethod, amountPaid };
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
  payment_method_code?: string | null;
  payment_method_name?: string | null;
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
              notes, cart_snapshot, xendit_qr_id, xendit_external_id,
              payment_method_code, payment_method_name
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

async function findUnpaidCheckoutByTable(
  client: PoolClient,
  tableId: string,
  scope: { companyId?: string | null; branchId?: string | null } = {}
): Promise<CheckoutRow | null> {
  try {
    const scoped = unpaidCheckoutScopeSql({
      companyId: scope.companyId,
      branchId: scope.branchId,
      startParam: 2,
    });
    const result = await client.query<CheckoutRow>(
      `SELECT id, checkout_number, queue_number, payment_status, payment_method,
              company_id, branch_id, table_id, customer_id, cashier_id, shift_id,
              subtotal, discount_amount, tax_amount, service_charge_amount,
              other_charges_amount, total_amount, amount_paid, change_amount,
              notes, cart_snapshot
       FROM pos.pos_checkouts
       WHERE table_id = $1
         AND LOWER(payment_status::text) <> 'paid'
         AND COALESCE(notes, '') NOT ILIKE 'cancelled%'
         ${scoped.sql}
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [tableId, ...scoped.params]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    return null;
  }
}

async function appendItemsToExistingCheckout(
  client: PoolClient,
  input: {
    existing: CheckoutRow;
    lines: BuiltLine[];
    snapshot: MixedCheckoutCartSnapshot;
    merchClaimedIds: Set<string>;
    costMap: Map<string, { cost_price?: number | string | null }>;
    discountAmount: number;
    taxAmount: number;
    serviceChargeAmount: number;
    otherChargesAmount: number;
    serverSubtotal: number;
    serverTotal: number;
    paymentStatus: string;
  }
): Promise<MixedCheckoutResult> {
  const grouped = groupItemsByStall(input.lines, (line) => line.warehouseId);
  const slices = [...grouped.entries()].map(([warehouseId, stallLines]) => ({
    warehouseId,
    subtotal: stallLines.reduce((sum, line) => sum + line.lineSubtotal, 0),
    lines: stallLines,
  }));
  const allocated = allocateCheckoutCharges({
    slices: slices.map((slice) => ({
      warehouseId: slice.warehouseId,
      subtotal: slice.subtotal,
    })),
    discount: input.discountAmount,
    tax: input.taxAmount,
    serviceCharge: input.serviceChargeAmount,
    otherCharges: input.otherChargesAmount,
  });

  const children = await client.query<{ id: string; warehouse_id: string | null }>(
    `SELECT id, warehouse_id FROM pos.pos_orders
     WHERE checkout_id = $1
       AND COALESCE(sold_from, 'stall') = 'central'
       AND status::text NOT IN ('completed', 'cancelled', 'voided', 'merged')
       AND LOWER(payment_status::text) <> 'paid'`,
    [input.existing.id]
  );
  const plan = planCheckoutAppend({
    incomingWarehouseIds: slices.map((slice) => slice.warehouseId),
    existingCentralChildren: children.rows,
  });
  const orderIds: string[] = [];

  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index];
    const charges = allocated[index];
    const planned = plan.children[index];
    if (!slice || !charges || !planned) continue;
    let orderId =
      planned.action === "append" ? planned.orderId : null;
    if (!orderId) {
      const orderNumber = await generateOrderNumber(client);
      orderId = await insertChildOrder(client, {
        orderNumber,
        queueNumber: String(input.existing.queue_number || ""),
        orderType: input.snapshot.orderType,
        paymentStatus: input.paymentStatus,
        paymentMethod: input.existing.payment_method || "cash",
        companyId: input.existing.company_id,
        branchId: input.existing.branch_id,
        warehouseId: slice.warehouseId,
        checkoutId: input.existing.id,
        customerId: input.existing.customer_id,
        cashierId: input.existing.cashier_id,
        serverId: input.snapshot.serverId,
        tableId: input.existing.table_id,
        guestCount: input.snapshot.guestCount,
        shiftId: input.existing.shift_id,
        subtotal: slice.subtotal,
        discount: charges.discount,
        discountReason: input.snapshot.discountReason,
        tax: charges.tax,
        serviceCharge: charges.serviceCharge,
        otherCharges: charges.otherCharges,
        total: charges.total,
        amountPaid: 0,
        changeAmount: 0,
        notes: input.snapshot.notes,
        specialRequests: input.snapshot.specialRequests,
      });
    } else {
      await client.query(
        `UPDATE pos.pos_orders SET
           subtotal = COALESCE(subtotal, 0) + $1,
           discount_amount = COALESCE(discount_amount, 0) + $2,
           tax_amount = COALESCE(tax_amount, 0) + $3,
           service_charge_amount = COALESCE(service_charge_amount, 0) + $4,
           other_charges_amount = COALESCE(other_charges_amount, 0) + $5,
           total_amount = COALESCE(total_amount, 0) + $6,
           updated_at = now()
         WHERE id = $7`,
        [
          slice.subtotal,
          charges.discount,
          charges.tax,
          charges.serviceCharge,
          charges.otherCharges,
          charges.total,
          orderId,
        ]
      );
    }
    await insertChildItems(
      client,
      orderId,
      slice.lines,
      input.costMap,
      input.merchClaimedIds
    );
    orderIds.push(orderId);
  }

  const prevSnapshot = parseSnapshot(input.existing);
  const mergedSnapshot: MixedCheckoutCartSnapshot = {
    ...input.snapshot,
    items: [...(prevSnapshot?.items || []), ...input.snapshot.items],
    warehouseByProduct: {
      ...(prevSnapshot?.warehouseByProduct || {}),
      ...input.snapshot.warehouseByProduct,
    },
  };

  try {
    await client.query(
      `UPDATE pos.pos_checkouts SET
         subtotal = COALESCE(subtotal, 0) + $1,
         discount_amount = COALESCE(discount_amount, 0) + $2,
         tax_amount = COALESCE(tax_amount, 0) + $3,
         service_charge_amount = COALESCE(service_charge_amount, 0) + $4,
         other_charges_amount = COALESCE(other_charges_amount, 0) + $5,
         total_amount = COALESCE(total_amount, 0) + $6,
         cart_snapshot = $7::jsonb,
         updated_at = now()
       WHERE id = $8`,
      [
        input.serverSubtotal,
        input.discountAmount,
        input.taxAmount,
        input.serviceChargeAmount,
        input.otherChargesAmount,
        input.serverTotal,
        JSON.stringify(mergedSnapshot),
        input.existing.id,
      ]
    );
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    await client.query(
      `UPDATE pos.pos_checkouts SET
         subtotal = COALESCE(subtotal, 0) + $1,
         discount_amount = COALESCE(discount_amount, 0) + $2,
         tax_amount = COALESCE(tax_amount, 0) + $3,
         service_charge_amount = COALESCE(service_charge_amount, 0) + $4,
         other_charges_amount = COALESCE(other_charges_amount, 0) + $5,
         total_amount = COALESCE(total_amount, 0) + $6,
         updated_at = now()
       WHERE id = $7`,
      [
        input.serverSubtotal,
        input.discountAmount,
        input.taxAmount,
        input.serviceChargeAmount,
        input.otherChargesAmount,
        input.serverTotal,
        input.existing.id,
      ]
    );
  }

  return {
    checkoutId: input.existing.id,
    checkoutNumber: input.existing.checkout_number,
    queueNumber: String(input.existing.queue_number || ""),
    orderIds,
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
  const canCreateFreshCheckout = shouldCreateCheckout(stallIds);
  if (
    !canCreateFreshCheckout &&
    !input.reuseUnpaidTableCheckout &&
    !input.tableId
  ) {
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
  const promoGuard = rejectMixedPromo({
    discountAmount,
    promoCode: input.promoCode,
  });
  if (promoGuard.ok === false) {
    throw new MixedCheckoutError(promoGuard.message);
  }
  if (lines.some((line) => line.lineDiscount > 0)) {
    throw new MixedCheckoutError(MIXED_PROMO_UNSUPPORTED_MESSAGE);
  }
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
  const requestedUnpaid =
    String(input.paymentStatus || "").toLowerCase() === "unpaid";
  const insertChildren =
    Boolean(input.forceInsertChildren) ||
    shouldInsertCheckoutChildren({
      paymentMethod,
      paymentStatus: input.paymentStatus,
      amountPaid: amountPaid + arkUsed,
      total: serverTotal,
    });
  const paymentStatus = requestedUnpaid
    ? "unpaid"
    : insertChildren
      ? "paid"
      : "unpaid";
  const isPaidSale = paymentStatus === "paid";

  if (isPaidSale && amountPaid + arkUsed < serverTotal) {
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
  if (isPaidSale) {
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
      if (input.tableId) {
        const existing = await findUnpaidCheckoutByTable(client, input.tableId, {
          companyId,
          branchId,
        });
        if (!requestedUnpaid) {
          const paidTarget = resolvePaidMixedOnOccupiedTable({
            unpaidCentralCheckoutId: existing?.id ?? null,
          });
          if (paidTarget.action === "reject") {
            throw new MixedCheckoutError(paidTarget.message);
          }
        }
        const saleKind = canCreateFreshCheckout
          ? "central_mixed"
          : "central_single";
        const target = resolveTableSaleTarget({
          saleKind,
          unpaidCentralCheckoutId: existing?.id ?? null,
        });
        if (target.action === "append_checkout" && existing && requestedUnpaid) {
          return appendItemsToExistingCheckout(client, {
            existing,
            lines,
            snapshot,
            merchClaimedIds,
            costMap,
            discountAmount,
            taxAmount,
            serviceChargeAmount,
            otherChargesAmount,
            serverSubtotal,
            serverTotal,
            paymentStatus,
          });
        }
        if (!canCreateFreshCheckout) {
          throw new MixedCheckoutError(
            "Checkout multi-stall membutuhkan item dari minimal 2 stall"
          );
        }
      } else if (!canCreateFreshCheckout) {
        throw new MixedCheckoutError(
          "Checkout multi-stall membutuhkan item dari minimal 2 stall"
        );
      }

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

      await stampPaymentCatalog(client, {
        checkoutId: checkout.id,
        orderIds,
        code: input.paymentMethodCode,
        name: input.paymentMethodName,
      });

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

    if (isPaidSale && insertChildren) {
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
  checkoutId: string,
  tender: CompleteMixedCheckoutTender = {},
  options: CompleteMixedCheckoutOptions = {}
): Promise<{ orderIds: string[] }> {
  const db = createPgClient();

  const existing = await db
    .from("pos_orders")
    .select("id, total_amount")
    .eq("checkout_id", checkoutId);
  const existingChildren = ((existing.data || []) as Array<{
    id: string;
    total_amount?: string | number | null;
  }>).map((row) => ({
    id: String(row.id),
    total: toNumber(row.total_amount),
  }));
  const existingIds = existingChildren.map((row) => row.id);

  const { data: preview, error: previewError } = await db
    .from("pos_checkouts")
    .select(
      "id, customer_id, cashier_id, payment_method, payment_method_code, payment_method_name, branch_id, cart_snapshot, xendit_qr_id, xendit_external_id, total_amount"
    )
    .eq("id", checkoutId)
    .maybeSingle();
  if (previewError) throw previewError;
  if (!preview) {
    throw new MixedCheckoutError("Checkout tidak ditemukan", 404);
  }

  const childTotal = existingChildren.reduce((sum, row) => sum + row.total, 0);
  const totalAmount = toNumber(preview.total_amount) || childTotal;
  const storedTender = resolveCompleteCheckoutTender({
    tender,
    storedPaymentMethod: preview.payment_method,
    totalAmount,
  });
  const resolved = resolveCheckoutBillTender({
    paymentMethod: storedTender.paymentMethod,
    amountPaid: storedTender.amountPaid,
    totalAmount,
  });
  if (!resolved.ok) {
    throw new MixedCheckoutError(resolved.message);
  }

  const catalog = resolvePaymentCatalogStamp({
    code: tender.paymentMethodCode || preview.payment_method_code,
    name: tender.paymentMethodName || preview.payment_method_name,
  });
  const previewSnapshot = parseSnapshot(preview as CheckoutRow);

  if (
    mustConfirmStoredCheckoutQris({
      paymentMethod: resolved.paymentMethod,
      paymentAlreadyConfirmed: options.paymentAlreadyConfirmed,
      hasExistingChildren: existingIds.length > 0,
    })
  ) {
    await confirmStoredCheckoutQrisPaid({
      xenditQrId: preview.xendit_qr_id,
      xenditExternalId: preview.xendit_external_id,
    });
  }

  if (existingIds.length > 0) {
    const now = new Date().toISOString();
    const { error: payCheckoutErr } = await db
      .from("pos_checkouts")
      .update({
        payment_status: "paid",
        payment_method: resolved.paymentMethod,
        amount_paid: resolved.amountPaid,
        change_amount: resolved.changeAmount,
        ...catalog,
        updated_at: now,
      })
      .eq("id", checkoutId)
      .neq("payment_status", "paid");
    if (payCheckoutErr) throw payCheckoutErr;

    const paidParts = allocateCheckoutTender(
      resolved.amountPaid,
      existingChildren.map((row) => row.total)
    );
    for (let index = 0; index < existingChildren.length; index += 1) {
      const child = existingChildren[index];
      if (!child) continue;
      const { error: payChildErr } = await db
        .from("pos_orders")
        .update({
          payment_status: "paid",
          payment_method: resolved.paymentMethod,
          amount_paid: paidParts[index] ?? 0,
          change_amount: index === 0 ? resolved.changeAmount : 0,
          xendit_qr_id: preview.xendit_qr_id || null,
          xendit_external_id: preview.xendit_external_id || null,
          ...catalog,
          updated_at: now,
        })
        .eq("id", child.id)
        .neq("payment_status", "paid");
      if (payChildErr) throw payChildErr;
    }

    await finalizePaidChildren({
      orderIds: existingIds,
      customerId: preview.customer_id,
      sessionUserId: previewSnapshot?.sessionUserId || String(preview.cashier_id || ""),
      paymentMethod: resolved.paymentMethod,
      branchId: preview.branch_id,
      alreadyHadChildren: true,
    });
    return { orderIds: existingIds };
  }

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

      await client.query(
        `UPDATE pos.pos_checkouts
         SET payment_status = 'paid',
             payment_method = $2::pos_payment_method,
             amount_paid = $3,
             change_amount = $4,
             updated_at = now()
         WHERE id = $1`,
        [checkoutId, resolved.paymentMethod, resolved.amountPaid, resolved.changeAmount]
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
        payment_method: resolved.paymentMethod,
        amount_paid: resolved.amountPaid,
        change_amount: resolved.changeAmount,
      };
      const orderIds = await insertChildrenForCheckout(client, {
        checkout: settledCheckout,
        snapshot,
        warehouseByProduct,
        merchClaimedIds: new Set(merchClaims.map((claim) => claim.productId)),
        costMap,
      });
      if (checkout.xendit_qr_id || checkout.xendit_external_id) {
        try {
          await client.query(
            `UPDATE pos.pos_orders
             SET xendit_qr_id = $2, xendit_external_id = $3, updated_at = now()
             WHERE checkout_id = $1`,
            [checkoutId, checkout.xendit_qr_id || null, checkout.xendit_external_id || null]
          );
        } catch (error) {
          if (!isMissingColumn(error)) throw error;
        }
      }
      await stampPaymentCatalog(client, {
        checkoutId,
        orderIds,
        code: catalog.payment_method_code || checkout.payment_method_code,
        name: catalog.payment_method_name || checkout.payment_method_name,
      });
      return { orderIds, snapshot, checkout: settledCheckout, reusedExistingChildren: false };
    });

    merchClaims = [];
    await finalizePaidChildren({
      orderIds: created.orderIds,
      customerId: created.checkout.customer_id,
      sessionUserId: created.snapshot?.sessionUserId || created.checkout.cashier_id,
      paymentMethod: created.checkout.payment_method || resolved.paymentMethod,
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

export async function cancelUnpaidChildlessCheckout(
  checkoutId: string,
  scope: { companyId?: string | null; branchId?: string | null } = {}
): Promise<{ checkoutId: string }> {
  return withTransaction(async (client) => {
    const scoped = unpaidCheckoutScopeSql({
      companyId: scope.companyId,
      branchId: scope.branchId,
      startParam: 2,
    });
    const result = await client.query<{
      id: string;
      payment_status: string;
      notes: string | null;
      table_id: string | null;
    }>(
      `SELECT id, payment_status, notes, table_id
       FROM pos.pos_checkouts
       WHERE id = $1 ${scoped.sql}
       FOR UPDATE`,
      [checkoutId, ...scoped.params]
    );
    const row = result.rows[0];
    if (!row) {
      throw new MixedCheckoutError("Checkout tidak ditemukan", 404);
    }
    if (isCancelledCheckout(row)) {
      return { checkoutId: row.id };
    }
    const children = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pos.pos_orders WHERE checkout_id = $1`,
      [checkoutId]
    );
    const guard = canCancelUnpaidChildlessCheckout({
      paymentStatus: row.payment_status,
      childCount: children.rows[0]?.n ?? 0,
      notes: row.notes,
    });
    if (!guard.ok) {
      throw new MixedCheckoutError(guard.message);
    }
    const patch = unpaidChildlessCheckoutCancelPatch();
    await client.query(
      `UPDATE pos.pos_checkouts
       SET table_id = $2, notes = $3, updated_at = now()
       WHERE id = $1`,
      [checkoutId, patch.table_id, patch.notes]
    );
    return { checkoutId: row.id };
  });
}
