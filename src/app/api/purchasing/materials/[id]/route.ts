import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, successResponse, noContentResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

const updateMaterialSchema = z.object({
  nama: z.string().min(1).optional(),
  kode: z.string().min(1).optional(),
  kategori: z.string().optional(),
  satuan_id: z.string().uuid().optional(),
  satuan_besar_id: z.string().uuid().optional(),
  is_active: z.boolean().optional(),
});

// GET /api/purchasing/materials/:id
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const db = await createServerPgClient();

    const { data, error } = await db
      .from("raw_materials")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (error || !data) {
      throw ApiError.notFound("Bahan baku tidak ditemukan");
    }

    return successResponse(data);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching material:", error);
    return ApiError.server("Gagal mengambil detail bahan baku").toResponse();
  }
}

// PUT /api/purchasing/materials/:id
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const db = await createServerPgClient();

    const body = await request.json();
    const validated = updateMaterialSchema.parse(body);

    const updatePayload: Record<string, unknown> = {
      updated_by: user.id,
    };
    if (validated.nama !== undefined) updatePayload.nama = validated.nama;
    if (validated.kode !== undefined) updatePayload.kode = validated.kode;
    if (validated.kategori !== undefined) updatePayload.kategori = validated.kategori;
    if (validated.is_active !== undefined) updatePayload.is_active = validated.is_active;
    if (validated.satuan_besar_id) updatePayload.satuan_besar_id = validated.satuan_besar_id;
    else if (validated.satuan_id) updatePayload.satuan_besar_id = validated.satuan_id;

    const { data, error } = await db
      .from("raw_materials")
      .update(updatePayload)
      .eq("id", id)
      .is("deleted_at", null)
      .select()
      .single();

    if (error || !data) {
      throw ApiError.notFound("Bahan baku tidak ditemukan");
    }

    return successResponse(data, "Bahan baku berhasil diperbarui");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validasi gagal", error.issues).toResponse();
    }
    console.error("Error updating material:", error);
    return ApiError.server("Gagal memperbarui bahan baku").toResponse();
  }
}

// DELETE /api/purchasing/materials/:id — soft delete
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const db = await createServerPgClient();

    const { error } = await db
      .from("raw_materials")
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
        updated_by: user.id,
      })
      .eq("id", id);

    if (error) throw error;

    return noContentResponse();
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error deleting material:", error);
    return ApiError.server("Gagal menghapus bahan baku").toResponse();
  }
}
