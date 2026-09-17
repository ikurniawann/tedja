import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope, importBusinessIds, validateProductWarehouseScope } from "@/lib/api/scope";
import { queryOne } from "@/lib/db";
import {
  normalizeProductSpreadsheetHeader,
  parseProductSpreadsheetFile,
} from "@/lib/purchasing/product-spreadsheet";

const VALID_OUTPUT_TYPES = new Set(["FINISHED_GOOD", "WIP"]);

const PRODUCT_FIELD_KEYS = [
  "kode",
  "nama",
  "stall_code",
  "kategori",
  "satuan_kode",
  "deskripsi",
  "harga_jual",
  "harga_modal",
  "markup_persen",
  "production_output_type",
  "status",
];

function normalizeHeader(header: string) {
  return normalizeProductSpreadsheetHeader(header);
}

function emptyToNull(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseNumber(value: string | undefined, fallback = 0) {
  if (!value?.trim()) return fallback;
  const normalized = value.replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStatus(value: string | undefined) {
  if (!value?.trim()) return true;
  const raw = value.trim().toLowerCase();
  if (["inactive", "nonaktif", "false", "0", "no"].includes(raw)) return false;
  return true;
}

function normalizeOutputType(value: string | undefined) {
  if (!value?.trim()) return "FINISHED_GOOD";
  const raw = value.trim().toUpperCase().replace(/\s+/g, "_");
  if (raw === "WIP" || raw === "WORK_IN_PROGRESS") return "WIP";
  return VALID_OUTPUT_TYPES.has(raw) ? raw : "FINISHED_GOOD";
}

function isEmptyRow(rowData: Record<string, string>) {
  return PRODUCT_FIELD_KEYS.every((key) => !rowData[key]?.trim());
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

async function resolveUnitId(
  unitCode: string,
  companyId: string | null,
  cache: Map<string, string | null>
) {
  const normalized = unitCode.trim().toUpperCase();
  const cacheKey = `${companyId || "*"}:${normalized}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

  const row = await queryOne<{ id: string }>(
    companyId
      ? `SELECT id
         FROM item.units
         WHERE deleted_at IS NULL
           AND upper(kode) = upper($1)
           AND company_id = $2
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

async function isValidCategory(
  categoryCode: string,
  companyId: string | null,
  cache: Map<string, boolean>
) {
  const normalized = categoryCode.trim().toUpperCase();
  const cacheKey = `${companyId || "*"}:${normalized}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? false;

  const row = companyId
    ? await queryOne<{ code: string }>(
        `SELECT code
         FROM item.product_categories
         WHERE deleted_at IS NULL
           AND upper(code) = upper($1)
           AND (company_id IS NULL OR company_id = $2)
         LIMIT 1`,
        [normalized, companyId]
      )
    : await queryOne<{ code: string }>(
        `SELECT code
         FROM item.product_categories
         WHERE deleted_at IS NULL
           AND upper(code) = upper($1)
           AND company_id IS NULL
         LIMIT 1`,
        [normalized]
      );

  const valid = Boolean(row?.code);
  cache.set(cacheKey, valid);
  return valid;
}

function buildProductPayload(
  rowData: Record<string, string>,
  satuanId: string
) {
  const isActive = normalizeStatus(rowData.status);
  return {
    nama: rowData.nama.trim(),
    kategori: emptyToNull(rowData.kategori)?.toUpperCase() ?? null,
    satuan_id: satuanId,
    deskripsi: emptyToNull(rowData.deskripsi),
    harga_jual: parseNumber(rowData.harga_jual, 0),
    harga_modal: parseNumber(rowData.harga_modal, 0),
    markup_persen: parseNumber(rowData.markup_persen, 30),
    production_output_type: normalizeOutputType(rowData.production_output_type),
    is_active: isActive,
  };
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);

    const scope = await getApiUserScope();
    const { branchId: scopeBranchId } = importBusinessIds(scope);

    const formData = await request.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ message: "File not found" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = await parseProductSpreadsheetFile(buffer, file.name);
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

      if (isEmptyRow(rowData)) {
        continue;
      }

      const nama = (rowData.nama || "").trim();
      if (!nama) {
        errors.push({ row: rowNumber, message: "Required field missing: nama" });
        skipped.push({ row: rowNumber });
        continue;
      }
      rowData.nama = nama;

      const stallCode =
        rowData.stall_code?.trim() || rowData.warehouse_code?.trim() || "";
      if (!stallCode) {
        errors.push({ row: rowNumber, message: "Required field missing: stall_code" });
        skipped.push({ row: rowNumber });
        continue;
      }

      const warehouseId = await resolveWarehouseId(db, stallCode, scopeBranchId, warehouseCache);
      if (!warehouseId) {
        errors.push({
          row: rowNumber,
          message: `Stall code not found: ${stallCode}`,
        });
        skipped.push({ row: rowNumber });
        continue;
      }

      const warehouseScope = await validateProductWarehouseScope(warehouseId, scope);
      if ("error" in warehouseScope) {
        errors.push({ row: rowNumber, message: warehouseScope.error });
        skipped.push({ row: rowNumber });
        continue;
      }

      const { company_id: companyId, branch_id: branchId } = warehouseScope;

      const satuanKode = (rowData.satuan_kode || rowData.satuan || "").trim();
      if (!satuanKode) {
        errors.push({ row: rowNumber, message: "Required field missing: satuan_kode" });
        skipped.push({ row: rowNumber });
        continue;
      }

      const satuanId = await resolveUnitId(satuanKode, companyId, unitCache);
      if (!satuanId) {
        errors.push({
          row: rowNumber,
          message: `Unit code not found: ${satuanKode}`,
        });
        skipped.push({ row: rowNumber });
        continue;
      }

      if (rowData.kategori?.trim()) {
        const categoryValid = await isValidCategory(rowData.kategori, companyId, categoryCache);
        if (!categoryValid) {
          errors.push({
            row: rowNumber,
            message: `Category code not found: ${rowData.kategori.trim()}`,
          });
          skipped.push({ row: rowNumber });
          continue;
        }
      }

      let finalKode = rowData.kode?.trim();
      if (!finalKode) {
        finalKode = await generateProductCode(db, companyId, branchId, warehouseId);
      }

      let existingQuery = db
        .from("products")
        .select("id")
        .eq("kode", finalKode)
        .eq("warehouse_id", warehouseId)
        .is("deleted_at", null);
      existingQuery = companyId
        ? existingQuery.eq("company_id", companyId)
        : existingQuery.is("company_id", null);
      existingQuery = branchId
        ? existingQuery.eq("branch_id", branchId)
        : existingQuery.is("branch_id", null);

      const { data: existing } = await existingQuery.maybeSingle();
      const payload = buildProductPayload(rowData, satuanId);

      if (existing?.id) {
        const { error } = await db
          .from("products")
          .update({
            ...payload,
            warehouse_id: warehouseId,
            company_id: companyId,
            branch_id: branchId,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        if (error) {
          errors.push({ row: rowNumber, message: error.message });
          skipped.push({ row: rowNumber });
        } else {
          updated.push({ row: rowNumber, kode: finalKode });
        }
        continue;
      }

      const { error } = await db.from("products").insert({
        kode: finalKode,
        company_id: companyId,
        branch_id: branchId,
        warehouse_id: warehouseId,
        ...payload,
        created_by: user.id,
      });

      if (error) {
        errors.push({ row: rowNumber, message: error.message });
        skipped.push({ row: rowNumber });
      } else {
        imported.push({ row: rowNumber, kode: finalKode });
      }
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
    console.error("Import products error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}
