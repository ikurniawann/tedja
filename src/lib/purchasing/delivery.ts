import type { DbClient } from "@/lib/pg/types";

// ============================================================
// Delivery State Machine
// IN_TRANSIT → ARRIVED
// IN_TRANSIT → CANCELLED
// ============================================================

export type DeliveryStatus = "pending" | "shipped" | "in_transit" | "delivered" | "cancelled";

/** Delivery still in progress — blocks creating another shipment for the same PO. */
export const OPEN_DELIVERY_STATUSES: DeliveryStatus[] = [
  "pending",
  "shipped",
  "in_transit",
];

export const PO_DELIVERY_ELIGIBLE_STATUSES = [
  "approved",
  "sent",
  "partially_received",
] as const;

type DeliverySummary = {
  id?: string;
  status?: string | null;
  purchase_order_id?: string | null;
  nomor_resi?: string | null;
  no_surat_jalan?: string | null;
};

export function isOpenDeliveryStatus(status?: string | null) {
  return OPEN_DELIVERY_STATUSES.includes(
    (status?.toLowerCase() || "") as DeliveryStatus
  );
}

export function findOpenDelivery(deliveries: DeliverySummary[]) {
  return deliveries.find((delivery) => isOpenDeliveryStatus(delivery.status)) ?? null;
}

export function isPoStatusEligibleForDelivery(status?: string | null) {
  return PO_DELIVERY_ELIGIBLE_STATUSES.includes(
    (status?.toLowerCase() || "") as (typeof PO_DELIVERY_ELIGIBLE_STATUSES)[number]
  );
}

export function isPoEligibleForNewDelivery(
  poStatus: string | null | undefined,
  deliveries: DeliverySummary[]
) {
  if (!isPoStatusEligibleForDelivery(poStatus)) return false;
  return !findOpenDelivery(deliveries);
}

type DeliveryPO = {
  id: string;
  nomor_po?: string | null;
  status?: string | null;
  supplier_id?: string | null;
  is_active?: boolean | null;
};

type DeliveryWithPO = {
  id: string;
  status?: string | null;
  purchase_order_id?: string | null;
  purchase_order?: DeliveryPO | null;
};

export const DELIVERY_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  pending: ["shipped", "in_transit", "cancelled"],
  shipped: ["in_transit", "cancelled"],
  in_transit: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export function validateDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): void {
  const allowed = DELIVERY_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(
      `Invalid delivery transition: ${from} → ${to}. Allowed: ${allowed?.join(", ") || "none"}`
    );
  }
}

// ============================================================
// GRN State Machine
// PENDING → PARTIAL → COMPLETED
// PENDING/PARTIAL → REJECTED
// ============================================================

export type GRNStatus = "pending" | "partial" | "completed" | "rejected";

export const GRN_TRANSITIONS: Record<GRNStatus, GRNStatus[]> = {
  pending: ["partial", "completed", "rejected"],
  partial: ["completed", "rejected"],
  completed: [],
  rejected: [],
};

export function validateGRNTransition(from: GRNStatus, to: GRNStatus): void {
  const allowed = GRN_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(
      `Invalid GRN transition: ${from} → ${to}. Allowed: ${allowed?.join(", ") || "none"}`
    );
  }
}

// ============================================================
// Return State Machine
// PENDING → APPROVED → SHIPPED → RECEIVED_BY_SUPPLIER → COMPLETED
// PENDING/APPROVED → CANCELLED
// ============================================================

export type ReturnStatus =
  | "pending"
  | "approved"
  | "shipped"
  | "received_by_supplier"
  | "completed"
  | "cancelled";

export const RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  pending: ["approved", "cancelled"],
  approved: ["shipped", "cancelled"],
  shipped: ["received_by_supplier", "cancelled"],
  received_by_supplier: ["completed"],
  completed: [],
  cancelled: [],
};

export function validateReturnTransition(from: ReturnStatus, to: ReturnStatus): void {
  const allowed = RETURN_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(
      `Invalid return transition: ${from} → ${to}. Allowed: ${allowed?.join(", ") || "none"}`
    );
  }
}

