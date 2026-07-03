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
  effectiveCompanyId,
  effectiveBranchId,
} from "@/lib/api/scope";

const productSchema = z.object({
  kode: z.string().max(20).optional(),
  nama: z.string().min(1, "Nama produk wajib diisi").max(100),
  deskripsi: z.string().optional(),
  kategori: z.string().optional(),
  satuan_id: z.string().uuid().optional(),
  harga_jual: z.number().min(0).default(0),
  harga_modal: z.number().min(0).optional(),
  markup_persen: z.number().optional(),
  production_output_type: z.enum(["FINISHED_GOOD", "WIP"]).default("FINISHED_GOOD").optional(),
});

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// GET /api/purchasing/products
export async function GET(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search");
    const isActive = searchParams.get("is_active");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    let query = db
      .from("v_products_cogs")
      .select("*", { count: "exact" })
      .is("deleted_at", null);

    // Business scope: company + branch (produk level branch)
    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

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
    const companyId = effectiveCompanyId(scope);
    const branchId = effectiveBranchId(scope);
    const body = await request.json();

    const validated = productSchema.parse(body);

    // Auto-generate kode if not provided
    let kode = validated.kode;
    if (!kode) {
      // Generate kode: PRD-YYYYMMDD-XXX
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      
      // Get last product code for today
      const { data: productsToday } = await db
        .from("products")
        .select("kode")
        .like("kode", `PRD-${date}-%`)
        .order("kode", { ascending: false })
        .limit(1);
      
      let seqNum = 1;
      if (productsToday && productsToday.length > 0 && productsToday[0].kode) {
        const parts = productsToday[0].kode.split('-');
        const lastSeq = parseInt(parts[parts.length - 1] || '0', 10);
        seqNum = lastSeq + 1;
      }
      
      kode = `PRD-${date}-${String(seqNum).padStart(3, '0')}`;
    } else {
      // Cek kode unik dalam scope (company + branch)
      let existingQuery = db
        .from("products")
        .select("id")
        .eq("kode", kode)
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
          { success: false, message: "Kode produk sudah digunakan" },
          { status: 400 }
        );
      }
    }

    const { data, error } = await db
      .from("products")
      .insert({
        ...validated,
        kode,
        company_id: companyId,
        branch_id: branchId,
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
