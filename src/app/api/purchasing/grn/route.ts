import { createServerPgClient } from "@/lib/pg/create-client";
import { createPgClient } from "@/lib/pg/create-client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireApiRole,
  ApiError,
  successResponse,
  createdResponse,
  paginatedResponse,
} from "@/lib/api/auth";
import {
  generateGrnNumber,
  validateDeliveryCanReceive,
  calculateGrnTotals,
  updatePOItemReceivedQty,
  updateDeliveryStatusAfterGrn,
  updatePOStatusAfterGrn,
  GrnStatus,
} from "@/lib/purchasing/grn";
import { toQty } from "@/lib/purchasing/utils";
import { syncReceiveRejectCredits } from "@/lib/purchasing/vendor-credit-service";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
  validateWarehouseForReceivingScope,
  resolveBusinessScopeFromWarehouse,
  resolveBusinessScopeByCodes,
} from "@/lib/api/scope";

// ============================================================
// Schemas
// ============================================================

const grnItemSchema = z.object({
  delivery_id: z.string().uuid().optional(),
  purchase_order_item_id: z.string().uuid().optional(),
  raw_material_id: z.string().uuid("Bahan baku wajib dipilih"),
  qty_diterima: z.number().min(0, "Qty diterima minimal 0"),
  qty_ditolak: z.number().min(0, "Qty ditolak minimal 0"),
  satuan_id: z.string().uuid().optional(),
  kondisi: z.enum(["baik", "rusak", "cacat"]).default("baik"),
  catatan: z.string().optional().nullable(),
});

const createGrnSchema = z.object({
  delivery_id: z.string().uuid("Delivery wajib dipilih"),
  tanggal_penerimaan: z.string().optional(),
  catatan: z.string().optional(),
  warehouse_id: z.string().uuid("Gudang wajib dipilih"),
  items: z.array(grnItemSchema).min(1, "Minimal 1 item wajib diisi"),
});

const queryParamsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.enum(["pending", "partially_received", "received", "rejected"]).optional(),
  delivery_id: z.string().uuid().optional(),
  po_id: z.string().uuid().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

const updateGrnSchema = z.object({
  status: z.enum(["pending", "partially_received", "received", "rejected"]).optional(),
  catatan: z.string().optional(),
  items: z.array(grnItemSchema).optional(),
});

const QTY_EPSILON = 0.000001;

type POQtyValidationItem = {
  id: string;
  raw_material_id: string;
  qty_ordered?: number | null;
  qty_received?: number | null;
  raw_material?: {
    nama?: string | null;
    nama_bahan?: string | null;
  } | null;
};

function formatQty(value: number) {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 4,
  }).format(value);
}

function getMaterialLabel(item: POQtyValidationItem) {
  return item.raw_material?.nama || item.raw_material?.nama_bahan || "item ini";
}

