import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope, importBusinessIds } from "@/lib/api/scope";
import {
  normalizeSupplierSpreadsheetHeader,
  parseSupplierSpreadsheetFile,
} from "@/lib/purchasing/supplier-spreadsheet";
import type { Currency, PaymentTerms, SupplierStatus } from "@/types/supplier";
import { CURRENCY_OPTIONS, PAYMENT_TERMS_OPTIONS } from "@/types/supplier";

const VALID_PAYMENT_TERMS = new Set<string>(PAYMENT_TERMS_OPTIONS);
const VALID_CURRENCIES = new Set<string>(CURRENCY_OPTIONS);
const VALID_STATUSES = new Set<string>([
  "active",
  "inactive",
  "probation",
  "blocked",
  "draft",
]);

function normalizeHeader(header: string) {
  return normalizeSupplierSpreadsheetHeader(header);
}

function emptyToNull(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizePaymentTerms(value: string | undefined): PaymentTerms {
  if (!value?.trim()) return "TOP30";
  const raw = value.trim().toUpperCase().replace(/\s+/g, "");
  if (VALID_PAYMENT_TERMS.has(raw)) return raw as PaymentTerms;
  if (raw === "CASH" || raw === "COD") return "CBD";
  const topMatch = raw.match(/^TOP(\d+)$/);
  if (topMatch) {
    const candidate = `TOP${topMatch[1]}` as PaymentTerms;
    if (VALID_PAYMENT_TERMS.has(candidate)) return candidate;
  }
  return "TOP30";
}

function normalizeCurrency(value: string | undefined): Currency {
  if (!value?.trim()) return "IDR";
  const raw = value.trim().toUpperCase();
  return VALID_CURRENCIES.has(raw) ? (raw as Currency) : "IDR";
}

function normalizeStatus(value: string | undefined): SupplierStatus {
  if (!value?.trim()) return "active";
  const raw = value.trim().toLowerCase();
  if (VALID_STATUSES.has(raw)) return raw as SupplierStatus;
  if (["aktif", "true", "1", "yes"].includes(raw)) return "active";
  if (["nonaktif", "false", "0", "no"].includes(raw)) return "inactive";
  return "active";
}

const SUPPLIER_FIELD_KEYS = [
  "kode",
  "nama_supplier",
  "pic_name",
  "pic_phone",
  "pic_email",
  "telepon",
  "email",
  "alamat",
  "kota",
  "npwp",
  "payment_terms",
  "currency",
  "bank_nama",
  "bank_rekening",
  "bank_atas_nama",
  "kategori",
  "catatan",
  "status",
];

function isEmptyRow(rowData: Record<string, string>) {
  return SUPPLIER_FIELD_KEYS.every((key) => !rowData[key]?.trim());
}

async function generateSupplierCode(
  db: Awaited<ReturnType<typeof createServerPgClient>>
) {
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
    seq = parseInt(parts[parts.length - 1], 10) + 1;
  }
  return `SUP-${year}-${String(seq).padStart(4, "0")}`;
}

function buildSupplierPayload(rowData: Record<string, string>) {
  const status = normalizeStatus(rowData.status);
  return {
    nama_supplier: rowData.nama_supplier.trim(),
    pic_name: emptyToNull(rowData.pic_name),
    pic_phone: emptyToNull(rowData.pic_phone),
    pic_email: emptyToNull(rowData.pic_email),
    telepon: emptyToNull(rowData.telepon),
    email: emptyToNull(rowData.email),
    alamat: emptyToNull(rowData.alamat),
    kota: emptyToNull(rowData.kota),
    npwp: emptyToNull(rowData.npwp),
    payment_terms: normalizePaymentTerms(rowData.payment_terms),
    currency: normalizeCurrency(rowData.currency),
    bank_nama: emptyToNull(rowData.bank_nama),
    bank_rekening: emptyToNull(rowData.bank_rekening),
    bank_atas_nama: emptyToNull(rowData.bank_atas_nama),
    kategori: emptyToNull(rowData.kategori),
    catatan: emptyToNull(rowData.catatan),
    status,
    is_active: status !== "inactive" && status !== "blocked",
  };
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);

    const scope = await getApiUserScope();
    const { companyId, branchId } = importBusinessIds(scope);

    const formData = await request.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ message: "File not found" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = parseSupplierSpreadsheetFile(buffer, file.name);
    if (rows.length < 2) {
      return NextResponse.json(
        { message: "File must include a header row and at least one data row" },
        { status: 400 }
      );
    }

    const headers = rows[0].map(normalizeHeader);
    const db = await createServerPgClient();
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

      const namaSupplier = (rowData.nama_supplier || rowData.nama || "").trim();
      if (!namaSupplier) {
        errors.push({ row: rowNumber, message: "Required field missing: nama_supplier" });
        skipped.push({ row: rowNumber });
        continue;
      }
      rowData.nama_supplier = namaSupplier;

      let finalKode = rowData.kode?.trim();
      if (!finalKode) {
        finalKode = await generateSupplierCode(db);
      }

      let existingQuery = db
        .from("suppliers")
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
      const payload = buildSupplierPayload(rowData);

      if (existing?.id) {
        const { error } = await db
          .from("suppliers")
          .update({
            ...payload,
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

      const { error } = await db.from("suppliers").insert({
        kode: finalKode,
        company_id: companyId,
        branch_id: branchId,
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
    console.error("Import suppliers error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}
