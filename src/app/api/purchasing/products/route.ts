// ============================================
// API ROUTE: /api/purchasing/products
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { z } from "zod";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
  validateProductWarehouseScope,
} from "@/lib/api/scope";

const productSchema = z.object({
  kode: z.string().max(20).optional(),
  nama: z.string().min(1, "Nama produk wajib diisi").max(100),
  deskripsi: z.string().optional(),
  kategori: z.string().optional(),
  satuan_id: z.string().uuid().optional(),
  warehouse_id: z.string().uuid("Stall wajib dipilih"),
  harga_jual: z.number().min(0).default(0),
  harga_modal: z.number().min(0).optional(),
  markup_persen: z.number().optional(),
  production_output_type: z.enum(["FINISHED_GOOD", "WIP"]).default("FINISHED_GOOD").optional(),
});

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function generateProductCode(
  db: Awaited<ReturnType<typeof createServerPgClient>>,
  companyId: string | null,
  branchId: string | null,
  warehouseId: string
) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let codeQuery = db
    .from("products")
    .select("kode")
    .like("kode", `PRD-${date}-%`)
    .eq("warehouse_id", warehouseId)
    .is("deleted_at", null)
    .order("kode", { ascending: false })
    .limit(1);

  codeQuery = companyId ? codeQuery.eq("company_id", companyId) : codeQuery.is("company_id", null);
  codeQuery = branchId ? codeQuery.eq("branch_id", branchId) : codeQuery.is("branch_id", null);

  const { data } = await codeQuery;
  let seq = 1;
  if (Array.isArray(data) && data.length > 0 && data[0]?.kode) {
    const parts = data[0].kode.split("-");
    seq = parseInt(parts[parts.length - 1] || "0", 10) + 1;
  }
  return `PRD-${date}-${String(seq).padStart(3, "0")}`;
}

// GET /api/purchasing/products
export async function GET(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search");
    const isActive = searchParams.get("is_active");
    const warehouseId = searchParams.get("warehouse_id");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    let query = db
      .from("v_products_cogs")
      .select("*", { count: "exact" })
      .is("deleted_at", null);

    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    if (warehouseId) {
      query = query.eq("warehouse_id", warehouseId);
    }

    if (search) {
      query = query.or(`nama.ilike.%${search}%,kode.ilike.%${search}%`);
    }
    if (isActive !== null) {
      query = query.eq("is_active", isActive === "true");
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await query
      .order("nama", { ascending: true })
      .range(from, to);

    if (error) throw error;

    return Response.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching products:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal mengambil data produk") },
      { status: 500 }
    );
  }
}

// POST /api/purchasing/products
export async function POST(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const body = await request.json();

    const validated = productSchema.parse(body);

    const warehouseScope = await validateProductWarehouseScope(validated.warehouse_id, scope);
    if ("error" in warehouseScope) {
      return Response.json({ success: false, message: warehouseScope.error }, { status: 400 });
    }

    const { company_id: companyId, branch_id: branchId, warehouse_id: warehouseId } =
      warehouseScope;

    let kode = validated.kode;
    if (!kode) {
      kode = await generateProductCode(db, companyId, branchId, warehouseId);
    } else {
      let existingQuery = db
        .from("products")
        .select("id")
        .eq("kode", kode)
        .eq("warehouse_id", warehouseId)
        .is("deleted_at", null);
      existingQuery = companyId
        ? existingQuery.eq("company_id", companyId)
        : existingQuery.is("company_id", null);
      existingQuery = branchId
        ? existingQuery.eq("branch_id", branchId)
        : existingQuery.is("branch_id", null);
      const { data: existing } = await existingQuery.maybeSingle();

      if (existing) {
        return Response.json(
          { success: false, message: "Kode produk sudah digunakan di stall ini" },
          { status: 400 }
        );
      }
    }

    const { data, error } = await db
      .from("products")
      .insert({
        nama: validated.nama,
        deskripsi: validated.deskripsi,
        kategori: validated.kategori,
        satuan_id: validated.satuan_id,
        harga_jual: validated.harga_jual,
        harga_modal: validated.harga_modal,
        markup_persen: validated.markup_persen,
        production_output_type: validated.production_output_type,
        kode,
        company_id: companyId,
        branch_id: branchId,
        warehouse_id: warehouseId,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    return Response.json(
      { success: true, data, message: "Produk berhasil ditambahkan" },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Error creating product:", error);

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
      { success: false, message: getErrorMessage(error, "Gagal menambahkan produk") },
      { status: 500 }
    );
  }
}