// ============================================================
// Generate delivery number: DEV-{YYYY}{MM}{DD}-{SEQ:4}
// ============================================================

export async function generateDeliveryNumber(db: DbClient): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const prefix = `DEV-${year}${month}${day}`;

  const { data } = await db
    .from("deliveries")
    .select("nomor_resi")
    .ilike("nomor_resi", `${prefix}-%`)
    .order("nomor_resi", { ascending: false })
    .limit(1);

  let seq = 1;
  if (data && data.length > 0) {
    const match = data[0].nomor_resi.match(/^DEV-\d{8}-(\d+)$/);
    if (match) {
      seq = parseInt(match[1]) + 1;
    }
  }

  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

// ============================================================
// Validate PO can receive delivery
// ============================================================

export async function validatePOCanDelivery(
  db: DbClient,
  poId: string
): Promise<{ valid: boolean; errors: string[]; po?: DeliveryPO }> {
  const errors: string[] = [];

  const { data: po, error } = await db
    .from("purchase_orders")
    .select("id, nomor_po, status, supplier_id, is_active")
    .eq("id", poId)
    .single();

  if (error) {
    errors.push(`Database error: ${error.message}`);
    return { valid: false, errors };
  }

  if (!po) {
    errors.push("Purchase order not found");
    return { valid: false, errors };
  }

  if (!po.is_active) {
    errors.push("Purchase order is no longer active");
  }

  const statusLower = po.status?.toLowerCase();
  if (!isPoStatusEligibleForDelivery(statusLower)) {
    errors.push(
      `Purchase order status is "${po.status}". It must be approved, sent, or partially received before creating a delivery.`
    );
  }

  const { data: existingDeliveries, error: deliveryError } = await db
    .from("deliveries")
    .select("id, status")
    .eq("purchase_order_id", poId)
    .eq("is_active", true)
    .neq("status", "cancelled");

  if (deliveryError) {
    errors.push(`Database error: ${deliveryError.message}`);
    return { valid: false, errors, po };
  }

  const openDelivery = findOpenDelivery(existingDeliveries || []);
  if (openDelivery) {
    errors.push("This purchase order already has an open delivery in progress.");
  }

  return { valid: errors.length === 0, errors, po };
}

// ============================================================
// Validate GRN can be created from Delivery
// ============================================================

export async function validateDeliveryForGRN(
  db: DbClient,
  deliveryId: string
): Promise<{ valid: boolean; errors: string[]; delivery?: DeliveryWithPO }> {
  const errors: string[] = [];

  const { data: delivery } = await db
    .from("deliveries")
    .select("*, purchase_order:purchase_orders!purchase_order_id(*)")
    .eq("id", deliveryId)
    .single();

  if (!delivery) {
    errors.push("Delivery tidak ditemukan");
    return { valid: false, errors };
  }

  if (delivery.status !== "delivered") {
    errors.push(`Delivery belum tiba — status: "${delivery.status}", harus DELIVERED`);
  }

  return { valid: errors.length === 0, errors, delivery };
}

// ============================================================
// Check if all GRN items are QC-completed → auto-update GRN status
// ============================================================

export async function updateGRNStatusFromQC(
  db: DbClient,
  grnId: string
): Promise<{ newStatus: GRNStatus; isComplete: boolean }> {
  const { data: qc } = await db
    .from("grn_qc_inspections")
    .select("id, status, inventory_posted")
    .eq("grn_id", grnId)
    .maybeSingle();

  if (!qc) {
    return { newStatus: "pending", isComplete: false };
  }

  const statusMap: Record<string, GRNStatus> = {
    approved: "completed",
    partial: "partial",
    rejected: "rejected",
  };
  const newStatus = statusMap[qc.status as string] || "partial";
  const isComplete = Boolean(qc.inventory_posted);

  if (newStatus !== "pending") {
    await db.from("grn").update({ status: newStatus === "completed" ? "received" : newStatus }).eq("id", grnId);
  }

  return { newStatus, isComplete };
}
