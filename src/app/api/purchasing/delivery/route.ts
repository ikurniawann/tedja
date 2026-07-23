import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  requireApiRole,
  ApiError,
  createdResponse,
  paginatedResponse,
} from "@/lib/api/auth";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
  effectiveCompanyId,
  effectiveBranchId,
} from "@/lib/api/scope";
import { validatePOCanDelivery } from "@/lib/purchasing/delivery";
import {
  getPurchaseOrderIdsByModuleType,
  parsePurchasingModuleType,
} from "@/lib/purchasing/module-scope";

// ========================
// ZOD SCHEMAS
// ========================

const deliveryQueryParamsSchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  supplier_id: z.string().optional(),
  vendor_id: z.string().optional(),
  po_id: z.string().optional(),
  module_type: z.enum(["raw_material", "product"]).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sort_by: z.enum(["tanggal_kirim", "created_at", "status"]).default("created_at"),
  sort_dir: z.enum(["ASC", "DESC"]).default("DESC"),
});

const createDeliverySchema = z.object({
  po_id: z.string().uuid("Purchase order identifier must be valid"),
  supplier_id: z.string().uuid("Supplier identifier must be valid").optional(),
  vendor_id: z.string().uuid("Vendor identifier must be valid").optional(),
  module_type: z.enum(["raw_material", "product"]).optional(),
  tanggal_kirim: z.string().min(1, "Shipment date is required"),
  no_surat_jalan: z.string().min(1, "Delivery note number is required"),
  no_resi: z.string().optional(),
  kurir: z.string().optional(),
  tanggal_estimasi_tiba: z.string().min(1, "Estimated arrival date is required"),
  catatan: z.string().optional(),
}).superRefine((data, ctx) => {
  const moduleType = parsePurchasingModuleType(data.module_type);
  if (moduleType === "product") {
    if (!data.vendor_id) {
      ctx.addIssue({ code: "custom", message: "Vendor is required", path: ["vendor_id"] });
    }
  } else if (!data.supplier_id) {
    ctx.addIssue({ code: "custom", message: "Supplier is required", path: ["supplier_id"] });
  }
});

// ========================
// GET /api/purchasing/delivery - List deliveries
// ==========================

export async function GET(request: NextRequest) {
  try {
    await requireApiRole(["admin", "purchasing_admin", "purchasing_staff", "purchasing_manager", "super_admin"]);
    const db = await createServerPgClient();

    const { searchParams } = new URL(request.url);
    const params = deliveryQueryParamsSchema.parse(Object.fromEntries(searchParams));
    const { page, limit, search, status, supplier_id, vendor_id, po_id, module_type, sort_by, sort_dir } = params;
    const offset = (page - 1) * limit;

    let query = db
      .from("deliveries")
      .select("*", { count: "exact" })
      .eq("is_active", true);

    const scope = await getApiUserScope();
    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    if (module_type) {
      const poIds = await getPurchaseOrderIdsByModuleType(db, module_type);
      if (poIds.length === 0) {
        return paginatedResponse([], { page, limit, total: 0, totalPages: 0 });
      }
      query = query.in("purchase_order_id", poIds);
    }

    if (search) {
      query = query.or(`no_surat_jalan.ilike.%${search}%,no_resi.ilike.%${search}%`);
    }
    if (status) query = query.eq("status", status);
    if (supplier_id) query = query.eq("supplier_id", supplier_id);
    if (vendor_id) query = query.eq("vendor_id", vendor_id);
    if (po_id) query = query.eq("purchase_order_id", po_id);

    const sortColumn = sort_by === "tanggal_kirim" ? "tanggal_kirim" : sort_by;
    const { data, count, error } = await query
      .order(sortColumn, { ascending: sort_dir === "ASC" })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const poIds = Array.from(
      new Set((data || []).map((row) => row.purchase_order_id).filter(Boolean) as string[])
    );
    const { data: purchaseOrders, error: poError } = poIds.length
      ? await db.from("purchase_orders").select("id, nomor_po").in("id", poIds)
      : { data: [], error: null };

    if (poError) throw poError;

    const poNumberById = new Map(
      (purchaseOrders || []).map((po) => [po.id as string, po.nomor_po as string])
    );

    const mappedData = (data || []).map((row) => ({
      id: row.id,
      delivery_number: row.nomor_resi || row.no_resi || "-",
      po_id: row.purchase_order_id,
      po_number: poNumberById.get(row.purchase_order_id as string) || "-",
      no_surat_jalan: row.no_surat_jalan || "-",
      ekspedisi: row.kurir || "-",
      no_resi: row.no_resi || row.nomor_resi || "-",
      tanggal_kirim: row.tanggal_kirim,
      tanggal_estimasi_tiba: row.tanggal_estimasi_tiba,
      tanggal_aktual_tiba: row.tanggal_aktual_tiba,
      status: row.status,
      created_at: row.created_at,
    }));

    return paginatedResponse(mappedData, {
      page,
      limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / limit),
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Parameter tidak valid", error.issues).toResponse();
    }
    console.error("Error fetching deliveries:", error);
    return ApiError.server("Gagal memuat data delivery").toResponse();
  }
}

