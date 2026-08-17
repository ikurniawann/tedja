import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, successResponse, paginatedResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
  effectiveCompanyId,
  effectiveBranchId,
} from "@/lib/api/scope";

const queryParamsSchema = z.object({
  search: z.string().optional(),
  kategori: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

// GET /api/purchasing/materials — alias legacy ke item.raw_materials
export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.items);
    const db = await createServerPgClient();

    const { searchParams } = new URL(request.url);
    const params = queryParamsSchema.parse(Object.fromEntries(searchParams));
    const { page, limit, search, kategori } = params;
    const offset = (page - 1) * limit;

    let query = db
      .from("raw_materials")
      .select("*", { count: "exact" })
      .is("deleted_at", null)
      .eq("is_active", true);

    const scope = await getApiUserScope();
    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    if (search) {
      query = query.or(
        `nama.ilike.%${search}%,kode.ilike.%${search}%,kategori.ilike.%${search}%`
      );
    }
    if (kategori) query = query.eq("kategori", kategori);

    const { data, count, error } = await query
      .order("nama", { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return paginatedResponse(data ?? [], {
      page,
      limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / limit),
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Parameter query tidak valid", error.issues).toResponse();
    }
    console.error("Error fetching materials:", error);
    return ApiError.server("Gagal mengambil data bahan baku").toResponse();
  }
}

// POST /api/purchasing/materials — alias legacy ke item.raw_materials
export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const db = await createServerPgClient();

    const body = await request.json();
    const scope = await getApiUserScope();
    const companyId = effectiveCompanyId(scope);
    const branchId = effectiveBranchId(scope);

    const satuanBesarId = body.satuan_besar_id || body.satuan_id;
    if (!satuanBesarId) {
      throw ApiError.badRequest("satuan_id atau satuan_besar_id wajib diisi");
    }

    const { data, error } = await db
      .from("raw_materials")
      .insert({
        kode: body.kode,
        nama: body.nama,
        kategori: body.kategori || "LAINNYA",
        deskripsi: body.deskripsi ?? null,
        satuan_besar_id: satuanBesarId,
        satuan_kecil_id: body.satuan_kecil_id ?? null,
        konversi_factor: body.konversi_factor ?? 1,
        stok_minimum: body.stok_minimum ?? 0,
        stok_maximum: body.stok_maximum ?? 0,
        company_id: companyId,
        branch_id: branchId,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) throw error;

    return successResponse(data, "Bahan baku berhasil dibuat");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error creating material:", error);
    return ApiError.server("Gagal membuat bahan baku").toResponse();
  }
}
