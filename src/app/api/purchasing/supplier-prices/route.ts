import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireApiUser,
  requireApiRole,
  ApiError,
  successResponse,
  createdResponse,
  paginatedResponse,
  noContentResponse,
} from "@/lib/api/auth";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
  effectiveCompanyId,
  effectiveBranchId,
} from "@/lib/api/scope";

// Zod schemas
const createPriceSchema = z.object({
  supplier_id: z.string().uuid("Supplier ID tidak valid"),
  bahan_baku_id: z.string().uuid("Bahan baku ID tidak valid"),
  harga: z.number().positive("Harga harus lebih dari 0"),
  satuan_id: z.string().uuid("Satuan ID tidak valid"),
  minimum_qty: z.number().positive().default(1),
  lead_time_days: z.number().min(0).default(0).refine(v => Number.isInteger(v)),
  is_preferred: z.boolean().default(false),
  berlaku_dari: z.string().optional(), // date string YYYY-MM-DD
  berlaku_sampai: z.string().optional(),
  catatan: z.string().optional(),
});

const updatePriceSchema = createPriceSchema.partial();

const queryParamsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  supplier_id: z.string().uuid().optional(),
  bahan_baku_id: z.string().uuid().optional(),
  is_preferred: z.enum(["true", "false"]).transform(v => v === "true").optional(),
});

// GET /api/purchasing/supplier-prices - List with filter & pagination
export async function GET(request: NextRequest) {
  try {
    await requireApiUser();
    const db = await createServerPgClient();

    const url = new URL(request.url);
    const rawParams = Object.fromEntries(url.searchParams);
    const params = queryParamsSchema.parse(rawParams);
    const { page, limit, supplier_id, bahan_baku_id, is_preferred } = params;
    const offset = (page - 1) * limit;

    let query = db
      .from("supplier_price_lists")
      .select(`
        *,
        supplier:suppliers!supplier_id (id, kode, nama_supplier),
        bahan_baku:raw_materials!bahan_baku_id (id, kode, nama),
        satuan:units!satuan_id (id, kode, nama)
      `, { count: "exact" })
      .eq("is_active", true);

    const scope = await getApiUserScope();
    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    if (supplier_id) query = query.eq("supplier_id", supplier_id);
    if (bahan_baku_id) query = query.eq("bahan_baku_id", bahan_baku_id);
    if (is_preferred !== undefined) query = query.eq("is_preferred", is_preferred);

    // Filter by current validity
    query = query.or(`berlaku_sampai.is.null,berlaku_sampai.gte.${new Date().toISOString().split("T")[0]}`);

    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return NextResponse.json(
      paginatedResponse(data, {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
      })
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Invalid query parameters", error.issues).toResponse();
    }
    console.error("Error fetching supplier prices:", error);
    return ApiError.server("Failed to fetch supplier prices").toResponse();
  }
}

// POST /api/purchasing/supplier-prices - Create
export async function POST(request: NextRequest) {
  try {
    const user = await requireApiRole(["admin", "purchasing_admin", "purchasing_staff", "purchasing_manager", "super_admin"]);
    const db = await createServerPgClient();

    const body = await request.json();
    const validated = createPriceSchema.parse(body);
    const scope = await getApiUserScope();
    const companyId = effectiveCompanyId(scope);
    const branchId = effectiveBranchId(scope);

    // Verify supplier exists
    const { data: supplier } = await db
      .from("suppliers")
      .select("id")
      .eq("id", validated.supplier_id)
      .eq("is_active", true)
      .single();

    if (!supplier) {
      throw ApiError.badRequest("Supplier tidak ditemukan");
    }

    // Verify bahan_baku exists
    const { data: bahanBaku } = await db
      .from("raw_materials")
      .select("id")
      .eq("id", validated.bahan_baku_id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .single();

    if (!bahanBaku) {
      throw ApiError.badRequest("Bahan baku tidak ditemukan");
    }

    const { data: satuan } = await db
      .from("units")
      .select("id")
      .eq("id", validated.satuan_id)
      .eq("is_active", true)
      .single();

    if (!satuan) {
      throw ApiError.badRequest("Satuan tidak ditemukan");
    }

    // Check for existing price for this supplier+bahan_baku combo
    const { data: existing } = await db
      .from("supplier_price_lists")
      .select("id")
      .eq("supplier_id", validated.supplier_id)
      .eq("bahan_baku_id", validated.bahan_baku_id)
      .eq("is_active", true)
      .single();

    if (existing) {
      throw ApiError.conflict("Harga untuk supplier dan bahan baku ini sudah ada. Gunakan endpoint update untuk mengubah.");
    }

    // If is_preferred, unset other preferred for this bahan_baku
    if (validated.is_preferred) {
      await db
        .from("supplier_price_lists")
        .update({ is_preferred: false })
        .eq("bahan_baku_id", validated.bahan_baku_id)
        .eq("is_preferred", true)
        .eq("is_active", true);
    }

    const { data, error } = await db
      .from("supplier_price_lists")
      .insert({
        ...validated,
        company_id: companyId,
        branch_id: branchId,
        created_by: user.id,
      })
      .select(`
        *,
        supplier:suppliers!supplier_id (id, kode, nama_supplier),
        bahan_baku:raw_materials!bahan_baku_id (id, kode, nama),
        satuan:units!satuan_id (id, kode, nama)
      `)
      .single();

    if (error) throw error;

    return createdResponse(data, "Harga supplier berhasil dibuat");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validation failed", error.issues).toResponse();
    }
    console.error("Error creating supplier price:", error);
    return ApiError.server("Failed to create supplier price").toResponse();
  }
}
