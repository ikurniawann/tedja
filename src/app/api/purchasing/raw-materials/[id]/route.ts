// ============================================
// API ROUTE: /api/purchasing/raw-materials/[id]
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { z } from "zod";
import {
  getErrorMessage,
  throwIfDbError,
  UNIT_CONVERSION_SELECT,
  prepareMaterialBody,
} from "../_helpers";
import {
  getApiUserScope,
  isRowInBusinessScope,
} from "@/lib/api/scope";

const materialSchema = z.object({
  nama: z.string().min(1).max(100).optional(),
  kategori: z.string().min(1).max(30).optional(),
  deskripsi: z.string().optional(),
  satuan_besar_id: z.string().uuid().optional().nullable(),
  satuan_kecil_id: z.string().uuid().optional().nullable(),
  harga_beli: z.number().min(0).optional(),
  konversi_factor: z.number().min(0).optional(),
  stok_minimum: z.number().min(0).optional(),
  stok_maximum: z.number().min(0).optional(),
  shelf_life_days: z.number().min(0).optional().nullable(),
  storage_condition: z.string().max(20).optional().nullable(),
  is_active: z.boolean().optional(),
  unit_conversions: z.array(z.object({
    satuan_id: z.string().uuid(),
    qty_in_base_unit: z.number().min(0.000001),
    is_base: z.boolean().optional(),
  })).optional(),
});

// GET /api/purchasing/raw-materials/:id
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();
    const scope = await getApiUserScope();

    // Get material dengan stok info
    const { data, error } = await db
      .from("v_raw_materials_stock")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return Response.json(
          { success: false, message: "Bahan baku tidak ditemukan" },
          { status: 404 }
        );
      }
      throwIfDbError(error);
    }

    if (
      !isRowInBusinessScope(scope, {
        company_id: data.company_id,
        branch_id: data.branch_id,
      })
    ) {
      return Response.json(
        { success: false, message: "Bahan baku tidak ditemukan" },
        { status: 404 }
      );
    }

    // Get suppliers dengan harga
    const { data: suppliers, error: suppliersError } = await db
      .from("supplier_price_lists")
      .select(`
        *,
        supplier:suppliers!supplier_id (
          id,
          kode,
          nama_supplier
        ),
        satuan:units!satuan_id (*)
      `)
      .eq("bahan_baku_id", id)
      .eq("is_active", true)
      .order("is_preferred", { ascending: false });

    if (suppliersError) throwIfDbError(suppliersError);

    // Get inventory movements terakhir
    const { data: movements, error: movementsError } = await db
      .from("inventory_movements")
      .select("*")
      .eq("raw_material_id", id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (movementsError) throwIfDbError(movementsError);

    // Get products yang menggunakan bahan ini
    const { data: products, error: productsError } = await db
      .from("bom_items")
      .select(`
        *,
        product:products!product_id (*)
      `)
      .eq("raw_material_id", id)
      .eq("is_active", true);

    if (productsError) throwIfDbError(productsError);

    const { data: unitConversions, error: conversionsError } = await db
      .from("raw_material_unit_conversions")
      .select(UNIT_CONVERSION_SELECT)
      .eq("raw_material_id", id)
      .eq("is_active", true)
      .order("is_base", { ascending: false })
      .order("qty_in_base_unit", { ascending: true });

    if (conversionsError) throwIfDbError(conversionsError);

    return Response.json({
      success: true,
      data: {
        ...data,
        suppliers: suppliers || [],
        movements: movements || [],
        products: products || [],
        unit_conversions: unitConversions || [],
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching raw material:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal mengambil data bahan baku") },
      { status: 500 }
    );
  }
}

// PUT /api/purchasing/raw-materials/:id
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();
    const body = prepareMaterialBody(await request.json());
    const validated = materialSchema.parse(body);

    // Cek apakah material ada
    const { data: existingMaterial, error: findError } = await db
      .from("raw_materials")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (findError || !existingMaterial) {
      return Response.json(
        { success: false, message: "Bahan baku tidak ditemukan" },
        { status: 404 }
      );
    }

    // Warning jika konversi_factor berubah dan ada di BOM
    if (validated.konversi_factor !== undefined &&
        validated.konversi_factor !== existingMaterial.konversi_factor) {
      const { data: bomItems } = await db
        .from("bom_items")
        .select("id")
        .eq("raw_material_id", id)
        .eq("is_active", true)
        .limit(1);

      if (bomItems && bomItems.length > 0) {
        // Konversi berubah; update tetap dilanjutkan karena BOM menyimpan qty eksplisit.
      }
    }

    const { unit_conversions, ...materialPayload } = validated;

    // Update data
    const { data, error } = await db
      .from("raw_materials")
      .update({
        ...materialPayload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select()
      .single();

    if (error) throwIfDbError(error);

    if (unit_conversions) {
      const conversions = [
        ...(data.satuan_kecil_id
          ? [{ satuan_id: data.satuan_kecil_id, qty_in_base_unit: 1, is_base: true }]
          : []),
        ...(data.satuan_besar_id
          ? [{ satuan_id: data.satuan_besar_id, qty_in_base_unit: data.satuan_kecil_id ? data.konversi_factor || 1 : 1, is_base: !data.satuan_kecil_id }]
          : []),
        ...unit_conversions.map((conversion) => ({ ...conversion, is_base: conversion.is_base ?? false })),
      ];
      const conversionsByUnit = new Map<string, (typeof conversions)[number]>();
      for (const conversion of conversions) {
        if (!conversionsByUnit.has(conversion.satuan_id)) {
          conversionsByUnit.set(conversion.satuan_id, conversion);
        }
      }
      const uniqueConversions = Array.from(conversionsByUnit.values());

      const { data: existingConversions, error: existingError } = await db
        .from("raw_material_unit_conversions")
        .select("id,satuan_id")
        .eq("raw_material_id", id);

      if (existingError) throwIfDbError(existingError);

      const nextUnitIds = new Set(uniqueConversions.map((conversion) => conversion.satuan_id));
      const inactiveIds = (existingConversions || [])
        .filter((conversion) => !nextUnitIds.has(conversion.satuan_id))
        .map((conversion) => conversion.id);

      if (inactiveIds.length > 0) {
        const { error: inactiveError } = await db
          .from("raw_material_unit_conversions")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .in("id", inactiveIds);

        if (inactiveError) throwIfDbError(inactiveError);
      }

      if (uniqueConversions.length > 0) {
        const { error: conversionError } = await db
          .from("raw_material_unit_conversions")
          .upsert(
            uniqueConversions.map((conversion) => ({
              raw_material_id: id,
              satuan_id: conversion.satuan_id,
              qty_in_base_unit: conversion.qty_in_base_unit,
              is_base: conversion.is_base,
              is_active: true,
              updated_at: new Date().toISOString(),
            })),
            { onConflict: "raw_material_id,satuan_id" }
          );

        if (conversionError) throwIfDbError(conversionError);
      }
    }

    return Response.json({
      success: true,
      data,
      message: "Bahan baku berhasil diupdate",
    });
  } catch (error: unknown) {
    console.error("Error updating raw material:", error);

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
      { success: false, message: getErrorMessage(error, "Gagal mengupdate bahan baku") },
      { status: 500 }
    );
  }
}

