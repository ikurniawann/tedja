import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { z } from "zod";
import {
  getItemsLookupConfig,
  itemsLookupSchema,
} from "@/lib/purchasing/items-lookup";

const COMPANY_SCOPED_TABLES = new Set([
  "raw_material_categories",
  "product_categories",
  "supply_categories",
]);

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getValidationMessage(error: z.ZodError) {
  return error.issues[0]?.message || "Validasi gagal";
}

type RouteContext = { params: Promise<{ lookup: string; id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { lookup, id } = await context.params;
    const config = getItemsLookupConfig(lookup);
    if (!config) {
      return Response.json({ message: "Tipe lookup tidak valid" }, { status: 404 });
    }

    const db = await createServerPgClient();
    const body = await request.json();
    const validated = itemsLookupSchema.parse(body);
    const code = validated.code.trim().toUpperCase();

    let duplicateQuery = db
      .from(config.table)
      .select("id")
      .eq("code", code)
      .neq("id", id)
      .is("deleted_at", null);

    if (COMPANY_SCOPED_TABLES.has(config.table)) {
      const { data: current } = await db
        .from(config.table)
        .select("company_id")
        .eq("id", id)
        .maybeSingle();
      const currentCompanyId =
        (current as { company_id: string | null } | null)?.company_id ?? null;
      duplicateQuery = currentCompanyId
        ? duplicateQuery.eq("company_id", currentCompanyId)
        : duplicateQuery.is("company_id", null);
    }

    const { data: duplicate } = await duplicateQuery.maybeSingle();

    if (duplicate) {
      return Response.json({ message: "Kode sudah digunakan" }, { status: 400 });
    }

    const { data, error } = await db
      .from(config.table)
      .update({
        code,
        nama: validated.nama.trim(),
        deskripsi: validated.deskripsi?.trim() || null,
        is_active: validated.is_active ?? true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select()
      .single();

    if (error) throw error;

    return Response.json({ data, message: "Berhasil diperbarui" });
  } catch (error: unknown) {
    console.error("Error updating items lookup:", error);

    if (error instanceof z.ZodError) {
      return Response.json(
        { message: getValidationMessage(error), errors: error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    return Response.json(
      { message: getErrorMessage(error, "Gagal memperbarui data") },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { lookup, id } = await context.params;
    const config = getItemsLookupConfig(lookup);
    if (!config) {
      return Response.json({ message: "Tipe lookup tidak valid" }, { status: 404 });
    }

    const db = await createServerPgClient();
    const { error } = await db
      .from(config.table)
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq("id", id)
      .is("deleted_at", null);

    if (error) throw error;

    return Response.json({ message: "Berhasil dihapus" });
  } catch (error: unknown) {
    console.error("Error deleting items lookup:", error);
    return Response.json(
      { message: getErrorMessage(error, "Gagal menghapus data") },
      { status: 500 }
    );
  }
}
