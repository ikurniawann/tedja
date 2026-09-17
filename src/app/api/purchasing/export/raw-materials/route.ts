import { NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
} from "@/lib/api/scope";
import { getApiStallScope } from "@/lib/api/stall-scope";
import { query } from "@/lib/db";
import {
  buildRawMaterialWorkbookBuffer,
} from "@/lib/purchasing/raw-material-spreadsheet";

type ExportRow = {
  kode: string;
  nama: string;
  kategori: string;
  satuan_besar_kode: string | null;
  satuan_kecil_kode: string | null;
  konversi_factor: number | string;
  stok_minimum: number | string;
  stok_maximum: number | string | null;
  shelf_life_days: number | string | null;
  coa: string | null;
  harga_beli: number | string;
  opening_stock: number | string;
  stall_code: string;
  deskripsi: string | null;
  status: string;
};

export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.items);

    const scope = await getApiUserScope();
    const params: unknown[] = [];
    const filters: string[] = ["rm.deleted_at IS NULL"];

    const companyOr = companyScopeOr(scope);
    if (companyOr) {
      const companyId = scope?.companyId;
      if (companyId) {
        params.push(companyId);
        filters.push(`rm.company_id = $${params.length}`);
      }
    }

    const branchOr = branchScopeOr(scope);
    if (branchOr) {
      const branchId = scope?.branchId;
      if (branchId) {
        params.push(branchId);
        filters.push(`rm.branch_id = $${params.length}`);
      }
    }

    // Stok awal yang diekspor mengikuti stall aktif di sidebar, agar isi file
    // sama dengan tabel yang sedang dilihat.
    //
    // Mode "Semua Stall" jatuh ke gudang default cabang (`is_default`), bukan
    // ke kode 'MAIN' seperti sebelumnya: kode itu tidak ada di setiap cabang —
    // di produksi gudang utamanya `WH-01` — sehingga join-nya kosong dan file
    // keluar dengan `stall_code=MAIN` yang ditolak saat diimpor balik.
    const stallScope = await getApiStallScope();
    let warehouseJoin = `wh.branch_id = rm.branch_id
        AND wh.is_default = true
        AND wh.is_active = true`;
    if (stallScope.mode === "stall") {
      params.push(stallScope.warehouseId);
      warehouseJoin = `wh.id = $${params.length}
        AND wh.is_active = true`;
    }

    const rows = await query<ExportRow>(
      `SELECT
         rm.kode,
         rm.nama,
         rm.kategori,
         ub.kode AS satuan_besar_kode,
         uk.kode AS satuan_kecil_kode,
         rm.konversi_factor,
         rm.stok_minimum,
         rm.stok_maximum,
         rm.shelf_life_days,
         rm.coa,
         COALESCE(rm.harga_beli, 0) AS harga_beli,
         COALESCE(inv.qty_available, 0) AS opening_stock,
         -- Kosong bila cabang tidak punya gudang default; impor akan
         -- me-resolve lokasinya sendiri, sementara kode palsu akan ditolak.
         COALESCE(wh.code, '') AS stall_code,
         rm.deskripsi,
         CASE WHEN rm.is_active THEN 'active' ELSE 'inactive' END AS status
       FROM item.raw_materials rm
       LEFT JOIN item.units ub ON ub.id = rm.satuan_besar_id
       LEFT JOIN item.units uk ON uk.id = rm.satuan_kecil_id
       LEFT JOIN configuration.warehouses wh
         ON ${warehouseJoin}
       LEFT JOIN inventory.inventory inv
         ON inv.raw_material_id = rm.id
        AND inv.warehouse_id = wh.id
        AND inv.is_active = true
       WHERE ${filters.join(" AND ")}
       ORDER BY rm.nama ASC`,
      params
    );

    const buffer = await buildRawMaterialWorkbookBuffer(
      rows.map((row) => ({
        kode: row.kode,
        nama: row.nama,
        kategori: row.kategori,
        satuan_besar_kode: row.satuan_besar_kode ?? "",
        satuan_kecil_kode: row.satuan_kecil_kode ?? "",
        konversi_factor: row.konversi_factor ?? 1,
        stok_minimum: row.stok_minimum ?? 0,
        stok_maximum: row.stok_maximum ?? "",
        shelf_life_days: row.shelf_life_days ?? "",
        coa: row.coa ?? "",
        harga_beli: row.harga_beli ?? 0,
        opening_stock: row.opening_stock ?? 0,
        // Jangan paksa "MAIN" — kode itu belum tentu ada di cabang manapun.
        stall_code: row.stall_code ?? "",
        deskripsi: row.deskripsi ?? "",
        status: row.status,
      }))
    );

    const date = new Date().toISOString().split("T")[0];

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="raw-materials-${date}.xlsx"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Export raw materials error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Export failed" },
      { status: 500 }
    );
  }
}
