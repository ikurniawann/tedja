import { NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
} from "@/lib/api/scope";
import { query } from "@/lib/db";
import {
  buildProductWorkbook,
  workbookToBuffer,
} from "@/lib/purchasing/product-spreadsheet";

type ExportRow = {
  kode: string;
  nama: string;
  stall_code: string | null;
  kategori: string | null;
  satuan_kode: string | null;
  deskripsi: string | null;
  harga_jual: string | number;
  harga_modal: string | number;
  markup_persen: string | number;
  production_output_type: string;
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
    const filters: string[] = ["p.deleted_at IS NULL"];

    const companyOr = companyScopeOr(scope);
    if (companyOr) {
      const companyId = scope?.companyId;
      if (companyId) {
        params.push(companyId);
        filters.push(`p.company_id = $${params.length}`);
      }
    }

    const branchOr = branchScopeOr(scope);
    if (branchOr) {
      const branchId = scope?.branchId;
      if (branchId) {
        params.push(branchId);
        filters.push(`p.branch_id = $${params.length}`);
      }
    }

    const rows = await query<ExportRow>(
      `SELECT
         p.kode,
         p.nama,
         wh.code AS stall_code,
         p.kategori,
         u.kode AS satuan_kode,
         p.deskripsi,
         COALESCE(p.harga_jual, 0) AS harga_jual,
         COALESCE(p.harga_modal, 0) AS harga_modal,
         COALESCE(p.markup_persen, 30) AS markup_persen,
         COALESCE(p.production_output_type, 'FINISHED_GOOD') AS production_output_type,
         CASE WHEN COALESCE(p.is_active, true) THEN 'active' ELSE 'inactive' END AS status
       FROM item.products p
       LEFT JOIN item.units u ON u.id = p.satuan_id
       LEFT JOIN configuration.warehouses wh ON wh.id = p.warehouse_id
       WHERE ${filters.join(" AND ")}
       ORDER BY wh.code ASC, p.nama ASC`,
      params
    );

    const workbook = buildProductWorkbook(
      rows.map((row) => ({
        kode: row.kode,
        nama: row.nama,
        stall_code: row.stall_code ?? "",
        kategori: row.kategori ?? "",
        satuan_kode: row.satuan_kode ?? "",
        deskripsi: row.deskripsi ?? "",
        harga_jual: row.harga_jual,
        harga_modal: row.harga_modal,
        markup_persen: row.markup_persen,
        production_output_type: row.production_output_type,
        status: row.status,
      }))
    );

    const buffer = workbookToBuffer(workbook);
    const date = new Date().toISOString().split("T")[0];
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );

    return new NextResponse(arrayBuffer as ArrayBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="products-${date}.xlsx"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Export products error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Export failed" },
      { status: 500 }
    );
  }
}
