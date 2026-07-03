import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import {
  getApiUserScope,
  validateWarehouseForReceivingScope,
} from "@/lib/api/scope";
import { listWarehouseInventoryForOpname } from "@/lib/inventory/stock-opname";

const OPNAME_ROLES = ["super_admin", "warehouse_admin", "purchasing_admin"] as const;

const querySchema = z.object({
  warehouse_id: z.string().uuid("Gudang wajib dipilih"),
});

export async function GET(request: NextRequest) {
  try {
    await requireApiRole([...OPNAME_ROLES]);
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
        { success: false, message: "Gudang tidak valid atau tidak diizinkan" },
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
    console.error("GET stock-opnames/preview:", error);
    if (error instanceof z.ZodError) {
      return Response.json(
        { success: false, message: "Validasi gagal", errors: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    return Response.json(
      { success: false, message: "Gagal memuat preview item opname" },
      { status: 500 }
    );
  }
}