// PATCH /api/purchasing/raw-materials/:id
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return PUT(request, { params });
}

// DELETE /api/purchasing/raw-materials/:id
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();
    const { data: authData } = await db.auth.getUser();

    // Cek apakah material ada
    const { data: material, error: findError } = await db
      .from("raw_materials")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (findError || !material) {
      return Response.json(
        { success: false, message: "Bahan baku tidak ditemukan" },
        { status: 404 }
      );
    }

    // Cek apakah ada stok > 0
    const { data: inventory } = await db
      .from("inventory")
      .select("qty_onhand")
      .eq("raw_material_id", id)
      .single();

    if (inventory && inventory.qty_onhand > 0) {
      return Response.json(
        {
          success: false,
          message: `Bahan baku tidak bisa dihapus karena masih ada stok ${inventory.qty_onhand} ${material.satuan_besar_id || 'unit'}`,
        },
        { status: 400 }
      );
    }

    // Cek apakah digunakan di BOM
    const { data: bomItems } = await db
      .from("bom_items")
      .select("id")
      .eq("raw_material_id", id)
      .eq("is_active", true)
      .limit(1);

    if (bomItems && bomItems.length > 0) {
      return Response.json(
        {
          success: false,
          message: "Bahan baku tidak bisa dihapus karena masih digunakan di BOM produk",
        },
        { status: 400 }
      );
    }

    // Soft delete
    const { error } = await db
      .from("raw_materials")
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        deleted_by: authData.user?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .is("deleted_at", null);

    if (error) throwIfDbError(error);

    return Response.json({
      success: true,
      message: "Bahan baku berhasil dihapus",
    });
  } catch (error: unknown) {
    console.error("Error deleting raw material:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal menghapus bahan baku") },
      { status: 500 }
    );
  }
}
