// ============================================
// API ROUTE: /api/purchasing/supply-items/[id]
// EPIC-026 B1 — detail / update / soft-delete barang operasional.
// Scope fail-closed: user hanya boleh menyentuh baris dalam scope-nya.
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { z } from "zod";
import { getApiUserScope, isRowInBusinessScope } from "@/lib/api/scope";

const updateSchema = z.object({
  nama: z.string().min(1).max(100).optional(),
  deskripsi: z.string().optional().nullable(),
  kategori: z.string().optional().nullable(),
  satuan_id: z.string().uuid().optional().nullable(),
  stockable: z.boolean().optional(),
  harga_beli: z.number().min(0).optional(),
  stok_minimum: z.number().min(0).optional(),
  is_active: z.boolean().optional(),
});

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type RouteContext = { params: Promise<{ id: string }> };

async function loadInScope(id: string) {
  const db = await createServerPgClient();
  const scope = await getApiUserScope();
  const { data, error } = await db
    .from("supply_items")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { db, scope, row: null as null };
  // Fail-closed: tolak baris di luar scope bisnis user.
  if (!isRowInBusinessScope(scope, data)) return { db, scope, row: null as null };
  return { db, scope, row: data };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { row } = await loadInScope(id);
    if (!row) {
      return Response.json({ success: false, message: "Barang tidak ditemukan" }, { status: 404 });
    }
    return Response.json({ success: true, data: row });
  } catch (error: unknown) {
    console.error("Error fetching supply item:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal mengambil data") },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { db, scope, row } = await loadInScope(id);
    if (!row) {
      return Response.json({ success: false, message: "Barang tidak ditemukan" }, { status: 404 });
    }
    const validated = updateSchema.parse(await request.json());

    const patch: Record<string, unknown> = { updated_by: scope?.userId ?? null };
    if (validated.nama !== undefined) patch.nama = validated.nama.trim();
    if (validated.deskripsi !== undefined) patch.deskripsi = validated.deskripsi?.trim() || null;
    if (validated.kategori !== undefined) patch.kategori = validated.kategori?.trim() || null;
    if (validated.satuan_id !== undefined) patch.satuan_id = validated.satuan_id || null;
    if (validated.stockable !== undefined) patch.stockable = validated.stockable;
    if (validated.harga_beli !== undefined) patch.harga_beli = validated.harga_beli;
    if (validated.stok_minimum !== undefined) patch.stok_minimum = validated.stok_minimum;
    if (validated.is_active !== undefined) patch.is_active = validated.is_active;

    const { data, error } = await db
      .from("supply_items")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    return Response.json({ success: true, data });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { success: false, message: error.issues[0]?.message || "Validasi gagal" },
        { status: 400 }
      );
    }
    console.error("Error updating supply item:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal memperbarui data") },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { db, scope, row } = await loadInScope(id);
    if (!row) {
      return Response.json({ success: false, message: "Barang tidak ditemukan" }, { status: 404 });
    }
    const { error } = await db
      .from("supply_items")
      .update({ deleted_at: new Date().toISOString(), deleted_by: scope?.userId ?? null })
      .eq("id", id);
    if (error) throw error;

    return Response.json({ success: true });
  } catch (error: unknown) {
    console.error("Error deleting supply item:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal menghapus data") },
      { status: 500 }
    );
  }
}
