import { NextRequest } from "next/server";
import { z } from "zod";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, paginatedResponse, requireApiRole } from "@/lib/api/auth";
import {
  effectiveBranchId,
  getApiUserScope,
  isRowInBusinessScope,
  validateWarehouseForReceivingScope,
} from "@/lib/api/scope";
import {
  executeStockTransfer,
  listStockTransfers,
  type StockTransferKind,
} from "@/lib/inventory/stock-transfer";

const TRANSFER_ROLES = [
  "super_admin",
  "warehouse_admin",
  "warehouse_staff",
  "purchasing_admin",
  "purchasing_staff",
] as const;

const transferSchema = z.object({
  transfer_kind: z.enum(["main_to_stall", "stall_to_stall", "stall_to_main"]),
  source_warehouse_id: z.string().uuid("Source stall is required"),
  dest_warehouse_id: z.string().uuid("Destination stall is required"),
  raw_material_id: z.string().uuid("Raw material is required"),
  qty: z.number().positive("Quantity must be greater than zero"),
  notes: z.string().optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export async function GET(request: NextRequest) {
  try {
    await requireApiRole([...TRANSFER_ROLES]);
    const scope = await getApiUserScope();
    const branchId = effectiveBranchId(scope);

    const { searchParams } = new URL(request.url);
    const params = listQuerySchema.parse(Object.fromEntries(searchParams));

    const { rows, total } = await listStockTransfers({
      branchId,
      page: params.page,
      limit: params.limit,
    });

    return paginatedResponse(rows, {
      page: params.page,
      limit: params.limit,
      total,
      total_pages: Math.ceil(total / params.limit),
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Invalid query params", error.issues).toResponse();
    }
    console.error("Error fetching stock transfers:", error);
    return ApiError.server("Failed to fetch stock transfers").toResponse();
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiRole([...TRANSFER_ROLES]);
    const db = await createServerPgClient();
    const body = await request.json();
    const validated = transferSchema.parse(body);
    const scope = await getApiUserScope();

    const sourceCheck = await validateWarehouseForReceivingScope(
      validated.source_warehouse_id,
      scope,
      null
    );
    if ("error" in sourceCheck) {
      return Response.json(
        { success: false, message: "Source stall is invalid or not allowed" },
        { status: 400 }
      );
    }

    const destCheck = await validateWarehouseForReceivingScope(
      validated.dest_warehouse_id,
      scope,
      null
    );
    if ("error" in destCheck) {
      return Response.json(
        { success: false, message: "Destination stall is invalid or not allowed" },
        { status: 400 }
      );
    }

    const { data: material } = await db
      .from("raw_materials")
      .select("company_id, branch_id")
      .eq("id", validated.raw_material_id)
      .maybeSingle();

    if (
      material &&
      !isRowInBusinessScope(scope, {
        company_id: material.company_id,
        branch_id: material.branch_id,
      })
    ) {
      return Response.json(
        { success: false, message: "Raw material is not available for your branch" },
        { status: 403 }
      );
    }

    const result = await executeStockTransfer(db, {
      rawMaterialId: validated.raw_material_id,
      sourceWarehouseId: validated.source_warehouse_id,
      destWarehouseId: validated.dest_warehouse_id,
      kind: validated.transfer_kind as StockTransferKind,
      qty: validated.qty,
      notes: validated.notes,
      userId: user.id,
    });

    return Response.json({
      success: true,
      message: `Stock transferred successfully (${result.transfer_number})`,
      data: result,
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
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

    const message = error instanceof Error ? error.message : "Failed to transfer stock";
    console.error("Error transferring stock:", error);

    if (
      message.includes("Insufficient stock") ||
      message.includes("must be") ||
      message.includes("not available") ||
      message.includes("not found")
    ) {
      return Response.json({ success: false, message }, { status: 400 });
    }

    return Response.json({ success: false, message: "Failed to transfer stock" }, { status: 500 });
  }
}
