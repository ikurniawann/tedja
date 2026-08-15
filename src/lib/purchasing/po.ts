import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";
import { cancelDraftRejectCreditsForPo } from "@/lib/purchasing/vendor-credit-service";

// ============================================================
// PO State Machine
// Valid transitions: DRAFT→APPROVED→SENT→PARTIALLY_RECEIVED→RECEIVED
//                  PARTIALLY_RECEIVED / RECEIVED → CLOSED
//                  DRAFT/APPROVED/SENT/PARTIALLY_RECEIVED→CANCELLED
// Legacy alias: "partial" ≡ "partially_received"
// ============================================================

export type POStatus =
  | "draft"
  | "approved"
  | "sent"
  | "partially_received"
  | "received"
  | "cancelled"
  | "closed";

export const PO_TRANSITIONS: Record<POStatus, POStatus[]> = {
  draft: ["approved", "cancelled"],
  approved: ["sent", "cancelled"],
  sent: ["partially_received", "received", "cancelled"],
  partially_received: ["received", "cancelled", "closed"],
  received: ["closed"],
  cancelled: [],
  closed: [],
};

/** Normalize legacy "partial" to canonical DB status. */
export function normalizePOStatus(status: string | null | undefined): POStatus | string {
  if (!status) return "";
  if (status === "partial") return "partially_received";
  return status;
}

export function canTransition(from: string | POStatus, to: POStatus): boolean {
  const normalized = normalizePOStatus(from) as POStatus;
  return PO_TRANSITIONS[normalized]?.includes(to) ?? false;
}

export function validateTransition(from: string | POStatus, to: POStatus): void {
  const normalized = normalizePOStatus(from) as POStatus;
  if (!canTransition(normalized, to)) {
    throw new Error(
      `Invalid state transition: ${normalized} → ${to}. Allowed: ${PO_TRANSITIONS[normalized]?.join(", ") || "none"}`
    );
  }
}

// ============================================================
// PO Number Generator
// Format: PO-{YYYY}{MM}{DD}-{SEQ:4}
// ============================================================

