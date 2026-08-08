// ============================================
// API ROUTE: /api/purchasing/po/[id]/items
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { z } from "zod";

const poItemSchema = z.object({
  raw_material_id: z.string().uuid("Bahan baku wajib dipilih"),
  pr_item_id: z.string().uuid().optional(),
  qty_ordered: z.number().min(0.0001, "Jumlah pesanan minimal 0.0001"),
  satuan_id: z.string().uuid().optional(),
  harga_satuan: z.number().min(0, "Harga tidak boleh negatif"),
  diskon_item: z.number().min(0).default(0),
  catatan: z.string().optional(),
});

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// GET /api/purchasing/po/:id/items
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();

    const { data, error } = await db
      .from("purchase_order_items")
      .select(`
        *,
        raw_material:raw_materials!raw_material_id(id, nama, kode),
        product:products!product_id(id, nama, kode),
        satuan:units!satuan_id(id, nama, kode)
      `)
      .eq("purchase_order_id", id)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return Response.json({ success: true, data });
  } catch (error: unknown) {
    console.error("Error fetching PO items:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal mengambil data item PO") },
      { status: 500 }
    );
  }
}

// POST /api/purchasing/po/:id/items
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();
    const body = await request.json();

    // Validasi input
    const validated = poItemSchema.parse(body);

    // Cek PO ada dan masih bisa diedit
    const { data: po, error: poError } = await db
      .from("purchase_orders")
      .select("*")
      .eq("id", id)
      .single();

    if (poError || !po) {
      return Response.json(
        { success: false, message: "PO tidak ditemukan" },
        { status: 404 }
      );
    }

    if (po.status !== "draft") {
      return Response.json(
        { success: false, message: "Item hanya bisa ditambahkan saat PO status draft" },
        { status: 400 }
      );
    }

    // Cek apakah bahan sudah ada di PO ini
    const { data: existingItem } = await db
      .from("purchase_order_items")
      .select("id")
      .eq("purchase_order_id", id)
      .eq("raw_material_id", validated.raw_material_id)
      .eq("is_active", true)
      .single();

    if (existingItem) {
      return Response.json(
        { success: false, message: "Bahan ini sudah ada di PO. Silakan update item yang ada." },
        { status: 400 }
      );
    }

    // Insert item
    const { data, error } = await db
      .from("purchase_order_items")
      .insert({
        ...validated,
        purchase_order_id: id,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    return Response.json(
      { success: true, data, message: "Item berhasil ditambahkan ke PO" },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Error adding PO item:", error);

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
      { success: false, message: getErrorMessage(error, "Gagal menambahkan item ke PO") },
      { status: 500 }
    );
  }
}
