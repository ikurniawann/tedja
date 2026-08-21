// ============================================
// API ROUTE: /api/purchasing/raw-materials
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { z } from "zod";
import {
  getErrorMessage,
  throwIfDbError,
  UNIT_CONVERSION_SELECT,
  prepareMaterialBody,
  normalizeCoaAccountCode,
} from "./_helpers";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
  effectiveCompanyId,
  effectiveBranchId,
} from "@/lib/api/scope";
import {
  deriveLegacyCoaEnum,
  resolveDefaultCoaForCategory,
} from "@/lib/purchasing/raw-material-coa";
import { rawMaterialStockSource } from "@/lib/api/stall-scope";

const coaAccountCode = z
  .string()
  .max(20)
  .nullish()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v == null || v === "") return null;
    const code = normalizeCoaAccountCode(v);
    if (!code) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Kode Chart of Accounts tidak valid (gunakan 7 digit, mis. 1301001)",
      });
      return z.NEVER;
    }
    return code;
  });

// Validation schema
const materialSchema = z.object({
  kode: z.string().max(20).optional().nullable(),
  nama: z.string().min(1, "Material name is required").max(100),
  kategori: z.string().min(1, "Category is required").max(30),
  deskripsi: z.string().optional().nullable(),
  satuan_besar_id: z.string().uuid("Large unit is required"),
  satuan_kecil_id: z.string().uuid().optional().nullable(),
  harga_beli: z.number().min(0).default(0),
  konversi_factor: z.number().min(0).default(1),
  stok_minimum: z.number().min(0).default(0),
  stok_maximum: z.number().min(0).default(0),
  shelf_life_days: z.number().min(0).optional().nullable(),
  storage_condition: z.string().max(20).optional().nullable(),
  coa: z.enum(["PRODUCTION", "RND", "ASSET"]).optional().nullable(),
  coa_production: coaAccountCode,
  coa_rnd: coaAccountCode,
  coa_asset: coaAccountCode,
  unit_conversions: z.array(z.object({
    satuan_id: z.string().uuid(),
    qty_in_base_unit: z.number().min(0.000001),
    is_base: z.boolean().optional(),
  })).optional().default([]),
});

// GET /api/purchasing/raw-materials
export async function GET(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    // Stok bersifat per-stall: pakai view berdimensi warehouse saat ada stall
    // aktif, dan view agregat saat mode "Semua Stall".
    const { view: stockView, warehouseId } = await rawMaterialStockSource();
    const { searchParams } = new URL(request.url);

    // Query params
    const search = searchParams.get("search");
    const kategori = searchParams.get("kategori");
    const satuan_besar_id = searchParams.get("satuan_besar_id");
    const isActive = searchParams.get("is_active");
    const belowMinimum = searchParams.get("below_minimum");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const sortBy = searchParams.get("sort_by") || "nama";
    const sortDir = searchParams.get("sort_dir")?.toUpperCase() === "DESC" ? "DESC" : "ASC";

    // Filters shared by list + summary (status filter applied only to list)
    type Filterable = {
      or: (filter: string) => Filterable;
      eq: (column: string, value: string | boolean) => Filterable;
    };
    const applyListFilters = <T extends Filterable>(
      q: T,
      opts?: { includeBelowMinimum?: boolean }
    ): T => {
      let next: Filterable = q;
      if (search) {
        next = next.or(`nama.ilike.%${search}%,kode.ilike.%${search}%`);
      }
      if (kategori) {
        next = next.eq("kategori", kategori);
      }
      if (satuan_besar_id) {
        next = next.eq("satuan_besar_id", satuan_besar_id);
      }
      if (isActive !== null) {
        next = next.eq("is_active", isActive === "true");
      }
      if (opts?.includeBelowMinimum && belowMinimum === "true") {
        next = next.or(`status_stok.eq.MENIPIS,status_stok.eq.HABIS`);
      }
      return next as T;
    };

    // Build query
    let query = db
      .from(stockView)
      .select("*", { count: "exact" })
      .is("deleted_at", null);
    if (warehouseId) query = query.eq("warehouse_id", warehouseId);

    // Business scope: company + branch (bahan baku level branch)
    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    query = applyListFilters(query, { includeBelowMinimum: true });

    // Summary counts (scope + search/kategori; ignore below_minimum so cards stay global KPIs)
    let summaryBase = db
      .from(stockView)
      .select("status_stok")
      .is("deleted_at", null);
    if (warehouseId) summaryBase = summaryBase.eq("warehouse_id", warehouseId);
    if (companyOr) summaryBase = summaryBase.or(companyOr);
    if (branchOr) summaryBase = summaryBase.or(branchOr);
    summaryBase = applyListFilters(summaryBase, { includeBelowMinimum: false });

    const { data: statusRows, error: summaryError } = await summaryBase;
    if (summaryError) {
      console.error("Database error fetching raw material summary:", summaryError);
      throwIfDbError(summaryError);
    }

    const summary = { total: 0, aman: 0, menipis: 0, habis: 0 };
    for (const row of statusRows || []) {
      summary.total += 1;
      const status = String((row as { status_stok?: string | null }).status_stok || "AMAN");
      if (status === "MENIPIS") summary.menipis += 1;
      else if (status === "HABIS") summary.habis += 1;
      else summary.aman += 1;
    }

    // Pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Execute query
    const { data, error, count } = await query
      .order(sortBy, { ascending: sortDir === "ASC" })
      .range(from, to);

    if (error) {
      console.error("Database error fetching raw materials:", error);
      throwIfDbError(error);
    }

    let materialsWithConversions = data || [];
    const materialIds = materialsWithConversions.map((material) => material.id).filter(Boolean);

    if (materialIds.length > 0) {
      const { data: conversions, error: conversionsError } = await db
        .from("raw_material_unit_conversions")
        .select(UNIT_CONVERSION_SELECT)
        .in("raw_material_id", materialIds)
        .eq("is_active", true)
        .order("is_base", { ascending: false })
        .order("qty_in_base_unit", { ascending: true });

      if (conversionsError) throwIfDbError(conversionsError);

      const conversionsByMaterial = new Map<string, typeof conversions>();
      for (const conversion of conversions || []) {
        const current = conversionsByMaterial.get(conversion.raw_material_id) || [];
        current.push(conversion);
        conversionsByMaterial.set(conversion.raw_material_id, current);
      }

      materialsWithConversions = materialsWithConversions.map((material) => ({
        ...material,
        unit_conversions: conversionsByMaterial.get(material.id) || [],
      }));
    }

    return Response.json({
      data: materialsWithConversions,
      pagination: {
        page,
        limit,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / limit),
      },
      summary,
    });
  } catch (error: unknown) {
    console.error("Error fetching raw materials:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal mengambil data bahan baku") },
      { status: 500 }
    );
  }
}

