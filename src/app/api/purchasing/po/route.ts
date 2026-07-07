// ============================================
// API ROUTE: /api/purchasing/po
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { z } from "zod";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
  effectiveCompanyId,
  effectiveBranchId,
} from "@/lib/api/scope";
import { isOpenDeliveryStatus } from "@/lib/purchasing/delivery";

const optionalDateSchema = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()])
  .optional()
  .transform((value) => value || null);

const poSchema = z.object({
  supplier_id: z.string().uuid("Supplier wajib dipilih"),
  pr_id: z.string().uuid().optional(),
  tanggal_po: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD"),
  tanggal_kirim_estimasi: optionalDateSchema,
  catatan: z.string().optional(),
  alamat_pengiriman: z.string().optional(),
  diskon_persen: z.number().min(0).max(100).default(0),
  diskon_nominal: z.number().min(0).default(0),
  ppn_persen: z.number().min(0).max(100).default(11),
  source_type: z.enum(["manual", "production_order", "low_stock"]).optional().default("manual"),
  production_order_id: z.string().uuid().optional().nullable(),
  source_reference: z.string().optional().nullable(),
  items: z.array(
    z.object({
      raw_material_id: z.string().uuid("Bahan baku wajib dipilih"),
      pr_item_id: z.string().uuid().optional(),
      satuan_id: z.string().uuid().optional(),
      qty_ordered: z.number().min(0.0001, "Jumlah pesanan minimal 0.0001"),
      harga_satuan: z.number().min(0, "Harga tidak boleh negatif"),
      notes: z.string().optional(),
    })
  ).min(1, "Minimal 1 item PO"),
});

const productPoSchema = z.object({
  vendor_id: z.string().uuid("Vendor is required"),
  pr_id: z.string().uuid().optional(),
  tanggal_po: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date format must be YYYY-MM-DD"),
  tanggal_kirim_estimasi: optionalDateSchema,
  catatan: z.string().optional(),
  alamat_pengiriman: z.string().optional(),
  diskon_persen: z.number().min(0).max(100).default(0),
  diskon_nominal: z.number().min(0).default(0),
  ppn_persen: z.number().min(0).max(100).default(11),
  source_type: z.enum(["manual", "production_order", "low_stock"]).optional().default("manual"),
  items: z.array(
    z.object({
      product_id: z.string().uuid("Product is required"),
      pr_item_id: z.string().uuid().optional(),
      satuan_id: z.string().uuid().optional(),
      qty_ordered: z.number().min(0.0001, "Order quantity must be at least 0.0001"),
      harga_satuan: z.number().min(0, "Price cannot be negative"),
      notes: z.string().optional(),
    })
  ).min(1, "At least one PO item is required"),
});

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// Helper: Generate nomor PO
async function generateNomorPO(db: Awaited<ReturnType<typeof createServerPgClient>>): Promise<string> {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const prefix = `PO-${year}${month}`;
  
  // Get latest PO number for this month
  const { data, error } = await db
    .from("purchase_orders")
    .select("nomor_po")
    .ilike("nomor_po", `${prefix}-%`)
    .order("nomor_po", { ascending: false })
    .limit(1);
  
  if (error) throw error;
  
  let nextNumber = 1;
  if (data && data.length > 0) {
    const lastNumber = parseInt(data[0].nomor_po.split("-").pop() || "0");
    nextNumber = lastNumber + 1;
  }
  
  return `${prefix}-${String(nextNumber).padStart(4, "0")}`;
}

