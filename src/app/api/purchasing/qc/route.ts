import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, successResponse, createdResponse, paginatedResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { submitGrnQcInspection } from "@/lib/purchasing/grn-qc";
import { resolveOverallQcStatus } from "@/lib/purchasing/grn-qc-utils";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
} from "@/lib/api/scope";

const qcItemSchema = z.object({
  grn_item_id: z.string().uuid("GRN Item ID tidak valid"),
  bahan_baku_id: z.string().uuid("Raw material ID tidak valid").optional(),
  raw_material_id: z.string().uuid("Raw material ID tidak valid").optional(),
  jumlah_diperiksa: z.number().min(0).optional(),
  jumlah_diterima: z.number().min(0).optional(),
  jumlah_ditolak: z.number().min(0).optional(),
  qty_inspected: z.number().min(0).optional(),
  qty_accepted: z.number().min(0).optional(),
  qty_rejected: z.number().min(0).optional(),
  hasil: z.enum(["passed", "rejected", "partial"]).optional(),
  parameter_inspeksi: z.record(z.string(), z.unknown()).optional(),
  alasan: z.string().optional(),
  catatan: z.string().optional().nullable(),
});

const createQCSchema = z.object({
  grn_id: z.string().uuid("GRN ID tidak valid"),
  items: z.array(qcItemSchema).min(1, "Minimal 1 item QC"),
  catatan: z.string().optional().nullable(),
  parameter_inspeksi: z.record(z.string(), z.unknown()).optional(),
  hasil_inspeksi: z.record(z.string(), z.string()).optional(),
  rekomendasi: z.string().optional().nullable(),
});

function mapQcStatus(
  status: string | null | undefined
): "APPROVED" | "REJECTED" | "PARTIAL" {
  if (status === "approved") return "APPROVED";
  if (status === "rejected") return "REJECTED";
  return "PARTIAL";
}

function mapInspectionRow(row: Record<string, unknown>) {
  const items = (row.items as Array<Record<string, unknown>> | undefined) || [];
  const firstItem = items[0];
  const grn = row.grn as { nomor_grn?: string } | null | undefined;

  return {
    id: row.id,
    qc_number: row.id,
    goods_receipt_id: row.grn_id,
    grn_id: row.grn_id,
    grn_number: grn?.nomor_grn,
    bahan_baku_id: firstItem?.raw_material_id,
    jumlah_diperiksa: items.reduce((s, i) => s + Number(i.qty_inspected || 0), 0),
    jumlah_diterima: items.reduce((s, i) => s + Number(i.qty_accepted || 0), 0),
    jumlah_ditolak: items.reduce((s, i) => s + Number(i.qty_rejected || 0), 0),
    hasil: row.status,
    parameter_inspeksi: row.parameter_inspeksi,
    catatan: row.catatan,
    inspector_id: row.inspector_id,
    inspector: row.inspector,
    tanggal_inspeksi: row.inspected_at || row.created_at,
    created_at: row.created_at,
    status: mapQcStatus(row.status as string),
    rekomendasi:
      row.status === "approved" ? "ACCEPT" : row.status === "rejected" ? "REJECT" : "REWORK",
    items: items.map((item) => ({
      bahan_baku_id: item.raw_material_id,
      raw_material_id: item.raw_material_id,
      jumlah_diperiksa: item.qty_inspected,
      jumlah_diterima: item.qty_accepted,
      jumlah_ditolak: item.qty_rejected,
      raw_material: item.raw_material,
    })),
  };
}

// GET /api/purchasing/qc — list QC inspections (grn_qc_inspections)
export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.items);
    const db = await createServerPgClient();

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "15", 10);
    const search = url.searchParams.get("search") || "";
    const offset = (page - 1) * limit;

    let query = db
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
      `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false });

    const scope = await getApiUserScope();
    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    if (search) {
      query = query.or(`grn.nomor_grn.ilike.%${search}%`);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) throw error;

    const mapped = (data || []).map((row: Record<string, unknown>) =>
      mapInspectionRow(row)
    );

    return paginatedResponse(mapped, {
      page,
      limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / limit),
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching QC:", error);
    return ApiError.server("Failed to fetch QC inspections").toResponse();
  }
}

// POST /api/purchasing/qc — submit QC via grn_qc_inspections
export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const db = await createServerPgClient();

    const body = await request.json();
    const validated = createQCSchema.parse(body);

    const mappedItems = validated.items.map((item) => {
      const rawMaterialId = item.raw_material_id || item.bahan_baku_id;
      if (!rawMaterialId) {
        throw ApiError.badRequest("raw_material_id atau bahan_baku_id wajib diisi per item");
      }

      const qtyInspected =
        item.qty_inspected ?? item.jumlah_diperiksa ?? (item.qty_accepted ?? item.jumlah_diterima ?? 0) + (item.qty_rejected ?? item.jumlah_ditolak ?? 0);
      const qtyAccepted = item.qty_accepted ?? item.jumlah_diterima ?? 0;
      const qtyRejected = item.qty_rejected ?? item.jumlah_ditolak ?? 0;

      return {
        grn_item_id: item.grn_item_id,
        raw_material_id: rawMaterialId,
        qty_inspected: qtyInspected,
        qty_accepted: qtyAccepted,
        qty_rejected: qtyRejected,
        catatan: item.catatan ?? item.alasan ?? null,
      };
    });

    const overallStatus = resolveOverallQcStatus(
      mappedItems.map((item) => ({
        qty_inspected: item.qty_inspected,
        qty_accepted: item.qty_accepted,
        qty_rejected: item.qty_rejected,
      }))
    );

    const result = await submitGrnQcInspection(db, {
      grnId: validated.grn_id,
      status: overallStatus,
      parameter_inspeksi: validated.parameter_inspeksi,
      hasil_inspeksi: validated.hasil_inspeksi,
      catatan: validated.catatan ?? null,
      rekomendasi: validated.rekomendasi ?? null,
      items: mappedItems,
      userId: user.id,
    });

    return createdResponse(
      {
        grn_id: validated.grn_id,
        inspection_id: result.inspectionId,
        grn_status: result.grnStatus,
        total_accepted: result.totalAccepted,
        total_rejected: result.totalRejected,
      },
      "QC submitted successfully"
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validation failed", error.issues).toResponse();
    }
    console.error("Error submitting QC:", error);
    return ApiError.server(error instanceof Error ? error.message : "Failed to submit QC").toResponse();
  }
}
