import { NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
} from "@/lib/api/scope";
import { query } from "@/lib/db";
import {
  buildSupplierWorkbook,
  workbookToBuffer,
} from "@/lib/purchasing/supplier-spreadsheet";

type ExportRow = {
  kode: string;
  nama_supplier: string;
  pic_name: string | null;
  pic_phone: string | null;
  pic_email: string | null;
  telepon: string | null;
  email: string | null;
  alamat: string | null;
  kota: string | null;
  npwp: string | null;
  payment_terms: string;
  currency: string;
  bank_nama: string | null;
  bank_rekening: string | null;
  bank_atas_nama: string | null;
  kategori: string | null;
  catatan: string | null;
  status: string;
};

export async function GET() {
  try {
    await requireApiRole([
      "purchasing_admin",
      "purchasing_staff",
      "purchasing_manager",
      "super_admin",
    ]);

    const scope = await getApiUserScope();
    const params: unknown[] = [];
    const filters: string[] = ["s.deleted_at IS NULL"];

    const companyOr = companyScopeOr(scope);
    if (companyOr) {
      const companyId = scope?.companyId;
      if (companyId) {
        params.push(companyId);
        filters.push(`s.company_id = $${params.length}`);
      }
    }

    const branchOr = branchScopeOr(scope);
    if (branchOr) {
      const branchId = scope?.branchId;
      if (branchId) {
        params.push(branchId);
        filters.push(`s.branch_id = $${params.length}`);
      }
    }

    const rows = await query<ExportRow>(
      `SELECT
         s.kode,
         s.nama_supplier,
         s.pic_name,
         s.pic_phone,
         s.pic_email,
         s.telepon,
         s.email,
         s.alamat,
         s.kota,
         s.npwp,
         COALESCE(s.payment_terms, 'TOP30') AS payment_terms,
         COALESCE(s.currency, 'IDR') AS currency,
         s.bank_nama,
         s.bank_rekening,
         s.bank_atas_nama,
         s.kategori,
         s.catatan,
         COALESCE(s.status, 'active') AS status
       FROM purchasing.suppliers s
       WHERE ${filters.join(" AND ")}
       ORDER BY s.nama_supplier ASC`,
      params
    );

    const workbook = buildSupplierWorkbook(
      rows.map((row) => ({
        kode: row.kode,
        nama_supplier: row.nama_supplier,
        pic_name: row.pic_name ?? "",
        pic_phone: row.pic_phone ?? "",
        pic_email: row.pic_email ?? "",
        telepon: row.telepon ?? "",
        email: row.email ?? "",
        alamat: row.alamat ?? "",
        kota: row.kota ?? "",
        npwp: row.npwp ?? "",
        payment_terms: row.payment_terms,
        currency: row.currency,
        bank_nama: row.bank_nama ?? "",
        bank_rekening: row.bank_rekening ?? "",
        bank_atas_nama: row.bank_atas_nama ?? "",
        kategori: row.kategori ?? "",
        catatan: row.catatan ?? "",
        status: row.status,
      }))
    );

    const buffer = workbookToBuffer(workbook);
    const date = new Date().toISOString().split("T")[0];

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="suppliers-${date}.xlsx"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Export suppliers error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Export failed" },
      { status: 500 }
    );
  }
}
