import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { z } from "zod";
import {
  getItemsLookupConfig,
  itemsLookupSchema,
} from "@/lib/purchasing/items-lookup";
import {
  getApiUserScope,
  companyScopeOr,
  effectiveCompanyId,
} from "@/lib/api/scope";

/** Tabel master yang di-scope per company. */
const COMPANY_SCOPED_TABLES = new Set([
  "raw_material_categories",
  "product_categories",
]);

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getValidationMessage(error: z.ZodError) {
  return error.issues[0]?.message || "Validasi gagal";
}

type RouteContext = { params: Promise<{ lookup: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { lookup } = await context.params;
    const config = getItemsLookupConfig(lookup);
    if (!config) {
      return Response.json({ message: "Tipe lookup tidak valid" }, { status: 404 });
    }

    const db = await createServerPgClient();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    let query = db
      .from(config.table)
      .select("*", { count: "exact" })
      .is("deleted_at", null)
      .order("nama", { ascending: true });

    if (COMPANY_SCOPED_TABLES.has(config.table)) {
      const scope = await getApiUserScope();
      const scopeOr = companyScopeOr(scope);
      if (scopeOr) query = query.or(scopeOr);
    }

    if (search) {
      query = query.or(`code.ilike.%${search}%,nama.ilike.%${search}%`);
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const { data, error, count } = await query.range(from, to);

    if (error) throw error;

    return Response.json({
      data,
      pagination: {
        page,
        limit,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching items lookup:", error);
    return Response.json(
      { message: getErrorMessage(error, "Gagal mengambil data") },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { lookup } = await context.params;
    const config = getItemsLookupConfig(lookup);
    if (!config) {
      return Response.json({ message: "Tipe lookup tidak valid" }, { status: 404 });
    }

    const db = await createServerPgClient();
    const body = await request.json();
    const validated = itemsLookupSchema.parse(body);

    const code = validated.code.trim().toUpperCase();
    const isScoped = COMPANY_SCOPED_TABLES.has(config.table);
    const companyId = isScoped ? effectiveCompanyId(await getApiUserScope()) : null;

    let existingQuery = db
      .from(config.table)
      .select("id")
      .eq("code", code)
      .is("deleted_at", null);
    if (isScoped) {
      existingQuery = companyId
        ? existingQuery.eq("company_id", companyId)
        : existingQuery.is("company_id", null);
    }
    const { data: existing } = await existingQuery.maybeSingle();

    if (existing) {
      return Response.json({ message: "Kode sudah digunakan" }, { status: 400 });
    }

    const { data, error } = await db
      .from(config.table)
      .insert({
        code,
        nama: validated.nama.trim(),
        deskripsi: validated.deskripsi?.trim() || null,
        is_active: validated.is_active ?? true,
        ...(isScoped ? { company_id: companyId } : {}),
      })
      .select()
      .single();

    if (error) throw error;

    return Response.json({ data, message: "Berhasil ditambahkan" }, { status: 201 });
  } catch (error: unknown) {
    console.error("Error creating items lookup:", error);

    if (error instanceof z.ZodError) {
      return Response.json(
        { message: getValidationMessage(error), errors: error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    return Response.json(
      { message: getErrorMessage(error, "Gagal menambahkan data") },
      { status: 500 }
    );
  }
}