// GET /api/purchasing/po
export async function GET(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const { searchParams } = new URL(request.url);

    // Query params
    const search = searchParams.get("search");
    const status = searchParams.get("status");
    const supplierId = searchParams.get("supplier_id");
    const vendorId = searchParams.get("vendor_id");
    const moduleType = searchParams.get("module_type") || "raw_material";
    const tanggalMulai = searchParams.get("tanggal_mulai");
    const tanggalSampai = searchParams.get("tanggal_sampai");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    // Build query
    let query = db
      .from("v_purchase_orders")
      .select("*", { count: "exact" });

    // Business scope: branch
    const scope = await getApiUserScope();
    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    // Filters
    if (search) {
      if (moduleType === "product") {
        query = query.or(`nomor_po.ilike.%${search}%,vendor_name.ilike.%${search}%`);
      } else {
        query = query.or(`nomor_po.ilike.%${search}%,nama_supplier.ilike.%${search}%`);
      }
    }
    if (status) {
      query = query.eq("status", status.toLowerCase());
    }
    if (supplierId) {
      query = query.eq("supplier_id", supplierId);
    }
    if (vendorId) {
      query = query.eq("vendor_id", vendorId);
    }
    if (moduleType === "raw_material" || moduleType === "product") {
      query = query.eq("module_type", moduleType);
    }
    if (tanggalMulai) {
      query = query.gte("tanggal_po", tanggalMulai);
    }
    if (tanggalSampai) {
      query = query.lte("tanggal_po", tanggalSampai);
    }

    // Exclude cancelled dari default view
    if (!searchParams.get("include_cancelled")) {
      query = query.neq("status", "cancelled");
    }

    // Pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Execute query
    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const poIds = (data || []).map((po) => po.id).filter(Boolean);
    const { data: deliveries, error: deliveriesError } = poIds.length
      ? await db
          .from("deliveries")
          .select("id, purchase_order_id, nomor_resi, no_surat_jalan, status, created_at")
          .in("purchase_order_id", poIds)
          .eq("is_active", true)
          .neq("status", "cancelled")
          .order("created_at", { ascending: false })
      : { data: [], error: null };

    if (deliveriesError) throw deliveriesError;

    const prIds = Array.from(
      new Set((data || []).map((po) => po.pr_id).filter(Boolean) as string[])
    );
    const { data: purchaseRequests, error: prError } = prIds.length
      ? await db.from("purchase_requests").select("id, pr_number").in("id", prIds)
      : { data: [], error: null };

    if (prError) throw prError;

    const prNumberById = new Map(
      (purchaseRequests || []).map((pr) => [pr.id as string, pr.pr_number as string])
    );

    const openDeliveryByPoId = new Map<string, (typeof deliveries)[number]>();
    const latestDeliveryByPoId = new Map<string, (typeof deliveries)[number]>();
    for (const delivery of deliveries || []) {
      const poId = delivery.purchase_order_id as string;
      if (!latestDeliveryByPoId.has(poId)) {
        latestDeliveryByPoId.set(poId, delivery);
      }
      if (!openDeliveryByPoId.has(poId) && isOpenDeliveryStatus(delivery.status)) {
        openDeliveryByPoId.set(poId, delivery);
      }
    }

    const mappedData = (data || []).map((po) => {
      const openDelivery = openDeliveryByPoId.get(po.id);
      const latestDelivery = latestDeliveryByPoId.get(po.id);
      const prId = po.pr_id as string | null | undefined;
      return {
        ...po,
        pr_number: prId ? prNumberById.get(prId) ?? null : null,
        active_delivery_id: openDelivery?.id || null,
        active_delivery_number:
          openDelivery?.nomor_resi ||
          openDelivery?.no_surat_jalan ||
          latestDelivery?.nomor_resi ||
          latestDelivery?.no_surat_jalan ||
          null,
        active_delivery_status: openDelivery?.status || latestDelivery?.status || null,
      };
    });

    return Response.json({
      success: true,
      data: mappedData,
      pagination: {
        page,
        limit,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching PO:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal mengambil data PO") },
      { status: 500 }
    );
  }
}

// POST /api/purchasing/po
export async function POST(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const body = await request.json();
    const moduleType = body?.module_type === "product" ? "product" : "raw_material";
    const validated =
      moduleType === "product" ? productPoSchema.parse(body) : poSchema.parse(body);
    const scope = await getApiUserScope();
    let companyId = effectiveCompanyId(scope);
    let branchId = effectiveBranchId(scope);

    if (moduleType === "raw_material" && !validated.pr_id) {
      return Response.json(
        {
          success: false,
          message: "Purchase order must be created from an approved purchase request",
        },
        { status: 400 }
      );
    }

    if (validated.pr_id) {
      const { data: linkedPr } = await db
        .from("purchase_requests")
        .select("id, status, converted_po_id, company_id, branch_id")
        .eq("id", validated.pr_id)
        .maybeSingle();

      if (!linkedPr) {
        return Response.json(
          { success: false, message: "PR tidak ditemukan" },
          { status: 404 }
        );
      }
      if (linkedPr.status !== "approved") {
        return Response.json(
          { success: false, message: "PR harus approved sebelum dibuatkan PO" },
          { status: 400 }
        );
      }
      if (linkedPr.converted_po_id) {
        return Response.json(
          { success: false, message: "PR sudah dibuatkan PO" },
          { status: 400 }
        );
      }

      companyId = linkedPr.company_id ?? companyId;
      branchId = linkedPr.branch_id ?? branchId;
    }

    if (!companyId || !branchId) {
      if (moduleType === "product" && "vendor_id" in validated) {
        const { data: vendor, error: vendorError } = await db
          .from("vendors")
          .select("company_id, branch_id")
          .eq("id", validated.vendor_id)
          .maybeSingle();

        if (vendorError) throw vendorError;

        companyId = companyId ?? vendor?.company_id ?? scope?.companyId ?? null;
        branchId =
          branchId ??
          vendor?.branch_id ??
          (scope?.businessScope === "branch" ? scope.branchId : null) ??
          null;
      } else if ("supplier_id" in validated) {
        const { data: supplier, error: supplierError } = await db
          .from("suppliers")
          .select("company_id, branch_id")
          .eq("id", validated.supplier_id)
          .maybeSingle();

        if (supplierError) throw supplierError;

        companyId = companyId ?? supplier?.company_id ?? scope?.companyId ?? null;
        branchId =
          branchId ??
          supplier?.branch_id ??
          (scope?.businessScope === "branch" ? scope.branchId : null) ??
          null;
      }
    }

    const { items, ...poPayload } = validated;
    const subtotal = items.reduce((sum, item) => sum + item.qty_ordered * item.harga_satuan, 0);
    const diskonNominal = poPayload.diskon_persen
      ? (subtotal * poPayload.diskon_persen) / 100
      : poPayload.diskon_nominal;
    const taxableAmount = Math.max(0, subtotal - diskonNominal);
    const ppnNominal = (taxableAmount * poPayload.ppn_persen) / 100;
    const total = taxableAmount + ppnNominal;

    // Generate nomor PO
    const nomor_po = await generateNomorPO(db);

    // Insert PO dengan status draft
    const insertData = {
      ...poPayload,
      nomor_po,
      company_id: companyId,
      branch_id: branchId,
      module_type: moduleType,
      supplier_id: moduleType === "product" ? null : (poPayload as { supplier_id: string }).supplier_id,
      vendor_id: moduleType === "product" ? (validated as z.infer<typeof productPoSchema>).vendor_id : null,
      status: "draft",
      subtotal,
      diskon_nominal: diskonNominal,
      ppn_nominal: ppnNominal,
      total,
      is_active: true,
    };

    const { data, error } = await db
      .from("purchase_orders")
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    const poItems = items.map((item) => {
      if ("product_id" in item) {
        return {
          purchase_order_id: data.id,
          product_id: item.product_id,
          raw_material_id: null,
          pr_item_id: item.pr_item_id || null,
          satuan_id: item.satuan_id || null,
          qty_ordered: item.qty_ordered,
          harga_satuan: item.harga_satuan,
          catatan: item.notes || null,
          is_active: true,
        };
      }
      return {
        purchase_order_id: data.id,
        raw_material_id: item.raw_material_id,
        product_id: null,
        pr_item_id: item.pr_item_id || null,
        satuan_id: item.satuan_id || null,
        qty_ordered: item.qty_ordered,
        harga_satuan: item.harga_satuan,
        catatan: item.notes || null,
        is_active: true,
      };
    });

    const { error: itemError } = await db
      .from("purchase_order_items")
      .insert(poItems);

    if (itemError) throw itemError;

    if (poPayload.pr_id) {
      const { error: prUpdateError } = await db
        .from("purchase_requests")
        .update({
          status: "converted",
          converted_po_id: data.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", poPayload.pr_id)
        .eq("status", "approved")
        .is("converted_po_id", null);

      if (prUpdateError) throw prUpdateError;
    }

    return Response.json(
      { success: true, data, message: "PO berhasil dibuat" },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Error creating PO:", error);

    if (error instanceof z.ZodError) {
      return Response.json(
        {
          success: false,
          message: "Validasi gagal",
          errors: error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal membuat PO") },
      { status: 500 }
    );
  }
}
