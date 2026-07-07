// ============================================
// API ROUTE: /api/purchasing/bom/[id]
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { MANUFACTURING_SCHEMA } from "@/lib/manufacturing/constants";
import { z } from "zod";

const bomSchema = z.object({
  qty_required: z.number().min(0.0001, "Jumlah harus lebih dari 0").optional(),
  qty_needed: z.number().min(0.0001, "Jumlah harus lebih dari 0").optional(),
  satuan_id: z.string().uuid().optional().nullable(),
  waste_factor: z.number().min(0).max(1).optional(),
  waste_persen: z.number().min(0).max(100).optional(),
  is_active: z.boolean().optional(),
}).transform((value) => ({
  ...(value.qty_required !== undefined || value.qty_needed !== undefined
    ? { qty_required: value.qty_required ?? value.qty_needed }
    : {}),
  ...(value.satuan_id !== undefined ? { satuan_id: value.satuan_id } : {}),
  ...(value.waste_factor !== undefined || value.waste_persen !== undefined
    ? { waste_factor: value.waste_factor ?? ((value.waste_persen ?? 0) / 100) }
    : {}),
  ...(value.is_active !== undefined ? { is_active: value.is_active } : {}),
}));

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// PUT /api/purchasing/bom/:id
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();
    const body = await request.json();

    // Validasi input
    const validated = bomSchema.parse(body);

    // Cek apakah BOM item ada
    const { data: existingItem, error: findError } = await db
      .from("bom_items", MANUFACTURING_SCHEMA)
      .select("*")
      .eq("id", id)
      .single();

    if (findError || !existingItem) {
      return Response.json(
        { success: false, message: "Item BOM tidak ditemukan" },
        { status: 404 }
      );
    }

    // Update data
    const { data, error } = await db
      .from("bom_items", MANUFACTURING_SCHEMA)
      .update({
        ...validated,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return Response.json({
      success: true,
      data,
      message: "Item BOM berhasil diupdate",
    });
  } catch (error: unknown) {
    console.error("Error updating BOM item:", error);

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
      { success: false, message: getErrorMessage(error, "Gagal mengupdate item BOM") },
      { status: 500 }
    );
  }
}

// DELETE /api/purchasing/bom/:id
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();

    // Soft delete dengan set is_active = false
    const { error } = await db
      .from("bom_items", MANUFACTURING_SCHEMA)
      .update({ is_active: false })
      .eq("id", id);

    if (error) {
      if (error.code === "PGRST116") {
        return Response.json(
          { success: false, message: "Item BOM tidak ditemukan" },
          { status: 404 }
        );
      }
      throw error;
    }

    return Response.json({
      success: true,
      message: "Bahan berhasil dihapus dari BOM",
    });
  } catch (error: unknown) {
    console.error("Error deleting BOM item:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal menghapus bahan dari BOM") },
      { status: 500 }
    );
  }
}
