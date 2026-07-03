import type { DbClient } from "@/lib/pg/types";
import { addInventoryFromGrn } from "@/lib/inventory";
import {
  updateDeliveryStatusAfterGrn,
  updatePOStatusAfterGrn,
  type GrnStatus,
} from "@/lib/purchasing/grn";
import { toQty } from "@/lib/purchasing/utils";
import {
  resolveItemStatus,
  resolveOverallQcStatus,
  type QcOverallStatus,
} from "@/lib/purchasing/grn-qc-utils";
import { syncQcRejectCredits } from "@/lib/purchasing/vendor-credit-service";

export type { QcOverallStatus } from "@/lib/purchasing/grn-qc-utils";
export { resolveOverallQcStatus } from "@/lib/purchasing/grn-qc-utils";

export type QcInspectionItemInput = {
  grn_item_id: string;
  raw_material_id: string;
  qty_inspected: number;
  qty_accepted: number;
  qty_rejected: number;
  catatan?: string | null;
};

export type SubmitGrnQcInput = {
  grnId: string;
  status: QcOverallStatus;
  parameter_inspeksi?: Record<string, unknown>;
  hasil_inspeksi?: Record<string, string>;
  catatan?: string | null;
  rekomendasi?: string | null;
  items: QcInspectionItemInput[];
  userId: string;
};

export async function computeGrnStatusAfterQc(
  db: DbClient,
  poId: string,
  totalAcceptedInQc: number
): Promise<GrnStatus> {
  if (totalAcceptedInQc <= 0) {
    return "rejected";
  }

  const { data: poItems, error } = await db
    .from("purchase_order_items")
    .select("qty_ordered, qty_received")
    .eq("purchase_order_id", poId)
    .eq("is_active", true);

  if (error) throw error;
  if (!poItems?.length) return "partially_received";

  const totalOrdered = poItems.reduce((sum, item) => sum + toQty(item.qty_ordered), 0);
  const totalReceived = poItems.reduce((sum, item) => sum + toQty(item.qty_received), 0);

  if (totalOrdered > 0 && totalReceived >= totalOrdered) {
    return "received";
  }

  return "partially_received";
}

