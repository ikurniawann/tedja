import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireApiRole,
  ApiError,
  successResponse,
  noContentResponse,
} from "@/lib/api/auth";

const updatePriceSchema = z.object({
  harga: z.number().positive().optional(),
  satuan_id: z.string().uuid().optional(),
  minimum_qty: z.number().positive().optional(),
  lead_time_days: z.number().min(0).optional().refine(v => v === undefined || Number.isInteger(v)),
  is_preferred: z.boolean().optional(),
  berlaku_dari: z.string().optional(),
  berlaku_sampai: z.string().optional(),
  catatan: z.string().optional(),
});

// GET /api/purchasing/supplier-prices/:id
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiRole(["purchasing_admin", "purchasing_staff", "purchasing_manager", "super_admin"]);
    const { id } = await params;
    const db = await createServerPgClient();

    const { data, error } = await db
      .from("supplier_price_lists")
      .select(`
        *,
        supplier:suppliers!supplier_id (id, kode, nama_supplier),
        bahan_baku:raw_materials!bahan_baku_id (id, kode, nama),
        satuan:units!satuan_id (id, kode, nama)
      `)
      .eq("id", id)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      throw ApiError.notFound("Harga supplier tidak ditemukan");
    }

    return successResponse(data);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching supplier price:", error);
    return ApiError.server("Failed to fetch supplier price").toResponse();
  }
}

// PUT /api/purchasing/supplier-prices/:id
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiRole(["purchasing_admin", "purchasing_staff", "purchasing_manager", "super_admin"]);
    const { id } = await params;
    const db = await createServerPgClient();

    const body = await request.json();
    const validated = updatePriceSchema.parse(body);

    // Verify satuan if being updated
    if (validated.satuan_id) {
      const { data: satuan } = await db
        .from("units")
        .select("id")
        .eq("id", validated.satuan_id)
        .eq("is_active", true)
        .single();

      if (!satuan) {
        throw ApiError.badRequest("Satuan tidak ditemukan");
      }
    }

    // If setting is_preferred, unset other preferred for this bahan_baku
    if (validated.is_preferred) {
      const { data: current } = await db
        .from("supplier_price_lists")
        .select("bahan_baku_id")
        .eq("id", id)
        .single();

      if (current) {
        await db
          .from("supplier_price_lists")
          .update({ is_preferred: false })
          .eq("bahan_baku_id", current.bahan_baku_id)
          .eq("is_preferred", true)
          .eq("is_active", true)
          .neq("id", id);
      }
    }

    const { data, error } = await db
      .from("supplier_price_lists")
      .update({ ...validated, updated_by: user.id })
      .eq("id", id)
      .eq("is_active", true)
      .select(`
        *,
        supplier:suppliers!supplier_id (id, kode, nama_supplier),
        bahan_baku:raw_materials!bahan_baku_id (id, kode, nama),
        satuan:units!satuan_id (id, kode, nama)
      `)
      .single();

    if (error || !data) {
      throw ApiError.notFound("Harga supplier tidak ditemukan");
    }

    return successResponse(data, "Harga supplier berhasil diperbarui");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validation failed", error.issues).toResponse();
    }
    console.error("Error updating supplier price:", error);
    return ApiError.server("Failed to update supplier price").toResponse();
  }
}

// DELETE /api/purchasing/supplier-prices/:id - Soft delete
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiRole(["purchasing_admin", "purchasing_manager", "purchasing_staff", "super_admin"]);
    const { id } = await params;
    const db = await createServerPgClient();

    const { error } = await db
      .from("supplier_price_lists")
      .update({ is_active: false, updated_by: user.id })
      .eq("id", id);

    if (error) throw error;

    return noContentResponse();
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error deleting supplier price:", error);
    return ApiError.server("Failed to delete supplier price").toResponse();
  }
}
