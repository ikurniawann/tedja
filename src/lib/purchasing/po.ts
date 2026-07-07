import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";

// ============================================================
// PO State Machine
// Valid transitions: DRAFT→APPROVED→SENT→PARTIAL→RECEIVED
//                  DRAFT/APPROVED→CANCELLED
// ============================================================

export type POStatus = "draft" | "approved" | "sent" | "partial" | "received" | "cancelled" | "closed";

export const PO_TRANSITIONS: Record<POStatus, POStatus[]> = {
  draft: ["approved", "cancelled"],
  approved: ["sent", "cancelled"],
  sent: ["partial", "received", "cancelled"],
  partial: ["received", "cancelled"],
  received: ["closed"],
  cancelled: [],
  closed: [],
};

export function canTransition(from: POStatus, to: POStatus): boolean {
  return PO_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateTransition(from: POStatus, to: POStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Invalid state transition: ${from} → ${to}. Allowed: ${PO_TRANSITIONS[from]?.join(", ") || "none"}`
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
 * - supplier_price must exist for each item
 * - minimum_qty must be met
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

    // Check supplier price exists
    const { data: price } = await db
      .from("supplier_price_lists")
      .select("id, harga, minimum_qty, berlaku_sampai")
      .eq("supplier_id", input.supplier_id)
      .eq("bahan_baku_id", item.bahan_baku_id)
      .eq("is_active", true)
      .single();

    if (!price) {
      errors.push(`Item ${i + 1}: Harga supplier belum ada di master — tambah dulu di Harga Beli`);
    } else {
      // Check validity
      if (price.berlaku_sampai) {
        const expiry = new Date(price.berlaku_sampai);
        if (expiry < new Date()) {
          errors.push(`Item ${i + 1}: Harga supplier sudah expired (${price.berlaku_sampai})`);
        }
      }

      // Check minimum qty
      if (item.qty < price.minimum_qty) {
        errors.push(`Item ${i + 1}: Qty kurang dari minimum order (${price.minimum_qty})`);
      }

      // Warn if unit_price differs
      if (price.harga !== item.unit_price) {
        // Not an error, just info — allow manual override
      }
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

  if (!po || !canTransition(po.status as POStatus, "partial") && !canTransition(po.status as POStatus, "received")) {
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
  const newStatus: POStatus = allFullyReceived ? "received" : "partial";

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
