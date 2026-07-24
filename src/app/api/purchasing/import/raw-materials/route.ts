import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { queryOne } from "@/lib/db";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import {
  getApiUserScope,
  importBusinessIds,
} from "@/lib/api/scope";
import { addOpeningStockFromImport, setStockFromImport } from "@/lib/inventory";
import {
  normalizeSpreadsheetHeader,
  parseSpreadsheetFile,
} from "@/lib/purchasing/raw-material-spreadsheet";

const VALID_COA = new Set(["PRODUCTION", "RND", "ASSET"]);

function normalizeHeader(header: string) {
  return normalizeSpreadsheetHeader(header);
}

function parseNumber(value: string | undefined, fallback = 0) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalInt(value: string | undefined) {
  if (!value?.trim()) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseActive(value: string | undefined) {
  if (!value?.trim()) return true;
  const normalized = value.trim().toLowerCase();
  return !["inactive", "nonaktif", "false", "0", "no"].includes(normalized);
}

function hasStockColumnValue(rowData: Record<string, string>) {
  const raw = rowData.opening_stock ?? rowData.stok_awal ?? rowData.qty_onhand;
  return raw !== undefined && raw.trim() !== "";
}

function readStockQty(rowData: Record<string, string>) {
  return parseNumber(rowData.opening_stock || rowData.stok_awal || rowData.qty_onhand, 0);
}

function normalizeKategori(value: string | undefined) {
  return (value || "LAIN").trim().toUpperCase().replace(/\s+/g, "_");
}

async function resolveCategoryCode(
  code: string,
  companyId: string | null,
  cache: Map<string, boolean>
) {
  const normalized = normalizeKategori(code);
  const cacheKey = `${companyId || "*"}:${normalized}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ? normalized : null;

  // Prefer company-scoped master, then fall back to global template (company_id NULL).
  const row = await queryOne<{ code: string }>(
    companyId
      ? `SELECT code
         FROM item.raw_material_categories
         WHERE deleted_at IS NULL
           AND is_active = true
           AND upper(code) = upper($1)
           AND (company_id = $2 OR company_id IS NULL)
         ORDER BY company_id NULLS LAST
         LIMIT 1`
      : `SELECT code
         FROM item.raw_material_categories
         WHERE deleted_at IS NULL
           AND is_active = true
           AND upper(code) = upper($1)
         ORDER BY company_id NULLS LAST
         LIMIT 1`,
    companyId ? [normalized, companyId] : [normalized]
  );

  const valid = Boolean(row?.code);
  cache.set(cacheKey, valid);
  return valid ? normalized : null;
}

function normalizeCoa(value: string | undefined) {
  if (!value?.trim()) return null;
  const raw = value.trim().toUpperCase();
  return VALID_COA.has(raw) ? raw : null;
}

async function generateKode(
  db: Awaited<ReturnType<typeof createServerPgClient>>,
  companyId: string | null,
  branchId: string | null
) {
  const year = new Date().getFullYear();
  let query = db
    .from("raw_materials")
    .select("kode")
    .ilike("kode", `BHN-${year}-%`)
    .is("deleted_at", null)
    .order("kode", { ascending: false })
    .limit(1);

  query = companyId ? query.eq("company_id", companyId) : query.is("company_id", null);
  query = branchId ? query.eq("branch_id", branchId) : query.is("branch_id", null);

  const { data: lastCode } = await query.maybeSingle();
  let nextNum = 1;
  if (lastCode?.kode) {
    const match = lastCode.kode.match(/-(\d+)$/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  return `BHN-${year}-${String(nextNum).padStart(4, "0")}`;
}

async function resolveUnitId(
  db: Awaited<ReturnType<typeof createServerPgClient>>,
  kode: string,
  companyId: string | null,
  cache: Map<string, string | null>
) {
  const normalized = kode.trim().toUpperCase();
  const cacheKey = `${companyId || "*"}:${normalized}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

  // Prefer company-scoped unit, then fall back to global template.
  const row = await queryOne<{ id: string }>(
    companyId
      ? `SELECT id
         FROM item.units
         WHERE deleted_at IS NULL
           AND upper(kode) = upper($1)
           AND (company_id = $2 OR company_id IS NULL)
         ORDER BY company_id NULLS LAST
         LIMIT 1`
      : `SELECT id
         FROM item.units
         WHERE deleted_at IS NULL
           AND upper(kode) = upper($1)
         ORDER BY company_id NULLS LAST
         LIMIT 1`,
    companyId ? [normalized, companyId] : [normalized]
  );

  const id = row?.id ?? null;
  cache.set(cacheKey, id);
  return id;
}

async function resolveWarehouseId(
  db: Awaited<ReturnType<typeof createServerPgClient>>,
  code: string,
  branchId: string | null,
  cache: Map<string, string | null>
) {
  const normalized = code.trim().toUpperCase();
  const cacheKey = `${branchId || "global"}:${normalized}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

  let query = db
    .from("warehouses", "configuration")
    .select("id")
    .ilike("code", normalized)
    .eq("is_active", true);

  if (branchId) {
    query = query.eq("branch_id", branchId);
  }

  const { data } = await query.maybeSingle();
  const id = data?.id ?? null;
  cache.set(cacheKey, id);
  return id;
}

function resolveUnitCostForStock(
  hargaBeli: number,
  konversiFactor: number,
  hasSmallUnit: boolean
) {
  if (!hasSmallUnit || konversiFactor <= 0) return hargaBeli;
  return hargaBeli / konversiFactor;
}

async function upsertUnitConversions(
  db: Awaited<ReturnType<typeof createServerPgClient>>,
  material: {
    id: string;
    satuan_besar_id: string;
    satuan_kecil_id: string | null;
    konversi_factor: number;
  }
) {
  const conversions = [
    ...(material.satuan_kecil_id
      ? [{ satuan_id: material.satuan_kecil_id, qty_in_base_unit: 1, is_base: true }]
      : []),
    {
      satuan_id: material.satuan_besar_id,
      qty_in_base_unit: material.satuan_kecil_id ? material.konversi_factor || 1 : 1,
      is_base: !material.satuan_kecil_id,
    },
  ];

  const conversionsByUnit = new Map<string, (typeof conversions)[number]>();
  for (const conversion of conversions) {
    if (!conversionsByUnit.has(conversion.satuan_id)) {
      conversionsByUnit.set(conversion.satuan_id, conversion);
    }
  }

  const uniqueConversions = Array.from(conversionsByUnit.values());
  if (uniqueConversions.length === 0) return null;

  const { error } = await db.from("raw_material_unit_conversions").upsert(
    uniqueConversions.map((conversion) => ({
      raw_material_id: material.id,
      satuan_id: conversion.satuan_id,
      qty_in_base_unit: conversion.qty_in_base_unit,
      is_base: conversion.is_base,
      is_active: true,
    })),
    { onConflict: "raw_material_id,satuan_id" }
  );

  return error;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiRole([
      "admin",
      "purchasing_admin",
      "purchasing_staff",
      "purchasing_manager",
      "super_admin",
    ]);

    const scope = await getApiUserScope();
    const { companyId, branchId } = importBusinessIds(scope);

    const formData = await request.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ message: "File not found" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = parseSpreadsheetFile(buffer, file.name);
    if (rows.length < 2) {
      return NextResponse.json(
        { message: "File must include a header row and at least one data row" },
        { status: 400 }
      );
    }

    const headers = rows[0].map(normalizeHeader);
    const db = await createServerPgClient();
    const unitCache = new Map<string, string | null>();
    const warehouseCache = new Map<string, string | null>();
    const categoryCache = new Map<string, boolean>();
    const imported: Array<{ row: number; kode: string }> = [];
    const updated: Array<{ row: number; kode: string }> = [];
    const skipped: Array<{ row: number }> = [];
    const errors: Array<{ row: number; message: string }> = [];

    for (let i = 1; i < rows.length; i++) {
      const rowData: Record<string, string> = {};
      headers.forEach((header, idx) => {
        rowData[header] = rows[i][idx] || "";
      });
      const rowNumber = i + 1;

      const nama = rowData.nama?.trim();
      const satuanBesarKode =
        rowData.satuan_besar_kode?.trim() || rowData.satuan_pembelian?.trim();

      const missing: string[] = [];
      if (!nama) missing.push("nama");
      if (!satuanBesarKode) missing.push("satuan_besar_kode");
      if (!rowData.kategori?.trim()) missing.push("kategori");

      if (missing.length > 0) {
        errors.push({ row: rowNumber, message: `Required fields missing: ${missing.join(", ")}` });
        skipped.push({ row: rowNumber });
        continue;
      }

      const kategori = await resolveCategoryCode(rowData.kategori, companyId, categoryCache);
      if (!kategori) {
        errors.push({
          row: rowNumber,
          message: `Category "${rowData.kategori.trim()}" not found. Seed categories first or use a valid code.`,
        });
        skipped.push({ row: rowNumber });
        continue;
      }

      let finalKode = rowData.kode?.trim();
      if (!finalKode) {
        finalKode = await generateKode(db, companyId, branchId);
      }

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
        const satuanBesarId = await resolveUnitId(db, satuanBesarKode, companyId, unitCache);
        if (!satuanBesarId) {
          errors.push({
            row: rowNumber,
            message: `Large unit "${satuanBesarKode}" not found. Import units first.`,
          });
          skipped.push({ row: rowNumber });
          continue;
        }

        const satuanKecilKode =
          rowData.satuan_kecil_kode?.trim() || rowData.satuan_penggunaan?.trim() || "";
        let satuanKecilId: string | null = null;
        if (satuanKecilKode) {
          satuanKecilId = await resolveUnitId(db, satuanKecilKode, companyId, unitCache);
          if (!satuanKecilId) {
            errors.push({
              row: rowNumber,
              message: `Small unit "${satuanKecilKode}" not found`,
            });
            skipped.push({ row: rowNumber });
            continue;
          }
        }

        const konversiFactor = parseNumber(
          rowData.konversi_factor || rowData.qty_per_unit,
          1
        );
        const hargaBeli = parseNumber(rowData.harga_beli || rowData.harga_rata_rata, 0);
        const coa = normalizeCoa(rowData.coa);

        if (rowData.coa?.trim() && !coa) {
          errors.push({
            row: rowNumber,
            message: "COA must be PRODUCTION, RND, or ASSET",
          });
          skipped.push({ row: rowNumber });
          continue;
        }

        const warehouseCode =
          rowData.stall_code?.trim() || rowData.warehouse_code?.trim() || "";
        let warehouseId: string | null = null;
        if (warehouseCode) {
          warehouseId = await resolveWarehouseId(db, warehouseCode, branchId, warehouseCache);
          if (!warehouseId) {
            errors.push({
              row: rowNumber,
              message: `Stall code "${warehouseCode}" was not found for this branch`,
            });
            skipped.push({ row: rowNumber });
            continue;
          }
        }

        const updatePayload = {
          nama,
          kategori,
          deskripsi: rowData.deskripsi?.trim() || null,
          satuan_besar_id: satuanBesarId,
          satuan_kecil_id: satuanKecilId,
          konversi_factor: konversiFactor,
          stok_minimum: parseNumber(rowData.stok_minimum, 0),
          stok_maximum: parseNumber(rowData.stok_maximum || rowData.stok_maksimum, 0),
          shelf_life_days: parseOptionalInt(rowData.shelf_life_days || rowData.masa_simpan),
          coa,
          harga_beli: hargaBeli,
          is_active: parseActive(rowData.status),
        };

        const { data: saved, error: updateError } = await db
          .from("raw_materials")
          .update(updatePayload)
          .eq("id", existing.id)
          .select("id, satuan_besar_id, satuan_kecil_id, konversi_factor")
          .single();

        if (updateError || !saved) {
          errors.push({ row: rowNumber, message: updateError?.message || "Failed to update row" });
          skipped.push({ row: rowNumber });
          continue;
        }

        const conversionError = await upsertUnitConversions(db, saved);
        if (conversionError) {
          errors.push({ row: rowNumber, message: conversionError.message });
          skipped.push({ row: rowNumber });
          continue;
        }

        if (hasStockColumnValue(rowData)) {
          const stockQty = readStockQty(rowData);
          if (stockQty < 0) {
            errors.push({
              row: rowNumber,
              message: "Opening stock cannot be negative",
            });
            skipped.push({ row: rowNumber });
            continue;
          }

          try {
            await setStockFromImport(db, {
              rawMaterialId: saved.id,
              qtyActual: stockQty,
              unitCost: resolveUnitCostForStock(
                hargaBeli,
                konversiFactor,
                Boolean(satuanKecilId)
              ),
              userId: user.id,
              warehouseId,
              materialKode: finalKode,
            });
          } catch (stockError) {
            errors.push({
              row: rowNumber,
              message:
                stockError instanceof Error
                  ? stockError.message
                  : "Failed to update stock",
            });
            skipped.push({ row: rowNumber });
            continue;
          }
        }

        updated.push({ row: rowNumber, kode: finalKode });
        continue;
      }

      const satuanBesarId = await resolveUnitId(db, satuanBesarKode, companyId, unitCache);
      if (!satuanBesarId) {
        errors.push({
          row: rowNumber,
          message: `Satuan besar "${satuanBesarKode}" tidak ditemukan. Import satuan terlebih dahulu.`,
        });
        skipped.push({ row: rowNumber });
        continue;
      }

      const satuanKecilKode =
        rowData.satuan_kecil_kode?.trim() || rowData.satuan_penggunaan?.trim() || "";
      let satuanKecilId: string | null = null;
      if (satuanKecilKode) {
        satuanKecilId = await resolveUnitId(db, satuanKecilKode, companyId, unitCache);
        if (!satuanKecilId) {
          errors.push({
            row: rowNumber,
            message: `Satuan kecil "${satuanKecilKode}" tidak ditemukan`,
          });
          skipped.push({ row: rowNumber });
          continue;
        }
      }

      const konversiFactor = parseNumber(
        rowData.konversi_factor || rowData.qty_per_unit,
        1
      );
      const hargaBeli = parseNumber(rowData.harga_beli || rowData.harga_rata_rata, 0);
      const openingStock = parseNumber(
        rowData.opening_stock || rowData.stok_awal,
        0
      );
      const warehouseCode =
        rowData.stall_code?.trim() || rowData.warehouse_code?.trim() || "";
      const coa = normalizeCoa(rowData.coa);

      if (rowData.coa?.trim() && !coa) {
        errors.push({
          row: rowNumber,
          message: "COA harus PRODUCTION, RND, atau ASSET",
        });
        skipped.push({ row: rowNumber });
        continue;
      }

      let warehouseId: string | null = null;
      if (warehouseCode) {
        warehouseId = await resolveWarehouseId(db, warehouseCode, branchId, warehouseCache);
        if (!warehouseId) {
          errors.push({
            row: rowNumber,
            message: `Stall code "${warehouseCode}" was not found for this branch`,
          });
          skipped.push({ row: rowNumber });
          continue;
        }
      }

      if (openingStock < 0) {
        errors.push({
          row: rowNumber,
          message: "Opening stock cannot be negative",
        });
        skipped.push({ row: rowNumber });
        continue;
      }

      const insertPayload = {
        kode: finalKode,
        nama,
        kategori,
        deskripsi: rowData.deskripsi?.trim() || null,
        satuan_besar_id: satuanBesarId,
        satuan_kecil_id: satuanKecilId,
        konversi_factor: konversiFactor,
        stok_minimum: parseNumber(rowData.stok_minimum, 0),
        stok_maximum: parseNumber(rowData.stok_maximum || rowData.stok_maksimum, 0),
        shelf_life_days: parseOptionalInt(rowData.shelf_life_days || rowData.masa_simpan),
        coa,
        harga_beli: hargaBeli,
        company_id: companyId,
        branch_id: branchId,
        is_active: parseActive(rowData.status),
      };

      const { data: created, error } = await db
        .from("raw_materials")
        .insert(insertPayload)
        .select("id, satuan_besar_id, satuan_kecil_id, konversi_factor")
        .single();

      if (error || !created) {
        errors.push({ row: rowNumber, message: error?.message || "Gagal menyimpan data" });
        skipped.push({ row: rowNumber });
        continue;
      }

      const conversionError = await upsertUnitConversions(db, created);
      if (conversionError) {
        await db.from("raw_materials").delete().eq("id", created.id);
        errors.push({ row: rowNumber, message: conversionError.message });
        skipped.push({ row: rowNumber });
        continue;
      }

      if (openingStock > 0) {
        try {
          await addOpeningStockFromImport(db, {
            rawMaterialId: created.id,
            qty: openingStock,
            unitCost: resolveUnitCostForStock(hargaBeli, konversiFactor, Boolean(satuanKecilId)),
            userId: user.id,
            warehouseId,
            materialKode: finalKode,
          });
        } catch (stockError) {
          await db.from("raw_materials").delete().eq("id", created.id);
          errors.push({
            row: rowNumber,
            message:
              stockError instanceof Error
                ? stockError.message
                : "Failed to create opening stock",
          });
          skipped.push({ row: rowNumber });
          continue;
        }
      }

      imported.push({ row: rowNumber, kode: finalKode });
    }

    return NextResponse.json({
      success: true,
      imported: imported.length,
      updated: updated.length,
      skipped: skipped.length,
      errors,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Import raw materials error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Import gagal" },
      { status: 500 }
    );
  }
}
