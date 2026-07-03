import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPgClient } from "@/lib/pg/create-client";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { generatePONumber } from "@/lib/purchasing/utils";
import {
  effectiveBranchId,
  effectiveCompanyId,
  getApiUserScope,
} from "@/lib/api/scope";

const optionalDateSchema = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()])
  .optional()
  .transform((value) => value || null);

const convertSchema = z.object({
  supplier_id: z.string().uuid("Supplier wajib dipilih"),
  tanggal_po: optionalDateSchema,
  tanggal_kirim_estimasi: optionalDateSchema,
  catatan: z.string().optional().nullable(),
  alamat_pengiriman: z.string().optional().nullable(),
  diskon_persen: z.number().min(0).max(100).default(0),
  diskon_nominal: z.number().min(0).default(0),
  ppn_persen: z.number().min(0).max(100).default(11),
});

type PRItemRow = {
  id: string;
  raw_material_id: string | null;
  satuan_id: string | null;
  qty: number | null;
  estimated_price: number | null;
  description: string | null;
};

type ConversionRow = {
  raw_material_id: string;
  satuan_id: string;
  qty_in_base_unit: number;
};

type PriceRow = {
  bahan_baku_id: string;
  satuan_id: string | null;
  harga: number | null;
  is_preferred: boolean | null;
};

function getConversionFactor(conversions: ConversionRow[], materialId: string, unitId?: string | null) {
  if (!unitId) return 1;
  const conversion = conversions.find(
    (item) => item.raw_material_id === materialId && item.satuan_id === unitId
  );
  return Number(conversion?.qty_in_base_unit || 1);
}

