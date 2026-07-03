import type { DbClient } from "@/lib/pg/types";
import { reduceInventoryFromPurchaseReturn } from "@/lib/inventory";
import { reduceProductInventoryFromPurchaseReturn } from "@/lib/inventory/product-purchase-return";
import type { PurchaseReturnFormData } from "@/types/purchasing";

const QTY_EPSILON = 0.000001;

export const EDITABLE_RETURN_STATUSES = ["draft", "pending_approval"] as const;

function toQty(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function assertReturnEditable(status: string) {
  if (!EDITABLE_RETURN_STATUSES.includes(status as (typeof EDITABLE_RETURN_STATUSES)[number])) {
    throw new Error("Purchase return can only be edited before approval");
  }
}

type ReturnLineInput = PurchaseReturnFormData["items"][number];

export async function validateReturnLineItems(
  db: DbClient,
  grnId: string,
  items: ReturnLineInput[],
  excludeReturnId?: string
) {
  if (!items.length) {
    throw new Error("At least one return item is required");
  }

  const excludeQtyByGrnItem = new Map<string, number>();
  if (excludeReturnId) {
    const { data: existingLines, error } = await db
      .from("purchase_return_items")
      .select("grn_item_id, qty_returned")
      .eq("return_id", excludeReturnId);

    if (error) throw error;

    for (const line of existingLines || []) {
      if (!line.grn_item_id) continue;
      excludeQtyByGrnItem.set(
        line.grn_item_id,
        (excludeQtyByGrnItem.get(line.grn_item_id) || 0) + toQty(line.qty_returned)
      );
    }
  }

  for (const item of items) {
    if (toQty(item.qty_returned) <= 0) {
      throw new Error("Return quantity must be greater than zero");
    }

    const { data: grnItem, error } = await db
      .from("grn_items")
      .select(
        `
        id,
        grn_id,
        raw_material_id,
        product_id,
        qty_qc_posted,
        qty_returned,
        raw_material:raw_materials (nama),
        product:products (nama)
      `
      )
      .eq("id", item.grn_item_id)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw error;
    if (!grnItem || grnItem.grn_id !== grnId) {
      throw new Error("Return item does not belong to the selected goods receipt");
    }

    const posted = toQty(grnItem.qty_qc_posted);
    const alreadyReturned = toQty(grnItem.qty_returned);
    const giveBack = excludeQtyByGrnItem.get(item.grn_item_id) || 0;
    const available = Math.max(0, posted - alreadyReturned + giveBack);

    if (toQty(item.qty_returned) > available + QTY_EPSILON) {
      const materialName =
        (grnItem.raw_material as { nama?: string } | null)?.nama ||
        (grnItem.product as { nama?: string } | null)?.nama ||
        "item";
      throw new Error(
        `Return quantity for ${materialName} exceeds available stock (${available})`
      );
    }
  }
}

export async function replacePurchaseReturnItems(
  db: DbClient,
  returnId: string,
  items: ReturnLineInput[]
) {
  const { error: deleteError } = await db
    .from("purchase_return_items")
    .delete()
    .eq("return_id", returnId);

  if (deleteError) throw deleteError;

  const payload = items.map((item) => ({
    return_id: returnId,
    grn_item_id: item.grn_item_id,
    raw_material_id: item.raw_material_id || null,
    product_id: item.product_id || null,
    qty_returned: item.qty_returned,
    unit_cost: item.unit_cost,
    subtotal: item.qty_returned * item.unit_cost,
    batch_number: item.batch_number || null,
    expiry_date: item.expiry_date || null,
    condition_notes: item.condition_notes || null,
    qc_status: "rejected" as const,
  }));

  const { error: insertError } = await db.from("purchase_return_items").insert(payload);
  if (insertError) throw insertError;
}

export async function approvePurchaseReturn(
  db: DbClient,
  returnId: string,
  userId: string
) {
  const { data: currentReturn, error: fetchError } = await db
    .from("purchase_returns")
    .select(
      `
      *,
      grn:grn (nomor_grn),
      items:purchase_return_items (
        id,
        grn_item_id,
        raw_material_id,
        product_id,
        qty_returned,
        unit_cost,
        condition_notes,
        grn_item:grn_items (
          warehouse_id
        )
      )
    `
    )
    .eq("id", returnId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!currentReturn) {
    throw new Error("Purchase return not found");
  }

  if (currentReturn.status !== "pending_approval") {
    throw new Error("Only pending returns can be approved");
  }

  const returnNumber = currentReturn.return_number as string;
  const items = (currentReturn.items || []) as Array<{
    grn_item_id: string;
    raw_material_id: string | null;
    product_id: string | null;
    qty_returned: number;
    unit_cost: number;
    condition_notes?: string | null;
    grn_item?: { warehouse_id?: string | null } | null;
  }>;

  if (!items.length) {
    throw new Error("Purchase return has no items");
  }

  for (const item of items) {
    if (item.product_id) {
      await reduceProductInventoryFromPurchaseReturn(db, {
        productId: item.product_id,
        qtyReturned: toQty(item.qty_returned),
        unitCost: toQty(item.unit_cost),
        returnId,
        returnNumber,
        userId,
        conditionNotes: item.condition_notes,
      });
      continue;
    }

    if (!item.raw_material_id) {
      throw new Error("Return item is missing material reference");
    }

    await reduceInventoryFromPurchaseReturn(db, {
      rawMaterialId: item.raw_material_id,
      qtyReturned: toQty(item.qty_returned),
      unitCost: toQty(item.unit_cost),
      returnId,
      returnNumber,
      warehouseId: item.grn_item?.warehouse_id ?? null,
      userId,
      conditionNotes: item.condition_notes,
    });
  }

  for (const item of items) {
    const { data: grnItem, error: grnItemError } = await db
      .from("grn_items")
      .select("qty_returned")
      .eq("id", item.grn_item_id)
      .maybeSingle();

    if (grnItemError) throw grnItemError;
    if (!grnItem) continue;

    const { error: grnUpdateError } = await db
      .from("grn_items")
      .update({
        qty_returned: toQty(grnItem.qty_returned) + toQty(item.qty_returned),
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.grn_item_id);

    if (grnUpdateError) throw grnUpdateError;
  }

  const { data: updatedReturn, error: updateError } = await db
    .from("purchase_returns")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", returnId)
    .select()
    .single();

  if (updateError) throw updateError;

  return updatedReturn;
}
