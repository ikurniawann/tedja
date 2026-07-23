// ============================================
// API ROUTE: /api/purchasing/supply-items
// EPIC-026 B1 — master barang operasional (non-F&B, non-jual).
// CRUD ramping: tanpa warehouse/COGS/BOM ala master product; query langsung
// ke tabel item.supply_items. Scope company+branch fail-closed.
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

const supplyItemSchema = z.object({
  kode: z.string().max(30).optional(),
  nama: z.string().min(1, "Nama barang wajib diisi").max(100),
  deskripsi: z.string().optional().nullable(),
  kategori: z.string().optional().nullable(),
  satuan_id: z.string().uuid().optional().nullable(),
  stockable: z.boolean().default(false),
  harga_beli: z.number().min(0).default(0),
  stok_minimum: z.number().min(0).optional(),
  is_active: z.boolean().optional(),
});

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function generateSupplyCode(
  db: Awaited<ReturnType<typeof createServerPgClient>>,
  companyId: string | null,
  branchId: string | null
) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let q = db
    .from("supply_items")
    .select("kode")
    .like("kode", `SUP-${date}-%`)
    .is("deleted_at", null)
    .order("kode", { ascending: false })
    .limit(1);
  q = companyId ? q.eq("company_id", companyId) : q.is("company_id", null);
  q = branchId ? q.eq("branch_id", branchId) : q.is("branch_id", null);

  const { data } = await q;
  let seq = 1;
  if (Array.isArray(data) && data.length > 0 && data[0]?.kode) {
    const parts = data[0].kode.split("-");
    seq = parseInt(parts[parts.length - 1] || "0", 10) + 1;
  }
  return `SUP-${date}-${String(seq).padStart(3, "0")}`;
}

// GET /api/purchasing/supply-items — daftar barang operasional (scoped)
export async function GET(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search");
    const isActive = searchParams.get("is_active");
    const stockable = searchParams.get("stockable");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    let query = db
      .from("supply_items")
      .select("*", { count: "exact" })
      .is("deleted_at", null);

    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    if (isActive === "true") query = query.eq("is_active", true);
    if (isActive === "false") query = query.eq("is_active", false);
    if (stockable === "true") query = query.eq("stockable", true);
    if (stockable === "false") query = query.eq("stockable", false);
    if (search) query = query.or(`kode.ilike.%${search}%,nama.ilike.%${search}%`);

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
    console.error("Error fetching supply items:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal mengambil data barang operasional") },
      { status: 500 }
    );
  }
}

// POST /api/purchasing/supply-items — buat barang operasional
export async function POST(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const body = await request.json();
    const validated = supplyItemSchema.parse(body);

    const companyId = effectiveCompanyId(scope);
    const branchId = effectiveBranchId(scope);

    let kode = validated.kode?.trim().toUpperCase();
    if (!kode) {
      kode = await generateSupplyCode(db, companyId, branchId);
    } else {
      let existingQuery = db
        .from("supply_items")
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
          { success: false, message: "Kode barang sudah digunakan" },
          { status: 400 }
        );
      }
    }

    const { data, error } = await db
      .from("supply_items")
      .insert({
        kode,
        nama: validated.nama.trim(),
        deskripsi: validated.deskripsi?.trim() || null,
        kategori: validated.kategori?.trim() || null,
        satuan_id: validated.satuan_id || null,
        stockable: validated.stockable,
        harga_beli: validated.harga_beli,
        stok_minimum: validated.stok_minimum ?? 0,
        is_active: validated.is_active ?? true,
        company_id: companyId,
        branch_id: branchId,
        created_by: scope?.userId ?? null,
      })
      .select()
      .single();

    if (error) throw error;

    return Response.json({ success: true, data }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { success: false, message: error.issues[0]?.message || "Validasi gagal" },
        { status: 400 }
      );
    }
    console.error("Error creating supply item:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal menyimpan barang operasional") },
      { status: 500 }
    );
  }
}
