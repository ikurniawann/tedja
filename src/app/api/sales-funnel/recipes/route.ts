import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, withTransaction } from "@/lib/db";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

const recipeItemSchema = z.object({
  raw_material_id: z.string().uuid(),
  quantity_per_unit: z.number().positive().max(1_000_000),
  waste_percentage: z.number().min(0).max(100).default(0),
});

const putSchema = z.object({
  product_id: z.string().uuid(),
  items: z.array(recipeItemSchema).max(50),
});

/**
 * Resep sebuah produk — bahan baku per 1 unit/pax (Fase F3).
 * super_admin-only (temuan CRITICAL gate F3): join ke item.raw_materials
 * yang BER-tenant — role sales tidak butuh membaca BOM (realisasi
 * menghitung server-side), jadi ditutup rapat sekalian.
 */
export async function GET(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  if (user.role !== "super_admin") {
    return NextResponse.json(
      { success: false, error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  try {
    const productId = new URL(request.url).searchParams.get("product_id");
    if (!productId) {
      return NextResponse.json(
        { success: false, error: "product_id wajib" },
        { status: 400 }
      );
    }
    const rows = await query(
      `SELECT r.id, r.raw_material_id, r.quantity_per_unit,
              r.unit_of_measure, r.waste_percentage,
              rm.kode AS material_kode, rm.nama AS material_nama,
              u.nama AS satuan_kecil
       FROM pos.pos_recipes r
       JOIN item.raw_materials rm ON rm.id = r.raw_material_id
       LEFT JOIN item.units u ON u.id = rm.satuan_kecil_id
       WHERE r.product_id = $1 AND r.is_active = true
       ORDER BY rm.nama ASC`,
      [productId]
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[sales-funnel] get recipes error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat resep" },
      { status: 500 }
    );
  }
}

/** Ganti seluruh resep sebuah produk — super_admin (konfigurasi ala stages). */
export async function PUT(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  if (user.role !== "super_admin") {
    return NextResponse.json(
      { success: false, error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  try {
    const parsed = putSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { product_id, items } = parsed.data;

    // Satu bahan tidak boleh dobel dalam satu resep
    const uniqueMaterials = new Set(items.map((item) => item.raw_material_id));
    if (uniqueMaterials.size !== items.length) {
      return NextResponse.json(
        { success: false, error: "Ada bahan baku yang dobel dalam resep" },
        { status: 400 }
      );
    }

    await withTransaction(async (client) => {
      const product = await client.query(
        `SELECT id FROM pos.pos_products WHERE id = $1 AND is_active = true`,
        [product_id]
      );
      if (product.rowCount === 0) throw new Error("Produk tidak ditemukan");

      // Satuan resep DITURUNKAN server dari satuan kecil bahan — kolom
      // unit_of_measure NOT NULL varchar(20), dan resep beda satuan dari
      // unit stok membuat hitungan realisasi meleset diam-diam (temuan
      // HIGH + MEDIUM gate F3). Input klien diabaikan.
      const unitByMaterial = new Map<string, string>();
      if (items.length > 0) {
        // Catatan scope: endpoint super_admin-only; super_admin memang
        // unscoped di seluruh platform (src/lib/api/scope.ts) — resep
        // global mengikuti pos_products/pos_recipes tanpa kolom tenant.
        const materials = await client.query<{ id: string; satuan: string }>(
          `SELECT rm.id, LEFT(COALESCE(u.nama, 'unit'), 20) AS satuan
           FROM item.raw_materials rm
           LEFT JOIN item.units u ON u.id = rm.satuan_kecil_id
           WHERE rm.id = ANY($1::uuid[]) AND rm.is_active = true
             AND rm.deleted_at IS NULL`,
          [[...uniqueMaterials]]
        );
        if (materials.rowCount !== uniqueMaterials.size) {
          throw new Error("Ada bahan baku yang tidak ditemukan atau nonaktif");
        }
        for (const row of materials.rows) unitByMaterial.set(row.id, row.satuan);
      }

      await client.query(`DELETE FROM pos.pos_recipes WHERE product_id = $1`, [
        product_id,
      ]);
      for (const item of items) {
        await client.query(
          `INSERT INTO pos.pos_recipes
             (product_id, raw_material_id, quantity_per_unit,
              unit_of_measure, waste_percentage, is_active)
           VALUES ($1, $2, $3, $4, $5, true)`,
          [
            product_id,
            item.raw_material_id,
            item.quantity_per_unit,
            unitByMaterial.get(item.raw_material_id) ?? "unit",
            item.waste_percentage,
          ]
        );
      }
    });

    return successResponse({ product_id, items: items.length }, "Resep disimpan");
  } catch (err) {
    const raw = err instanceof Error ? err.message : "";
    const isKnown = raw.startsWith("Produk") || raw.startsWith("Ada bahan");
    console.error("[sales-funnel] put recipes error:", err);
    return NextResponse.json(
      { success: false, error: isKnown ? raw : "Gagal menyimpan resep" },
      { status: isKnown ? 400 : 500 }
    );
  }
}
