import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import {
  getApiUserScope,
  validateWarehouseForReceivingScope,
} from "@/lib/api/scope";
import { listWarehouseInventoryForOpname } from "@/lib/inventory/stock-opname";

const TRANSFER_ROLES = [
  "super_admin",
  "warehouse_admin",
  "warehouse_staff",
  "purchasing_admin",
  "purchasing_staff",
] as const;

const querySchema = z.object({
  warehouse_id: z.string().uuid("Source stall is required"),
});

export async function GET(request: NextRequest) {
  try {
    await requireApiRole([...TRANSFER_ROLES]);
    const scope = await getApiUserScope();
    const params = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams)
    );

    const warehouseCheck = await validateWarehouseForReceivingScope(
      params.warehouse_id,
      scope,
      null
    );
    if ("error" in warehouseCheck) {
      return Response.json(
        { success: false, message: "Source stall is invalid or not allowed" },
        { status: 400 }
      );
    }

    const lines = await listWarehouseInventoryForOpname(params.warehouse_id);

    return Response.json({
      success: true,
      data: lines,
      total: lines.length,
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Invalid query params", error.issues).toResponse();
    }
    console.error("GET transfer/preview:", error);
    return ApiError.server("Failed to load source stock").toResponse();
  }
}