export async function submitGrnQcInspection(
  db: DbClient,
  input: SubmitGrnQcInput
): Promise<{
  inspectionId: string;
  grnStatus: GrnStatus;
  totalAccepted: number;
  totalRejected: number;
}> {
  const { grnId, userId, items } = input;

  const { data: grn, error: grnError } = await db
    .from("grn")
    .select("id, nomor_grn, status, purchase_order_id, delivery_id")
    .eq("id", grnId)
    .eq("is_active", true)
    .single();

  if (grnError || !grn) {
    throw new Error("GRN not found");
  }

  if (grn.status !== "pending") {
    throw new Error("GRN is not awaiting quality control");
  }

  const { data: existingQc } = await db
    .from("grn_qc_inspections")
    .select("id, inventory_posted")
    .eq("grn_id", grnId)
    .maybeSingle();

  if (existingQc?.inventory_posted) {
    throw new Error("Quality control has already been completed for this goods receipt");
  }

  const { data: grnItems, error: itemsError } = await db
    .from("grn_items")
    .select(
      `
      id,
      raw_material_id,
      qty_diterima,
      warehouse_id,
      qty_qc_posted,
      purchase_order_item_id,
      purchase_order_item:purchase_order_items!purchase_order_item_id(
        id,
        harga_satuan
      )
    `
    )
    .eq("grn_id", grnId)
    .eq("is_active", true);

  if (itemsError) throw itemsError;

  const grnItemMap = new Map((grnItems || []).map((item) => [item.id, item]));

  for (const item of items) {
    const grnItem = grnItemMap.get(item.grn_item_id);
    if (!grnItem) {
      throw new Error(`GRN item ${item.grn_item_id} not found`);
    }

    const inspected = toQty(item.qty_inspected);
    const accepted = toQty(item.qty_accepted);
    const rejected = toQty(item.qty_rejected);
    const receivedQty = toQty(grnItem.qty_diterima);

    if (inspected <= 0) {
      throw new Error("Inspected quantity must be greater than zero");
    }

    if (Math.abs(accepted + rejected - inspected) > 0.0001) {
      throw new Error("Accepted and rejected quantities must equal inspected quantity");
    }

    if (inspected > receivedQty + 0.0001) {
      throw new Error("Inspected quantity cannot exceed received good quantity");
    }

    if (accepted > receivedQty + 0.0001) {
      throw new Error("Accepted quantity cannot exceed received good quantity");
    }
  }

  const overallStatus = input.status || resolveOverallQcStatus(items);
  const totalAccepted = items.reduce((sum, item) => sum + toQty(item.qty_accepted), 0);
  const totalRejected = items.reduce((sum, item) => sum + toQty(item.qty_rejected), 0);

  if (existingQc?.id) {
    await db.from("grn_qc_inspection_items").delete().eq("qc_inspection_id", existingQc.id);
    await db.from("grn_qc_inspections").delete().eq("id", existingQc.id);
  }

  const { data: inspection, error: inspectionError } = await db
    .from("grn_qc_inspections")
    .insert({
      grn_id: grnId,
      status: overallStatus,
      parameter_inspeksi: input.parameter_inspeksi || null,
      hasil_inspeksi: input.hasil_inspeksi || null,
      catatan: input.catatan || null,
      rekomendasi: input.rekomendasi || null,
      inspector_id: userId,
      inspected_at: new Date().toISOString(),
      inventory_posted: false,
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();

  if (inspectionError || !inspection) {
    throw new Error(inspectionError?.message || "Failed to save QC inspection");
  }

  const qcItemsPayload = items.map((item) => ({
    qc_inspection_id: inspection.id,
    grn_item_id: item.grn_item_id,
    raw_material_id: item.raw_material_id,
    qty_inspected: toQty(item.qty_inspected),
    qty_accepted: toQty(item.qty_accepted),
    qty_rejected: toQty(item.qty_rejected),
    item_status: resolveItemStatus(toQty(item.qty_accepted), toQty(item.qty_rejected)),
    catatan: item.catatan || null,
  }));

  const { error: qcItemsError } = await db
    .from("grn_qc_inspection_items")
    .insert(qcItemsPayload);

  if (qcItemsError) {
    throw new Error(qcItemsError.message || "Failed to save QC line items");
  }

  for (const item of items) {
    const grnItem = grnItemMap.get(item.grn_item_id)!;
    const accepted = toQty(item.qty_accepted);
    const itemStatus = resolveItemStatus(accepted, toQty(item.qty_rejected));
    const previouslyPosted = toQty((grnItem as { qty_qc_posted?: number | null }).qty_qc_posted);
    const qtyToPost = Math.max(0, accepted - previouslyPosted);

    await db
      .from("grn_items")
      .update({
        qc_status: itemStatus,
        qty_qc_posted: accepted,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.grn_item_id);

    if (qtyToPost > 0) {
      const poItem = grnItem.purchase_order_item as { harga_satuan?: number | null } | null;
      const unitCost = toQty(poItem?.harga_satuan);
      const warehouseId = (grnItem as { warehouse_id?: string | null }).warehouse_id ?? null;

      await addInventoryFromGrn(
        db,
        item.raw_material_id,
        qtyToPost,
        unitCost,
        grnId,
        grn.nomor_grn,
        userId,
        warehouseId
      );
    }
  }

  const grnStatus = await computeGrnStatusAfterQc(
    db,
    grn.purchase_order_id,
    totalAccepted
  );

  await db
    .from("grn")
    .update({
      status: grnStatus,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", grnId);

  await db
    .from("grn_qc_inspections")
    .update({
      inventory_posted: true,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", inspection.id);

  if (grn.delivery_id) {
    await updateDeliveryStatusAfterGrn(db, grn.delivery_id, grnStatus);
  }

  if (grn.purchase_order_id) {
    await updatePOStatusAfterGrn(db, grn.purchase_order_id);
  }

  try {
    await syncQcRejectCredits(db, grnId, userId);
  } catch (creditErr) {
    console.error("[GRN QC] Vendor credit sync error (non-fatal):", creditErr);
  }

  return {
    inspectionId: inspection.id,
    grnStatus,
    totalAccepted,
    totalRejected,
  };
}
