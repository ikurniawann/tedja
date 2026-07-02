import type { DbClient } from "@/lib/pg/types";

type POTotalsInput = {
  diskon_persen?: number | null;
  diskon_nominal?: number | null;
  ppn_persen?: number | null;
};

export async function recalculatePurchaseOrderTotals(
  db: DbClient,
  poId: string,
  overrides: POTotalsInput = {}
) {
  const { data: po, error: poError } = await db
    .from("purchase_orders")
    .select("diskon_persen,diskon_nominal,ppn_persen")
    .eq("id", poId)
    .single();

  if (poError || !po) throw poError || new Error("PO tidak ditemukan");

  const { data: items, error: itemsError } = await db
    .from("purchase_order_items")
    .select("qty_ordered,harga_satuan,diskon_item")
    .eq("purchase_order_id", poId)
    .eq("is_active", true);

  if (itemsError) throw itemsError;

  const subtotal = (items || []).reduce((sum: number, item: { qty_ordered?: unknown; harga_satuan?: unknown; diskon_item?: unknown }) => {
    const lineTotal =
      Number(item.qty_ordered || 0) * Number(item.harga_satuan || 0) -
      Number(item.diskon_item || 0);
    return sum + lineTotal;
  }, 0);

  const diskonPersen = overrides.diskon_persen ?? po.diskon_persen ?? 0;
  const diskonNominal =
    diskonPersen > 0
      ? (subtotal * Number(diskonPersen)) / 100
      : Number(overrides.diskon_nominal ?? po.diskon_nominal ?? 0);
  const taxableAmount = Math.max(0, subtotal - diskonNominal);
  const ppnPersen = overrides.ppn_persen ?? po.ppn_persen ?? 11;
  const ppnNominal = (taxableAmount * Number(ppnPersen)) / 100;
  const total = taxableAmount + ppnNominal;

  return {
    subtotal,
    diskon_nominal: diskonNominal,
    ppn_nominal: ppnNominal,
    total,
  };
}
