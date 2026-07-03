import { createPgClient } from "@/lib/pg/create-client";
import {
  getPurchaseOrderIdsByModuleType,
  parsePurchasingModuleType,
} from "@/lib/purchasing/module-scope";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(request: Request) {
  try {
    const db = createPgClient();
    const { searchParams } = new URL(request.url);
    const moduleType = parsePurchasingModuleType(searchParams.get("module_type"));
    const scopedPoIds = await getPurchaseOrderIdsByModuleType(db, moduleType);
    const scopedPoIdSet = new Set(scopedPoIds);

    const [poResult, deliveryResult, grnResult] = await Promise.all([
      db
        .from("v_purchase_orders")
        .select("*")
        .eq("module_type", moduleType)
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("deliveries")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("grn")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    if (poResult.error) throw poResult.error;
    if (deliveryResult.error) throw deliveryResult.error;
    if (grnResult.error) throw grnResult.error;

    const deliveriesData = (deliveryResult.data || []).filter((delivery) =>
      scopedPoIdSet.has(delivery.purchase_order_id)
    );
    const grnsData = (grnResult.data || []).filter((grn) =>
      scopedPoIdSet.has(grn.purchase_order_id)
    );
    const deliveryPoIds = new Set(
      deliveriesData.map((delivery) => delivery.purchase_order_id).filter(Boolean)
    );
    const purchaseOrders = (poResult.data || []).filter((po) => deliveryPoIds.has(po.id));
    const poIds = Array.from(deliveryPoIds);
    const supplierIds = Array.from(
      new Set(
        [
          ...deliveriesData.map((delivery) => delivery.supplier_id),
          ...grnsData.map((grn) => grn.supplier_id),
        ].filter(Boolean)
      )
    );
    const vendorIds = Array.from(
      new Set(
        [
          ...deliveriesData.map((delivery) => delivery.vendor_id),
          ...grnsData.map((grn) => grn.vendor_id),
        ].filter(Boolean)
      )
    );

    const [deliveryPoResult, supplierResult, vendorResult] = await Promise.all([
      poIds.length > 0
        ? db.from("purchase_orders").select("id, nomor_po").in("id", poIds)
        : Promise.resolve({ data: [], error: null }),
      supplierIds.length > 0
        ? db.from("suppliers").select("id, nama_supplier").in("id", supplierIds)
        : Promise.resolve({ data: [], error: null }),
      vendorIds.length > 0
        ? db.from("vendors").select("id, name").in("id", vendorIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (deliveryPoResult.error) throw deliveryPoResult.error;
    if (supplierResult.error) throw supplierResult.error;
    if (vendorResult.error) throw vendorResult.error;

    const poNumberById = new Map((deliveryPoResult.data || []).map((po) => [po.id, po.nomor_po]));
    const supplierNameById = new Map((supplierResult.data || []).map((supplier) => [supplier.id, supplier.nama_supplier]));
    const vendorNameById = new Map((vendorResult.data || []).map((vendor) => [vendor.id, vendor.name]));

    const deliveries = deliveriesData.map((delivery) => ({
      id: delivery.id,
      po_id: delivery.purchase_order_id,
      po_number: poNumberById.get(delivery.purchase_order_id) || delivery.purchase_order_id,
      supplier_name:
        (delivery.supplier_id ? supplierNameById.get(delivery.supplier_id) : null) ||
        (delivery.vendor_id ? vendorNameById.get(delivery.vendor_id) : null) ||
        null,
      delivery_number: delivery.nomor_resi,
      no_surat_jalan: delivery.no_surat_jalan,
      ekspedisi: delivery.kurir,
      no_resi: delivery.no_resi || delivery.nomor_resi,
      tanggal_kirim: delivery.tanggal_kirim,
      tanggal_estimasi_tiba: delivery.tanggal_estimasi_tiba,
      tanggal_aktual_tiba: delivery.tanggal_aktual_tiba,
      status: delivery.status,
      created_at: delivery.created_at,
    }));

    const deliveryNumberById = new Map(
      deliveries.map((delivery) => [delivery.id, delivery.no_resi || delivery.delivery_number || delivery.po_number])
    );

    const grns = grnsData.map((grn) => ({
      id: grn.id,
      nomor_grn: grn.nomor_grn,
      delivery_id: grn.delivery_id,
      delivery_number: deliveryNumberById.get(grn.delivery_id) || grn.delivery_id,
      po_id: grn.purchase_order_id,
      po_number: poNumberById.get(grn.purchase_order_id) || grn.purchase_order_id,
      supplier_id: grn.supplier_id,
      supplier_name:
        (grn.supplier_id ? supplierNameById.get(grn.supplier_id) : null) ||
        (grn.vendor_id ? vendorNameById.get(grn.vendor_id) : null) ||
        null,
      tanggal_penerimaan: grn.tanggal_penerimaan,
      no_surat_jalan: grn.no_surat_jalan,
      status: grn.status,
      total_item_diterima: grn.total_item_diterima,
      total_item_ditolak: grn.total_item_ditolak,
      receive_count: grn.receive_count || 1,
      catatan: grn.catatan,
      created_at: grn.created_at,
    }));

    return Response.json({
      success: true,
      data: {
        purchase_orders: purchaseOrders,
        deliveries,
        grns,
      },
    });
  } catch (error: unknown) {
    console.error("Error loading receiving workspace:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal memuat workspace penerimaan") },
      { status: 500 }
    );
  }
}
