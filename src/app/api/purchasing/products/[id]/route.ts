// ============================================
// API ROUTE: /api/purchasing/products/[id]
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getApiUserScope, isRowInBusinessScope } from "@/lib/api/scope";
import { z } from "zod";

const productSchema = z.object({
  nama: z.string().min(1).max(100).optional(),
  deskripsi: z.string().optional().nullable(),
  kategori: z.string().optional().nullable(),
  satuan_id: z.string().uuid().optional().nullable(),
  harga_jual: z.number().min(0).optional(),
  harga_modal: z.number().min(0).optional(),
  markup_persen: z.number().optional(),
  is_active: z.boolean().optional(),
  production_output_type: z.enum(["FINISHED_GOOD", "WIP"]).optional(),
});

type BomItemRow = {
  raw_material_id?: string | null;
  qty_required?: number | null;
  waste_factor?: number | null;
  raw_material?: {
    avg_cost?: number | null;
    harga_avg?: number | null;
    harga_terakhir?: number | null;
  } | null;
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getMaterialCost(
  item: BomItemRow,
  stockCostMap: Map<string, number>
) {
  const materialId = item.raw_material_id;
  if (materialId && stockCostMap.has(materialId)) {
    return stockCostMap.get(materialId) ?? 0;
  }

  return Number(
    item.raw_material?.avg_cost ??
      item.raw_material?.harga_avg ??
      item.raw_material?.harga_terakhir ??
      0
  );
}

// GET /api/purchasing/products/:id
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();
    const scope = await getApiUserScope();

    // Get product dengan HPP
    const { data: product, error: productError } = await db
      .from("v_products_cogs")
      .select("*")
      .eq("id", id)
      .single();

    if (productError) {
      if (productError.code === "PGRST116") {
        return Response.json(
          { success: false, message: "Produk tidak ditemukan" },
          { status: 404 }
        );
      }
      throw productError;
    }

    if (
      !isRowInBusinessScope(scope, {
        company_id: product.company_id,
        branch_id: product.branch_id,
      })
    ) {
      return Response.json(
        { success: false, message: "Produk tidak ditemukan" },
        { status: 404 }
      );
    }

    // Get BOM items
    const { data: bomItems, error: bomError } = await db
      .from("bom_items")
      .select(`
        *,
        raw_material:raw_materials!raw_material_id (*),
        satuan:units!satuan_id (*)
      `)
      .eq("product_id", id)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (bomError) throw bomError;

    const materialIds = Array.from(
      new Set((bomItems || []).map((item) => item.raw_material_id).filter(Boolean))
    );
    const { data: stockCosts } = materialIds.length > 0
      ? await db
          .from("v_raw_materials_stock")
          .select("id, avg_cost")
          .in("id", materialIds)
      : { data: [] };
    const stockCostMap = new Map(
      (stockCosts || []).map((material) => [material.id, Number(material.avg_cost ?? 0)])
    );

    let totalHPP = 0;
    const bomWithCost = (bomItems || []).map((item) => {
      const bomItem = item as BomItemRow;
      const materialCost = getMaterialCost(bomItem, stockCostMap);
      const qtyNeeded = Number(bomItem.qty_required ?? 0) * (1 + Number(bomItem.waste_factor ?? 0));
      const itemCost = materialCost * qtyNeeded;
      totalHPP += itemCost;
      return {
        ...item,
        cost_per_unit: materialCost,
        total_cost: itemCost,
      };
    });

    return Response.json({
      success: true,
      data: {
        ...product,
        bom_items: bomWithCost,
        hpp_calculated: totalHPP,
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching product:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal mengambil data produk") },
      { status: 500 }
    );
  }
}

// PUT /api/purchasing/products/:id
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();
    const body = await request.json();

    // Validasi input
    const validated = productSchema.parse(body);

    // Cek apakah produk ada
    const { data: existingProduct, error: findError } = await db
      .from("products")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (findError || !existingProduct) {
      return Response.json(
        { success: false, message: "Produk tidak ditemukan" },
        { status: 404 }
      );
    }

    // Update data
    const { data, error } = await db
      .from("products")
      .update({
        ...validated,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select()
      .single();

    if (error) throw error;

    return Response.json({
      success: true,
      data,
      message: "Produk berhasil diupdate",
    });
  } catch (error: unknown) {
    console.error("Error updating product:", error);

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
      { success: false, message: getErrorMessage(error, "Gagal mengupdate produk") },
      { status: 500 }
    );
  }
}

// DELETE /api/purchasing/products/:id
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();
    const { data: authData } = await db.auth.getUser();

    // Cek apakah produk ada
    const { data: product, error: findError } = await db
      .from("products")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (findError || !product) {
      return Response.json(
        { success: false, message: "Produk tidak ditemukan" },
        { status: 404 }
      );
    }

    // Soft delete
    const { error } = await db
      .from("products")
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        deleted_by: authData.user?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .is("deleted_at", null);

    if (error) throw error;

    return Response.json({
      success: true,
      message: "Produk berhasil dihapus",
    });
  } catch (error: unknown) {
    console.error("Error deleting product:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal menghapus produk") },
      { status: 500 }
    );
  }
}
