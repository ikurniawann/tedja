import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest } from "next/server";
import { requireApiRole, ApiError, successResponse } from "@/lib/api/auth";

function mapQcStatus(
  status: string | null | undefined
): "APPROVED" | "REJECTED" | "PARTIAL" {
  if (status === "approved") return "APPROVED";
  if (status === "rejected") return "REJECTED";
  return "PARTIAL";
}

// GET /api/purchasing/qc/:id
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiRole([
      "purchasing_admin",
      "purchasing_staff",
      "warehouse_staff",
      "purchasing_manager",
      "super_admin",
    ]);
    const db = await createServerPgClient();
    const { id } = await params;

    const { data, error } = await db
      .from("grn_qc_inspections")
      .select(
        `
        *,
        grn:grn_id(id, nomor_grn),
        inspector:inspector_id(id, name, email),
        items:grn_qc_inspection_items(
          id,
          grn_item_id,
          raw_material_id,
          qty_inspected,
          qty_accepted,
          qty_rejected,
          raw_material:raw_materials!raw_material_id(id, kode, nama)
        )
      `
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw ApiError.notFound("QC inspection tidak ditemukan");
    }

    const items = (data.items as Array<Record<string, unknown>> | undefined) || [];
    const firstItem = items[0];
    const grn = data.grn as { nomor_grn?: string } | null | undefined;

    return successResponse({
      ...data,
      qc_number: data.id,
      goods_receipt_id: data.grn_id,
      grn_number: grn?.nomor_grn,
      bahan_baku_id: firstItem?.raw_material_id,
      bahan_baku: firstItem?.raw_material,
      jumlah_diperiksa: items.reduce((s, i) => s + Number(i.qty_inspected || 0), 0),
      jumlah_diterima: items.reduce((s, i) => s + Number(i.qty_accepted || 0), 0),
      jumlah_ditolak: items.reduce((s, i) => s + Number(i.qty_rejected || 0), 0),
      tanggal_inspeksi: data.inspected_at || data.created_at,
      status: mapQcStatus(data.status as string),
      rekomendasi:
        data.status === "approved" ? "ACCEPT" : data.status === "rejected" ? "REJECT" : "REWORK",
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching QC detail:", error);
    return ApiError.server("Failed to fetch QC inspection").toResponse();
  }
}
