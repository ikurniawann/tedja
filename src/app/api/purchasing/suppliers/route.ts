import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
  effectiveCompanyId,
  effectiveBranchId,
} from "@/lib/api/scope";

// ========================
// ZOD SCHEMAS
// ========================

const createSupplierSchema = z.object({
  kode_supplier: z.string().min(1, "Kode supplier wajib diisi").max(50).optional(),
  nama_supplier: z.string().min(1, "Nama supplier wajib diisi").max(200),
  pic_name: z.string().max(100).optional(),
  pic_phone: z.string().max(30).optional(),
  pic_email: z.string().email("Email PIC tidak valid").optional().or(z.literal("")),
  telepon: z.string().max(50).optional(),
  email: z.string().email("Email tidak valid").optional().or(z.literal("")),
  alamat: z.string().optional(),
  kota: z.string().max(100).optional(),
  npwp: z.string().max(50).optional(),
  payment_terms: z
    .enum(["CBD", "TOP7", "TOP14", "TOP30", "TOP45", "TOP60"])
    .default("TOP30"),
  currency: z.enum(["IDR", "USD", "EUR"]).default("IDR"),
  bank_nama: z.string().optional(),
  bank_rekening: z.string().optional(),
  bank_atas_nama: z.string().optional(),
  kategori: z.string().optional(),
  catatan: z.string().optional(),
  status: z.enum(["active", "inactive", "probation", "blocked", "draft"]).default("active"),
});

const queryParamsSchema = z.object({
  search: z.string().optional(),
  is_active: z.coerce.boolean().optional(),
  status: z.enum(["active", "inactive", "probation", "blocked", "draft"]).optional(),
  payment_terms: z.enum(["CBD", "TOP7", "TOP14", "TOP30", "TOP45", "TOP60"]).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sort_by: z
    .enum(["nama_supplier", "kode_supplier", "kota", "created_at"])
    .default("nama_supplier"),
  sort_dir: z.enum(["ASC", "DESC"]).default("ASC"),
});

// ========================
// HELPER: Generate supplier code
// ========================
async function generateSupplierCode(
  db: Awaited<ReturnType<typeof createServerPgClient>>
): Promise<string> {
  const year = new Date().getFullYear();
  const { data } = await db
    .from("suppliers")
    .select("kode")
    .ilike("kode", `SUP-${year}-%`)
    .order("kode", { ascending: false })
    .limit(1);

  let seq = 1;
  if (data && data.length > 0) {
    const parts = data[0].kode.split("-");
    seq = parseInt(parts[parts.length - 1]) + 1;
  }
  return `SUP-${year}-${String(seq).padStart(4, "0")}`;
}

// ========================
// GET /api/purchasing/suppliers
// ========================
export async function GET(request: NextRequest) {
  try {
    await requireApiRole(["admin", "purchasing_admin", "purchasing_staff", "purchasing_manager", "super_admin"]);

    const url = new URL(request.url);
    const rawParams = Object.fromEntries(url.searchParams);
    const params = queryParamsSchema.parse(rawParams);
    const { page, limit, search, is_active, status, payment_terms, sort_by, sort_dir } = params;
    const offset = (page - 1) * limit;

    const db = await createServerPgClient();

    const sortColumnMap: Record<string, string> = {
      nama_supplier: "nama_supplier",
      kode_supplier: "kode",
      kota: "kota",
      created_at: "created_at",
    };
    const sortColumn = sortColumnMap[sort_by] ?? "nama_supplier";

    let query = db
      .from("suppliers")
      .select("*", { count: "exact" })
      .is("deleted_at", null);

    // Business scope: branch (master purchasing level branch)
    const scope = await getApiUserScope();
    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    // Filter by status if provided (for draft support)
    if (status) {
      query = query.eq("status", status);
    } else if (is_active !== undefined) {
      query = query.eq("is_active", is_active);
    }

    if (payment_terms) {
      query = query.eq("payment_terms", payment_terms);
    }

    if (search) {
      query = query.or(
        [
          `nama_supplier.ilike.%${search}%`,
          `kode.ilike.%${search}%`,
          `kota.ilike.%${search}%`,
          `pic_name.ilike.%${search}%`,
          `pic_phone.ilike.%${search}%`,
          `pic_email.ilike.%${search}%`,
          `telepon.ilike.%${search}%`,
          `email.ilike.%${search}%`,
          `alamat.ilike.%${search}%`,
          `npwp.ilike.%${search}%`,
          `payment_terms.ilike.%${search}%`,
          `kategori.ilike.%${search}%`,
          `catatan.ilike.%${search}%`,
          `status.ilike.%${search}%`,
        ].join(",")
      );
    }

    const { data, count, error } = await query
      .order(sortColumn, { ascending: sort_dir === "ASC" })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // Return format tanpa wrapper success
    return NextResponse.json({
      data,
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Parameter query tidak valid", error.issues).toResponse();
    }
    console.error("Error fetching suppliers:", error);
    return ApiError.server("Gagal mengambil data supplier").toResponse();
  }
}

// ========================
// POST /api/purchasing/suppliers
// ========================
export async function POST(request: NextRequest) {
  try {
    const user = await requireApiRole(["admin", "purchasing_admin", "purchasing_staff", "purchasing_manager", "super_admin"]);
    const body = await request.json();
    const validated = createSupplierSchema.parse(body);

    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const companyId = effectiveCompanyId(scope);
    const branchId = effectiveBranchId(scope);

    // Auto-generate kode if not provided, placeholder, or empty
    let kodeSupplier = validated.kode_supplier;
    if (!kodeSupplier || kodeSupplier.trim() === "" || kodeSupplier.includes("XXXX")) {
      kodeSupplier = await generateSupplierCode(db);
    }

    // Check if kode_supplier already exists dalam scope
    let existingQuery = db
      .from("suppliers")
      .select("id")
      .eq("kode", kodeSupplier)
      .is("deleted_at", null);
    existingQuery = companyId
      ? existingQuery.eq("company_id", companyId)
      : existingQuery.is("company_id", null);
    existingQuery = branchId
      ? existingQuery.eq("branch_id", branchId)
      : existingQuery.is("branch_id", null);
    const { data: existing } = await existingQuery.maybeSingle();

    if (existing) {
      throw ApiError.conflict("Kode supplier sudah digunakan");
    }

    const { data, error } = await db
      .from("suppliers")
      .insert({
        kode: kodeSupplier,
        company_id: companyId,
        branch_id: branchId,
        nama_supplier: validated.nama_supplier,
        pic_name: validated.pic_name,
        pic_phone: validated.pic_phone,
        pic_email: validated.pic_email,
        telepon: validated.telepon,
        email: validated.email,
        alamat: validated.alamat,
        kota: validated.kota,
        npwp: validated.npwp,
        payment_terms: validated.payment_terms,
        currency: validated.currency,
        bank_nama: validated.bank_nama,
        bank_rekening: validated.bank_rekening,
        bank_atas_nama: validated.bank_atas_nama,
        kategori: validated.kategori,
        catatan: validated.catatan,
        status: validated.status,
        is_active: validated.status !== "inactive",
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        throw ApiError.conflict("Kode supplier sudah digunakan");
      }
      throw error;
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validasi gagal", error.issues).toResponse();
    }
    console.error("Error creating supplier:", error);
    return ApiError.server("Gagal membuat supplier").toResponse();
  }
}