function findSupplierPrice(prItem: PRItemRow, prices: PriceRow[]) {
  return prices
    .filter((price) =>
      price.bahan_baku_id === prItem.raw_material_id &&
      price.satuan_id &&
      Number(price.harga || 0) > 0
    )
    .sort((a, b) => {
      if (Boolean(a.is_preferred) !== Boolean(b.is_preferred)) return a.is_preferred ? -1 : 1;
      return Number(a.harga || 0) - Number(b.harga || 0);
    })[0] || null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let insertedPoId: string | null = null;
  let conversionFinalized = false;
  try {
    const { id } = await params;
    const user = await requireApiRole([
      "purchasing_staff",
      "purchasing_manager",
      "purchasing_admin",
      "super_admin",
      "admin",
    ]);
    const body = await request.json();
    const payload = convertSchema.parse(body);
    const db = createPgClient();

    const { data: pr, error: prError } = await db
      .from("purchase_requests")
      .select("id,status,converted_po_id,company_id,branch_id")
      .eq("id", id)
      .single();

    if (prError || !pr) throw ApiError.notFound("PR tidak ditemukan");
    if (pr.status !== "approved") throw ApiError.badRequest("PR harus approved sebelum dibuatkan PO");
    if (pr.converted_po_id) throw ApiError.badRequest("PR sudah dibuatkan PO");

    const scope = await getApiUserScope();
    const companyId = pr.company_id ?? effectiveCompanyId(scope);
    const branchId = pr.branch_id ?? effectiveBranchId(scope);

    const { data: prItems, error: prItemsError } = await db
      .from("pr_items")
      .select("id,raw_material_id,satuan_id,qty,estimated_price,description")
      .eq("pr_id", id);

    if (prItemsError) throw prItemsError;
    if (!prItems || prItems.length === 0) throw ApiError.badRequest("PR tidak memiliki item");

    const materialIds = [...new Set((prItems as PRItemRow[]).map((item) => item.raw_material_id).filter(Boolean))] as string[];

    const [{ data: prices, error: pricesError }, { data: conversions, error: conversionsError }] = await Promise.all([
      db
        .from("supplier_price_lists")
        .select("bahan_baku_id,satuan_id,harga,is_preferred")
        .eq("supplier_id", payload.supplier_id)
        .in("bahan_baku_id", materialIds)
        .eq("is_active", true),
      db
        .from("raw_material_unit_conversions")
        .select("raw_material_id,satuan_id,qty_in_base_unit")
        .in("raw_material_id", materialIds)
        .eq("is_active", true),
    ]);

    if (pricesError) throw pricesError;
    if (conversionsError) throw conversionsError;

    const poNumber = await generatePONumber(db);
    const { data: insertedPo, error: poInsertError } = await db
      .from("purchase_orders")
      .insert({
        nomor_po: poNumber,
        pr_id: id,
        supplier_id: payload.supplier_id,
        company_id: companyId,
        branch_id: branchId,
        tanggal_po: payload.tanggal_po || new Date().toISOString().split("T")[0],
        tanggal_kirim_estimasi: payload.tanggal_kirim_estimasi || null,
        status: "draft",
        diskon_persen: payload.diskon_persen,
        diskon_nominal: payload.diskon_nominal,
        ppn_persen: payload.ppn_persen,
        catatan: payload.catatan || null,
        alamat_pengiriman: payload.alamat_pengiriman || null,
        created_by: user.id,
        updated_by: user.id,
        is_active: true,
      })
      .select("id")
      .single();

    if (poInsertError) throw poInsertError;
    insertedPoId = insertedPo.id;

    const poItems = (prItems as PRItemRow[]).map((item) => {
      if (!item.raw_material_id) {
        throw ApiError.badRequest("Item PR belum terhubung ke master bahan baku");
      }

      const price = findSupplierPrice(item, (prices || []) as PriceRow[]);
      const targetUnitId = item.satuan_id || price?.satuan_id;
      const priceUnitId = price?.satuan_id || targetUnitId;
      const priceFactor = getConversionFactor((conversions || []) as ConversionRow[], item.raw_material_id, priceUnitId);
      const targetFactor = getConversionFactor((conversions || []) as ConversionRow[], item.raw_material_id, targetUnitId);
      const requestedQty = Number(item.qty || 0);
      const qtyOrdered = requestedQty;
      const supplierPrice = Number(price?.harga ?? item.estimated_price ?? 0);
      const unitPrice = price && priceFactor > 0
        ? Math.round((supplierPrice / priceFactor) * targetFactor)
        : supplierPrice;

      return {
        purchase_order_id: insertedPo.id,
        pr_item_id: item.id,
        raw_material_id: item.raw_material_id,
        qty_ordered: qtyOrdered,
        satuan_id: targetUnitId,
        harga_satuan: unitPrice,
        diskon_item: 0,
        catatan: item.description,
        is_active: true,
      };
    });

    const { error: itemInsertError } = await db
      .from("purchase_order_items")
      .insert(poItems);

    if (itemInsertError) throw itemInsertError;

    const subtotal = poItems.reduce((sum, item) => sum + item.qty_ordered * item.harga_satuan, 0);
    const discount = payload.diskon_persen > 0 ? subtotal * payload.diskon_persen / 100 : payload.diskon_nominal;
    const ppn = Math.max(0, subtotal - discount) * payload.ppn_persen / 100;
    const total = Math.max(0, subtotal - discount) + ppn;

    const { error: updatePoError } = await db
      .from("purchase_orders")
      .update({
        subtotal,
        diskon_nominal: discount,
        ppn_nominal: ppn,
        total,
        updated_at: new Date().toISOString(),
      })
      .eq("id", insertedPo.id);

    if (updatePoError) throw updatePoError;

    const { error: updatePrError } = await db
      .from("purchase_requests")
      .update({
        status: "converted",
        converted_po_id: insertedPo.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updatePrError) throw updatePrError;
    conversionFinalized = true;

    const { data: po, error: poError } = await db
      .from("v_purchase_orders")
      .select("*")
      .eq("id", insertedPo.id)
      .single();

    if (poError) throw poError;

    if ((prices || []).length === 0) {
      console.warn("PO created from PR without matching supplier price list; PR estimates were used.");
    }

    return NextResponse.json(
      {
        success: true,
        data: po,
        message: "PR berhasil dikonversi menjadi PO",
      },
      { status: 201 }
    );
  } catch (error) {
    if (insertedPoId && !conversionFinalized) {
      try {
        const db = createPgClient();
        await db.from("purchase_orders").delete().eq("id", insertedPoId);
      } catch (cleanupError) {
        console.error("Error cleaning up failed PO conversion:", cleanupError);
      }
    }

    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validasi gagal", error.issues).toResponse();
    }
    console.error("Error converting PR to PO:", error);
    return ApiError.server("Gagal membuat PO dari PR").toResponse();
  }
}