export async function generatePONumber(db: DbClient): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const prefix = `PO-${year}${month}${day}`;

  const { data } = await db
    .from("purchase_orders")
    .select("nomor_po")
    .ilike("nomor_po", `${prefix}-%`)
    .order("nomor_po", { ascending: false })
    .limit(1);

  let seq = 1;
  if (data && data.length > 0) {
    const parts = data[0].nomor_po.split("-");
    const lastSeq = parseInt(parts[parts.length - 1]);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

// ============================================================
// PO Validations
// ============================================================

export interface POItemInput {
  bahan_baku_id?: string;
  description?: string;
  qty: number;
  satuan_id: string;
  unit_price: number;
  discount?: number;
  notes?: string;
}

export interface POCreateInput {
  supplier_id: string;
  items: POItemInput[];
  tax_percent?: number;
  shipping_cost?: number;
  payment_terms?: string;
  delivery_address?: string;
  notes?: string;
  delivery_date?: string;
}

/**
 * Validate PO creation input
 * - supplier must exist and be active
 * - bahan_baku must exist and be active
 * - qty and unit price must be usable
 */
export async function validatePOCreate(
  db: DbClient,
  input: POCreateInput
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Validate supplier
  const { data: supplier } = await db
    .from("suppliers")
    .select("id, nama, status, is_active")
    .eq("id", input.supplier_id)
    .single();

  if (!supplier) {
    errors.push("Supplier tidak ditemukan");
  } else if (!supplier.is_active) {
    errors.push("Supplier sudah tidak aktif");
  } else if (supplier.status !== "active") {
    errors.push(`Supplier berstatus "${supplier.status}" — tidak dapat diproses`);
  }

  // Validate each item
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];

    if (!item.bahan_baku_id) {
      errors.push(`Item ${i + 1}: Bahan baku ID wajib diisi`);
      continue;
    }

    // Check bahan_baku exists and active
    const { data: bahanBaku } = await db
      .from("raw_materials")
      .select("id, nama, is_active")
      .eq("id", item.bahan_baku_id)
      .is("deleted_at", null)
      .single();

    if (!bahanBaku) {
      errors.push(`Item ${i + 1}: Bahan baku tidak ditemukan`);
    } else if (!bahanBaku.is_active) {
      errors.push(`Item ${i + 1}: Bahan baku "${bahanBaku.nama}" sudah tidak aktif`);
    }

    // Check satuan exists
    if (!item.satuan_id) {
      errors.push(`Item ${i + 1}: Satuan wajib diisi`);
    } else {
      const { data: satuan } = await db
        .from("units")
        .select("id, nama")
        .eq("id", item.satuan_id)
        .eq("is_active", true)
        .single();

      if (!satuan) {
        errors.push(`Item ${i + 1}: Satuan tidak ditemukan`);
      }
    }

    if (!(item.qty > 0)) {
      errors.push(`Item ${i + 1}: Qty harus lebih dari 0`);
    }

    if (!(item.unit_price >= 0)) {
      errors.push(`Item ${i + 1}: Harga satuan tidak valid`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================
// PO Calculations
// ============================================================

export interface POCalculation {
  subtotal: number;
  tax_amount: number;
  shipping_cost: number;
  total: number;
}

export function calculatePO(input: {
  items: POItemInput[];
  tax_percent?: number;
  shipping_cost?: number;
}): POCalculation {
  const subtotal = input.items.reduce((sum, item) => {
    const lineTotal = item.qty * item.unit_price - (item.discount || 0);
    return sum + lineTotal;
  }, 0);

  const tax_amount = (subtotal * (input.tax_percent || 11)) / 100;
  const shipping_cost = input.shipping_cost || 0;
  const total = subtotal + tax_amount + shipping_cost;

  return { subtotal, tax_amount, shipping_cost, total };
}

// ============================================================
// Inventory Update (qty_on_order)
// ============================================================

export async function updateInventoryOnOrder(
  db: DbClient,
  items: POItemInput[],
  increment: boolean = true
): Promise<void> {
  for (const item of items) {
    if (!item.bahan_baku_id) continue;

    // Get current qty_on_order
    const { data: current } = await db
      .from("inventory")
      .select("qty_on_order")
      .eq("raw_material_id", item.bahan_baku_id)
      .eq("is_active", true)
      .maybeSingle();

    const delta = increment ? item.qty : -item.qty;
    const newQty = (current?.qty_on_order || 0) + delta;

    if (current) {
      await db
        .from("inventory")
        .update({ qty_on_order: Math.max(0, newQty) })
        .eq("raw_material_id", item.bahan_baku_id);
    } else if (increment) {
      await db.from("inventory").insert({
        raw_material_id: item.bahan_baku_id,
        qty_on_order: Math.max(0, item.qty),
        qty_available: 0,
        unit_cost: 0,
      });
    }
  }
}

// ============================================================
// Receive PO Items (partial or full)
// ============================================================

export interface POReceiveInput {
  po_id: string;
  items: {
    po_item_id: string;
    qty_received: number;
  }[];
}

type ReceivablePOItem = {
  id: string;
  qty_ordered: number;
  qty_received?: number | null;
  raw_material_id: string;
  harga_satuan?: number | null;
};

export async function receivePOItems(
  db: DbClient,
  input: POReceiveInput,
  userId: string
): Promise<{ success: boolean; newStatus: POStatus }> {
  const { data: po } = await db
    .from("purchase_orders")
    .select("id, status, items:purchase_order_items(*)")
    .eq("id", input.po_id)
    .single();

  if (!po || (!canTransition(po.status as string, "partially_received") && !canTransition(po.status as string, "received"))) {
    throw new Error(`PO tidak dapat diterima — status: ${po?.status}`);
  }

  let allFullyReceived = true;

  for (const inputItem of input.items) {
    const poItem = (po.items as ReceivablePOItem[] | undefined)?.find(
      (item) => item.id === inputItem.po_item_id
    );
    if (!poItem) throw new Error(`PO item ${inputItem.po_item_id} tidak ditemukan`);

    const newQtyReceived = toQty(poItem.qty_received) + toQty(inputItem.qty_received);
    const isFullyReceived = newQtyReceived >= toQty(poItem.qty_ordered);

    if (!isFullyReceived) allFullyReceived = false;

    await db
      .from("purchase_order_items")
      .update({ qty_received: newQtyReceived })
      .eq("id", inputItem.po_item_id);

    const { data: inventory } = await db
      .from("inventory")
      .select("qty_available, qty_on_order")
      .eq("raw_material_id", poItem.raw_material_id)
      .eq("is_active", true)
      .maybeSingle();

    if (inventory) {
      await db
        .from("inventory")
        .update({
          qty_available: (inventory.qty_available || 0) + inputItem.qty_received,
          qty_on_order: Math.max(0, (inventory.qty_on_order || 0) - inputItem.qty_received),
        })
        .eq("raw_material_id", poItem.raw_material_id);
    }
  }

  // Determine new status
  const newStatus: POStatus = allFullyReceived ? "received" : "partially_received";

  // Update PO status
  await db
    .from("purchase_orders")
    .update({
      status: newStatus,
      received_by: userId,
      received_at: new Date().toISOString(),
    })
    .eq("id", input.po_id);

  return { success: true, newStatus };
}

/**
 * Close a PO that still has open quantity (supplier will not replace shortage).
 * After close, the PO is no longer eligible for new deliveries.
 */
export async function closePurchaseOrder(
  db: DbClient,
  poId: string,
  reason: string,
  userId: string
): Promise<{ id: string; status: POStatus }> {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new Error("Alasan penutupan wajib diisi");
  }

  const { data: po, error } = await db
    .from("purchase_orders")
    .select("id, status")
    .eq("id", poId)
    .single();

  if (error || !po) {
    throw new Error("Purchase order tidak ditemukan");
  }

  const current = normalizePOStatus(po.status) as POStatus;
  validateTransition(current, "closed");

  try {
    await cancelDraftRejectCreditsForPo(db, poId);
  } catch (creditErr) {
    console.error("[closePurchaseOrder] cancel draft credits (non-fatal):", creditErr);
  }

  const { data: updated, error: updateError } = await db
    .from("purchase_orders")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by: userId,
      close_reason: trimmed,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq("id", poId)
    .select("id, status")
    .single();

  if (updateError || !updated) {
    throw new Error(updateError?.message || "Gagal menutup purchase order");
  }

  return { id: updated.id as string, status: updated.status as POStatus };
}
