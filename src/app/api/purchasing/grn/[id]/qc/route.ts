import { NextRequest } from "next/server";
import { z } from "zod";
import { createPgClient } from "@/lib/pg/create-client";
import { ApiError, successResponse, createdResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { submitGrnQcInspection } from "@/lib/purchasing/grn-qc";
import type { UserRole } from "@/types";

const QC_ROLES: UserRole[] = [
  "qc_staff",
  "warehouse_staff",
  "warehouse_admin",
  "purchasing_admin",
  "purchasing_staff",
  "admin",
  "super_admin",
];

const qcItemSchema = z
  .object({
    grn_item_id: z.string().uuid(),
    raw_material_id: z.string().uuid().optional().nullable(),
    product_id: z.string().uuid().optional().nullable(),
    qty_inspected: z.number().min(0),
    qty_accepted: z.number().min(0),
    qty_rejected: z.number().min(0),
    catatan: z.string().optional().nullable(),
  })
  .superRefine((item, ctx) => {
    if (!item.raw_material_id && !item.product_id) {
      ctx.addIssue({
        code: "custom",
        message: "Item QC wajib memiliki raw material atau product",
        path: ["raw_material_id"],
      });
    }
  });

const createQcSchema = z.object({
  status: z.enum(["approved", "rejected", "partial"]).optional(),
  parameter_inspeksi: z.record(z.string(), z.unknown()).optional(),
  hasil_inspeksi: z.record(z.string(), z.string()).optional(),
  catatan: z.string().optional().nullable(),
  rekomendasi: z.string().optional().nullable(),
  items: z.array(qcItemSchema).min(1, "At least one item is required"),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireIamMenuPrefix(IAM.items);
    const db = createPgClient();
    const { id } = await params;

    const { data, error } = await db
      .from("grn_qc_inspections")
      .select(
        `
        *,
        inspector:inspector_id(id, name, email),
        items:grn_qc_inspection_items(
          id,
          grn_item_id,
          raw_material_id,
          qty_inspected,
          qty_accepted,
          qty_rejected,
          item_status,
          catatan,
          raw_material:raw_materials!raw_material_id(id, nama, kode)
        )
      `
      )
      .eq("grn_id", id)
      .maybeSingle();

    if (error) throw error;

    return successResponse(data, data ? "QC inspection retrieved" : "No QC inspection yet");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching GRN QC:", error);
    return ApiError.server("Failed to fetch QC inspection").toResponse();
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const db = createPgClient();
    const { id } = await params;

    const body = await request.json();
    const validated = createQcSchema.parse(body);

    const result = await submitGrnQcInspection(db, {
      grnId: id,
      status: validated.status || "approved",
      parameter_inspeksi: validated.parameter_inspeksi,
      hasil_inspeksi: validated.hasil_inspeksi,
      catatan: validated.catatan,
      rekomendasi: validated.rekomendasi,
      items: validated.items,
      userId: user.id,
    });

    const baseMessage = "Quality control completed and stock updated";
    return createdResponse(
      {
        grn_id: id,
        inspection_id: result.inspectionId,
        grn_status: result.grnStatus,
        totals: {
          accepted: result.totalAccepted,
          rejected: result.totalRejected,
        },
      },
      result.accountingNote ? `${baseMessage} (${result.accountingNote})` : baseMessage
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validation failed", error.issues).toResponse();
    }
    const message = error instanceof Error ? error.message : "Failed to submit QC inspection";
    if (message.includes("not found") || message.includes("awaiting")) {
      return ApiError.badRequest(message).toResponse();
    }
    if (message.includes("already been completed")) {
      return ApiError.badRequest(message).toResponse();
    }
    console.error("Error submitting GRN QC:", error);
    return ApiError.server(message).toResponse();
  }
}