// POST /api/purchasing/raw-materials
export async function POST(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const companyId = effectiveCompanyId(scope);
    const branchId = effectiveBranchId(scope);
    const body = prepareMaterialBody(await request.json());
    const validated = materialSchema.parse(body);

    // Generate kode otomatis jika tidak disediakan
    let finalKode = validated.kode;
    if (!finalKode) {
      const year = new Date().getFullYear();
      // Get last code
      const { data: lastCode } = await db
        .from("raw_materials")
 .select("kode")
        .ilike("kode", `BHN-${year}-%`)
        .is("deleted_at", null)
        .order("kode", { ascending: false })
        .limit(1)
        .single();

      let nextNum = 1;
      if (lastCode?.kode) {
        const match = lastCode.kode.match(/-(\d+)$/);
        if (match) {
          nextNum = parseInt(match[1]) + 1;
        }
      }
      finalKode = `BHN-${year}-${String(nextNum).padStart(4, "0")}`;
    }

    // Cek kode unik dalam scope (company + branch)
    let existingQuery = db
      .from("raw_materials")
      .select("id")
      .eq("kode", finalKode)
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
        { success: false, message: "Material code is already in use" },
        { status: 400 }
      );
    }

    const { unit_conversions, ...materialPayload } = validated;

    const defaults = resolveDefaultCoaForCategory(validated.kategori);
    const coa_production =
      materialPayload.coa_production ?? defaults.coa_production;
    const coa_rnd = materialPayload.coa_rnd ?? null;
    const coa_asset = materialPayload.coa_asset ?? defaults.coa_asset;
    const coa =
      materialPayload.coa ??
      deriveLegacyCoaEnum({ coa_production, coa_rnd, coa_asset });

    // Insert data
    const { data, error } = await db
      .from("raw_materials")
      .insert({
        ...materialPayload,
        kode: finalKode,
        coa,
        coa_production,
        coa_rnd,
        coa_asset,
        company_id: companyId,
        branch_id: branchId,
        is_active: true,
      })
      .select()
      .single();

    if (error) throwIfDbError(error);

    const conversions = [
      ...(data.satuan_kecil_id
        ? [{ satuan_id: data.satuan_kecil_id, qty_in_base_unit: 1, is_base: true }]
        : []),
      { satuan_id: data.satuan_besar_id, qty_in_base_unit: data.satuan_kecil_id ? data.konversi_factor || 1 : 1, is_base: !data.satuan_kecil_id },
      ...unit_conversions.map((conversion) => ({ ...conversion, is_base: conversion.is_base ?? false })),
    ];

    if (conversions.length > 0) {
      const conversionsByUnit = new Map<string, (typeof conversions)[number]>();
      for (const conversion of conversions) {
        if (!conversionsByUnit.has(conversion.satuan_id)) {
          conversionsByUnit.set(conversion.satuan_id, conversion);
        }
      }
      const uniqueConversions = Array.from(conversionsByUnit.values());
      const { error: conversionError } = await db
        .from("raw_material_unit_conversions")
        .upsert(
          uniqueConversions.map((conversion) => ({
            raw_material_id: data.id,
            satuan_id: conversion.satuan_id,
            qty_in_base_unit: conversion.qty_in_base_unit,
            is_base: conversion.is_base,
            is_active: true,
          })),
          { onConflict: "raw_material_id,satuan_id" }
        );

      if (conversionError) throwIfDbError(conversionError);
    }

    return Response.json(
      { success: true, data, message: "Raw material added successfully" },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Error creating raw material:", error);

    if (error instanceof z.ZodError) {
      return Response.json(
        {
          success: false,
          message: "Validation failed",
          errors: error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    return Response.json(
      { success: false, message: getErrorMessage(error, "Failed to add raw material") },
      { status: 500 }
    );
  }
}