// ============================================================
// GET /api/purchasing/grn - List GRN
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiRole([
      "warehouse_staff",
      "warehouse_admin",
      "purchasing_admin",
      "purchasing_staff",
      "qc_staff",
      "admin",
    ]);
    const db = await createServerPgClient();

    const { searchParams } = new URL(request.url);
    const params = queryParamsSchema.parse(Object.fromEntries(searchParams));
    const { page, limit, search, status, delivery_id, po_id, date_from, date_to } = params;
    const offset = (page - 1) * limit;

    let query = db
      .from("grn")
      .select("*", { count: "exact" })
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const scope = await getApiUserScope();
    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    if (status) query = query.eq("status", status);
    if (delivery_id) query = query.eq("delivery_id", delivery_id);
    if (po_id) query = query.eq("purchase_order_id", po_id);
    if (date_from) query = query.gte("tanggal_penerimaan", date_from);
    if (date_to) query = query.lte("tanggal_penerimaan", date_to);
    if (search) {
      query = query.or(`nomor_grn.ilike.%${search}%,no_surat_jalan.ilike.%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    // Fetch related data for display
    const deliveryIds = [...new Set((data || []).map((d: any) => d.delivery_id).filter(Boolean))];
    const poIds = [...new Set((data || []).map((d: any) => d.purchase_order_id).filter(Boolean))];
    
    let deliveryMap = new Map();
    let poMap = new Map();
    
    if (deliveryIds.length > 0) {
      const { data: deliveryData } = await db
        .from("deliveries")
        .select("id, nomor_resi, no_resi")
        .in("id", deliveryIds);
      if (deliveryData) {
        deliveryMap = new Map(deliveryData.map((d: any) => [d.id, d.no_resi || d.nomor_resi]));
      }
    }
    
    if (poIds.length > 0) {
      const { data: poData } = await db
        .from("purchase_orders")
        .select("id, nomor_po")
        .in("id", poIds);
      if (poData) {
        poMap = new Map(poData.map((po: any) => [po.id, po.nomor_po]));
      }
    }

    // Fetch supplier names
    const supplierIds = [...new Set((data || []).map((d: any) => d.supplier_id).filter(Boolean))];
    let supplierMap = new Map();
    if (supplierIds.length > 0) {
      const { data: supplierData } = await db
        .from("suppliers")
        .select("id, nama_supplier")
        .in("id", supplierIds);
      if (supplierData) {
        supplierMap = new Map(supplierData.map((s: any) => [s.id, s.nama_supplier]));
      }
    }

    // Transform data
    const transformedData = (data || []).map((d: any) => ({
      id: d.id,
      nomor_grn: d.nomor_grn,
      delivery_id: d.delivery_id,
      delivery_number: deliveryMap.get(d.delivery_id) || d.delivery_id,
      po_id: d.purchase_order_id,
      po_number: poMap.get(d.purchase_order_id) || d.purchase_order_id,
      supplier_id: d.supplier_id,
      supplier_name: supplierMap.get(d.supplier_id) || "—",
      tanggal_penerimaan: d.tanggal_penerimaan,
      no_surat_jalan: d.no_surat_jalan,
      status: d.status,
      total_item_diterima: d.total_item_diterima,
      total_item_ditolak: d.total_item_ditolak,
      receive_count: d.receive_count || 1, // Penerimaan ke-berapa
      catatan: d.catatan,
      created_at: d.created_at,
    }));

    return paginatedResponse(
      transformedData,
      {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
      "GRN list retrieved"
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validation failed", error.issues).toResponse();
    }
    console.error("Error fetching GRN:", error);
    return ApiError.server("Failed to fetch GRN").toResponse();
  }
}

// ============================================================
// POST /api/purchasing/grn - Create GRN
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiRole([
      "warehouse_staff",
      "warehouse_admin",
      "purchasing_admin",
      "purchasing_staff",
      "admin",
      "super_admin",
    ]);
    const db = await createServerPgClient();
    // Use admin client to bypass RLS for all internal PO/delivery reads
    const adminDb = createPgClient();

    const body = await request.json();
    const validated = createGrnSchema.parse(body);

    // Validate delivery can be received — use adminDb to bypass RLS
    const { valid, errors, delivery, items: poItems } = await validateDeliveryCanReceive(
      adminDb,
      validated.delivery_id
    );

    if (!delivery?.purchase_order_id) {
      throw ApiError.badRequest(errors.join("; ") || "Delivery tidak valid untuk penerimaan barang");
    }

    const scope = await getApiUserScope();

    const businessScope =
      (await resolveBusinessScopeFromWarehouse(validated.warehouse_id)) ??
      (await resolveBusinessScopeByCodes("SULU", "SULU-DAGO"));

    const warehouseCheck = await validateWarehouseForReceivingScope(
      validated.warehouse_id,
      scope,
      businessScope?.branch_id ?? null
    );
    if ("error" in warehouseCheck) {
      const messages: Record<typeof warehouseCheck.error, string> = {
        not_found: "Gudang tidak ditemukan",
        inactive: "Gudang tidak aktif",
        branch_mismatch: "Gudang tidak sesuai cabang yang diizinkan untuk penerimaan ini",
      };
      throw ApiError.badRequest(messages[warehouseCheck.error]);
    }

    if (businessScope) {
      const { error: poScopeError } = await adminDb
        .from("purchase_orders")
        .update({
          company_id: businessScope.company_id,
          branch_id: businessScope.branch_id,
        })
        .eq("id", delivery.purchase_order_id);

      if (poScopeError) {
        console.error("Failed to backfill PO business scope:", poScopeError);
      }

      const { error: deliveryScopeError } = await adminDb
        .from("deliveries")
        .update({
          company_id: businessScope.company_id,
          branch_id: businessScope.branch_id,
        })
        .eq("id", validated.delivery_id);

      if (deliveryScopeError) {
        console.error("Failed to backfill delivery business scope:", deliveryScopeError);
      }
    }

    // Re-fetch PO items directly with adminDb to ensure we get data (bypass RLS)
    const { data: freshPoItems, error: freshPoItemsError } = await adminDb
      .from("purchase_order_items")
      .select(`
        id,
        raw_material_id,
        qty_ordered,
        qty_received,
        harga_satuan
      `)
      .eq("purchase_order_id", delivery.purchase_order_id)
      .eq("is_active", true);

    if (freshPoItemsError) {
      throw ApiError.badRequest(
        freshPoItemsError.message || "Gagal memuat item PO untuk penerimaan"
      );
    }

    // Use freshPoItems as source of truth
    const effectivePoItems = (freshPoItems || poItems || []) as POQtyValidationItem[];

    if (!valid && !errors.some(e => e.includes('status'))) {
      throw ApiError.badRequest(errors.join("; "));
    }

    const processedQtyByItem = new Map<string, number>();
    for (const item of validated.items) {
      const key = item.purchase_order_item_id || item.raw_material_id;
      processedQtyByItem.set(
        key,
        (processedQtyByItem.get(key) || 0) + item.qty_diterima + item.qty_ditolak
      );
    }

    for (const item of validated.items) {
      const key = item.purchase_order_item_id || item.raw_material_id;
      const poItem = effectivePoItems.find((p) =>
        item.purchase_order_item_id
          ? p.id === item.purchase_order_item_id
          : p.raw_material_id === item.raw_material_id
      );

      if (!poItem) {
        throw ApiError.badRequest("Item PO tidak ditemukan untuk validasi penerimaan");
      }

      const remainingQty = Math.max(0, Number(poItem.qty_ordered || 0) - Number(poItem.qty_received || 0));
      const processedQty = processedQtyByItem.get(key) || 0;
      if (processedQty > remainingQty + QTY_EPSILON) {
        throw ApiError.badRequest(
          `Qty ${getMaterialLabel(poItem)} melebihi sisa PO. Maksimal ${formatQty(remainingQty)}, tetapi diinput ${formatQty(processedQty)} (diterima + ditolak).`
        );
      }
    }

    // Generate GRN number
    const grnNumber = await generateGrnNumber(adminDb);

    // Calculate totals
    const totals = calculateGrnTotals(validated.items);

    // Count how many times this delivery has been received (receive counter)
    // IMPORTANT: Count ALL GRNs for this delivery, including the one being created
    // because we want THIS to be N+1 where N is existing count
    const { count: previousGrnCount, error: countError } = await adminDb
      .from("grn")
      .select("*", { count: "exact", head: true })
      .eq("delivery_id", validated.delivery_id)
      .eq("is_active", true);
    
    if (countError) {
      console.error("Error counting GRNs:", countError);
    }
    
    const receiveCount = (previousGrnCount || 0) + 1; // This is the Nth receive
    console.log(`GRN receive_count: ${receiveCount} (previous: ${previousGrnCount}, delivery: ${validated.delivery_id})`);

    // Goods are physically received; stock posts after QC. Status stays pending until QC completes.
    let grnStatus: GrnStatus = "pending";

    if (totals.total_diterima === 0 && totals.total_ditolak > 0) {
      grnStatus = "rejected";
    }

    // Scope mengikuti gudang penerimaan (mis. Company Sulu / Cabang Sulu Dago)
    const insertData: Record<string, unknown> = {
      nomor_grn: grnNumber,
      delivery_id: validated.delivery_id,
      purchase_order_id: delivery.purchase_order_id,
      supplier_id: delivery.supplier_id,
      company_id: businessScope?.company_id ?? null,
      branch_id: businessScope?.branch_id ?? null,
      tanggal_penerimaan: validated.tanggal_penerimaan || new Date().toISOString().split("T")[0],
      no_surat_jalan: delivery.no_surat_jalan,
      catatan: validated.catatan || null,
      status: grnStatus,
      total_item_diterima: totals.total_diterima,
      total_item_ditolak: totals.total_ditolak,
      receive_count: receiveCount, // Track: ini penerimaan ke-berapa
      penerima_id: user.id,
      created_by: user.id,
    };

    const { data: grn, error: grnError } = await adminDb
      .from("grn")
      .insert(insertData)
      .select()
      .single();

    if (grnError) {
      console.error("GRN insert error:", grnError);
      throw ApiError.server(
        grnError.message || "Gagal menyimpan dokumen penerimaan barang"
      );
    }

    // Create GRN items
    const grnItems = validated.items.map((item) => ({
      grn_id: grn.id,
      delivery_id: validated.delivery_id,
      purchase_order_item_id: item.purchase_order_item_id,
      raw_material_id: item.raw_material_id,
      qty_diterima: item.qty_diterima,
      qty_ditolak: item.qty_ditolak,
      satuan_id: item.satuan_id,
      kondisi: item.kondisi,
      catatan: item.catatan || null,
      warehouse_id: validated.warehouse_id,
      qc_status: "pending",
    }));

    const { error: itemsError } = await adminDb.from("grn_items").insert(grnItems);

    if (itemsError) {
      console.error("GRN items insert error:", itemsError);
      throw ApiError.server(
        itemsError.message || "Gagal menyimpan item penerimaan barang"
      );
    }

    // Update PO item received quantities (adminDb bypasses RLS)
    for (const item of validated.items) {
      if (item.purchase_order_item_id) {
        const poItem = effectivePoItems.find((p: any) => p.id === item.purchase_order_item_id);
        if (poItem) {
          const newQty = toQty(poItem.qty_received) + toQty(item.qty_diterima);
          await updatePOItemReceivedQty(adminDb, item.purchase_order_item_id, newQty);
        } else {
          // Fallback: query item langsung
          const { data: directItem } = await adminDb
            .from("purchase_order_items")
            .select("id, qty_received")
            .eq("id", item.purchase_order_item_id)
            .single();
          if (directItem) {
            const newQty = toQty(directItem.qty_received) + toQty(item.qty_diterima);
              await updatePOItemReceivedQty(adminDb, item.purchase_order_item_id, newQty);
          } else {
            console.warn(`[GRN] PO item ${item.purchase_order_item_id} not found even with direct query`);
          }
        }
      } else {
        console.warn(`[GRN] item missing purchase_order_item_id for raw_material ${item.raw_material_id}`);
      }
    }

    // Physical receipt recorded — mark delivery arrived; stock posts after QC.
    if (grnStatus !== "rejected") {
      await adminDb
        .from("deliveries")
        .update({ status: "delivered", updated_at: new Date().toISOString() })
        .eq("id", validated.delivery_id);
    } else {
      await updateDeliveryStatusAfterGrn(adminDb, validated.delivery_id, grnStatus);
    }

    if (delivery?.purchase_order_id) {
      await updatePOStatusAfterGrn(adminDb, delivery.purchase_order_id);
    }

    try {
      await syncReceiveRejectCredits(adminDb, grn.id, user.id);
    } catch (creditErr) {
      console.error("[GRN] Vendor credit sync error (non-fatal):", creditErr);
    }

    return createdResponse(
      grn,
      grnStatus === "rejected"
        ? `GRN ${grnNumber} created — all items rejected at receipt`
        : `GRN ${grnNumber} created — proceed to quality control before stock is updated`
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validasi gagal", error.issues).toResponse();
    }
    const message =
      error instanceof Error ? error.message : "Gagal membuat penerimaan barang";
    console.error("Error creating GRN:", error);
    return ApiError.server(message).toResponse();
  }
}

// ============================================================
// PATCH /api/purchasing/grn - Update GRN (bulk update not supported)
// Use /api/purchasing/grn/[id] for single updates
// ============================================================

export async function PATCH() {
  return ApiError.badRequest("Use /api/purchasing/grn/[id] for updates").toResponse();
}
