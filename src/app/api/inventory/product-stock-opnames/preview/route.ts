import { NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope, validateProductWarehouseScope } from "@/lib/api/scope";
import { listProductInventoryForOpname } from "@/lib/inventory/product-stock-opname";
import { z } from "zod";

const OPNAME_ROLES = ["super_admin", "warehouse_admin", "purchasing_admin"] as const;

const previewSchema = z.object({
  warehouse_id: z.string().uuid("Stall wajib dipilih"),
});

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.itemsInventory);
    const scope = await getApiUserScope();
    const params = previewSchema.parse(
      Object.fromEntries(new URL(request.url).searchParams)
    );

    const warehouseScope = await validateProductWarehouseScope(params.warehouse_id, scope);
    if ("error" in warehouseScope) {
      return Response.json({ success: false, message: warehouseScope.error }, { status: 400 });
    }

    const lines = await listProductInventoryForOpname(scope, params.warehouse_id);

    return Response.json({
      success: true,
      data: lines,
      total: lines.length,
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return Response.json(
        { success: false, message: "Validasi gagal", errors: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    console.error("GET product-stock-opnames/preview:", error);
    return Response.json(
      { success: false, message: "Gagal memuat preview item opname produk" },
      { status: 500 }
    );
  }
}
