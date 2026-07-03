import { NextRequest } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { listProductInventoryForOpname } from "@/lib/inventory/product-stock-opname";

const OPNAME_ROLES = ["super_admin", "warehouse_admin", "purchasing_admin"] as const;

export async function GET(_request: NextRequest) {
  try {
    await requireApiRole([...OPNAME_ROLES]);
    const scope = await getApiUserScope();
    const lines = await listProductInventoryForOpname(scope);

    return Response.json({
      success: true,
      data: lines,
      total: lines.length,
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("GET product-stock-opnames/preview:", error);
    return Response.json(
      { success: false, message: "Gagal memuat preview item opname produk" },
      { status: 500 }
    );
  }
}
