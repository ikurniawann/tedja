import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";
import {
  requireApiRole,
  ApiError,
} from "@/lib/api/auth";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
} from "@/lib/api/scope";
import {
  getPurchaseOrderIdsByModuleType,
  parsePurchasingModuleType,
} from "@/lib/purchasing/module-scope";

const ELIGIBLE_DELIVERY_STATUSES = ["pending", "shipped", "in_transit", "delivered"];

type DeliveryRow = {
  id: string;
  purchase_order_id: string;
  supplier_id?: string | null;
  vendor_id?: string | null;
  nomor_resi?: string | null;
  no_resi?: string | null;
  no_surat_jalan?: string | null;
  kurir?: string | null;
  status?: string | null;
  tanggal_kirim?: string | null;
  tanggal_estimasi_tiba?: string | null;
  branch_id?: string | null;
  company_id?: string | null;
  [key: string]: unknown;
};

/**
 * Deliveries eligible for goods receipt:
 * - active delivery in receivable status
 * - no active GRN linked yet
 * - within user business scope
 */
export async function GET(request: Request) {
  try {
    await requireApiRole([
      "purchasing_admin",
      "purchasing_staff",
      "purchasing_manager",
      "super_admin",
    ]);
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const { searchParams } = new URL(request.url);
    const moduleType = parsePurchasingModuleType(searchParams.get("module_type"));

    let query = db
      .from("deliveries")
      .select("*")
      .eq("is_active", true)
      .in("status", ELIGIBLE_DELIVERY_STATUSES);

    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    const poIds = await getPurchaseOrderIdsByModuleType(db, moduleType);
    if (poIds.length === 0) {
      return NextResponse.json({ data: [] });
    }
    query = query.in("purchase_order_id", poIds);

    const { data: deliveries, error } = await query
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    const { data: grnRows, error: grnError } = await db
      .from("grn")
      .select("delivery_id")
      .eq("is_active", true)
      .not("delivery_id", "is", null);

    if (grnError) throw grnError;

    const deliveryIdsWithGrn = new Set(
      (grnRows || [])
        .map((row) => row.delivery_id)
        .filter((deliveryId): deliveryId is string => Boolean(deliveryId))
    );

    const eligibleDeliveries = ((deliveries || []) as DeliveryRow[]).filter(
      (delivery) => !deliveryIdsWithGrn.has(delivery.id)
    );

    const supplierIds = [
      ...new Set(eligibleDeliveries.map((delivery) => delivery.supplier_id).filter(Boolean)),
    ] as string[];
    const vendorIds = [
      ...new Set(eligibleDeliveries.map((delivery) => delivery.vendor_id).filter(Boolean)),
    ] as string[];
    const poIdsForLookup = [
      ...new Set(
        eligibleDeliveries.map((delivery) => delivery.purchase_order_id).filter(Boolean)
      ),
    ] as string[];

    const [suppliersResult, vendorsResult, posResult] = await Promise.all([
      supplierIds.length
        ? db.from("suppliers").select("id, nama_supplier").in("id", supplierIds)
        : Promise.resolve({ data: [], error: null }),
      vendorIds.length
        ? db.from("vendors").select("id, name").in("id", vendorIds)
        : Promise.resolve({ data: [], error: null }),
      poIdsForLookup.length
        ? db.from("purchase_orders").select("id, nomor_po").in("id", poIdsForLookup)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (suppliersResult.error) throw suppliersResult.error;
    if (vendorsResult.error) throw vendorsResult.error;
    if (posResult.error) throw posResult.error;

    const supplierById = new Map(
      (suppliersResult.data || []).map((supplier) => [supplier.id, supplier.nama_supplier || "-"])
    );
    const vendorById = new Map(
      (vendorsResult.data || []).map((vendor) => [vendor.id, vendor.name || "-"])
    );
    const poById = new Map(
      (posResult.data || []).map((po) => [po.id, po.nomor_po || "-"])
    );

    const mapped = eligibleDeliveries.map((delivery) => ({
      ...delivery,
      po_id: delivery.purchase_order_id,
      supplier_name:
        (delivery.supplier_id ? supplierById.get(delivery.supplier_id) : null) ||
        (delivery.vendor_id ? vendorById.get(delivery.vendor_id) : null) ||
        delivery.kurir ||
        "-",
      vendor_name: delivery.vendor_id ? vendorById.get(delivery.vendor_id) || null : null,
      po_number: poById.get(delivery.purchase_order_id) || "-",
      delivery_number:
        delivery.nomor_resi || delivery.no_resi || delivery.no_surat_jalan || delivery.id,
    }));

    return NextResponse.json({ data: mapped });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "Failed to load eligible deliveries for goods receipt";
    console.error("Error fetching deliveries for GRN:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