// ========================
// POST /api/purchasing/delivery - Create delivery
// ==========================

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiRole(["admin", "purchasing_admin", "purchasing_staff", "purchasing_manager", "super_admin"]);
    const db = await createServerPgClient();

    const body = await request.json();

    const validated = createDeliverySchema.parse(body);
    const moduleType = parsePurchasingModuleType(validated.module_type);

    const poValidation = await validatePOCanDelivery(db, validated.po_id);
    if (!poValidation.valid) {
      return ApiError.badRequest(poValidation.errors.join(" ")).toResponse();
    }

    const scope = await getApiUserScope();
    const { data: purchaseOrder, error: purchaseOrderError } = await db
      .from("purchase_orders")
      .select("company_id, branch_id, module_type, vendor_id, supplier_id")
      .eq("id", validated.po_id)
      .maybeSingle();

    if (purchaseOrderError) throw purchaseOrderError;

    if (moduleType === "product" && purchaseOrder?.module_type !== "product") {
      return ApiError.badRequest("Purchase order is not a product purchase order").toResponse();
    }
    if (moduleType === "raw_material" && purchaseOrder?.module_type === "product") {
      return ApiError.badRequest("Use product delivery flow for this purchase order").toResponse();
    }

    const companyId =
      purchaseOrder?.company_id ?? effectiveCompanyId(scope);
    const branchId =
      purchaseOrder?.branch_id ?? effectiveBranchId(scope);

    const resolvedVendorId =
      moduleType === "product"
        ? validated.vendor_id || purchaseOrder?.vendor_id
        : null;
    const resolvedSupplierId =
      moduleType === "raw_material"
        ? validated.supplier_id || purchaseOrder?.supplier_id
        : null;

    const { data: delivery, error: deliveryError } = await db
      .from("deliveries")
      .insert({
        purchase_order_id: validated.po_id,
        supplier_id: resolvedSupplierId,
        vendor_id: resolvedVendorId,
        tanggal_kirim: validated.tanggal_kirim || new Date().toISOString().split("T")[0],
        no_surat_jalan: validated.no_surat_jalan,
        no_resi: validated.no_resi,
        kurir: validated.kurir,
        tanggal_estimasi_tiba: validated.tanggal_estimasi_tiba,
        status: "pending",
        catatan: validated.catatan,
        company_id: companyId,
        branch_id: branchId,
        created_by: user.id,
      })
      .select()
      .single();

    if (deliveryError || !delivery) {
      console.error("Error creating delivery:", deliveryError);
      return ApiError.server("Gagal membuat delivery").toResponse();
    }

    return createdResponse(delivery, "Delivery created successfully");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validasi gagal", error.issues).toResponse();
    }
    console.error("Error creating delivery:", error);
    return ApiError.server("Gagal membuat delivery").toResponse();
  }
}
