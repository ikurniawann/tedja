// EPIC-026 C2 — Penyesuaian stok barang operasional ke nilai aktual.
// POST /api/purchasing/inventory/supply-adjustment
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  getApiUserScope,
  effectiveCompanyId,
  effectiveBranchId,
} from "@/lib/api/scope";
import { adjustSupplyStock } from "@/lib/purchasing/supply-inventory";

const ADJUST_ROLES = ["super_admin", "warehouse_admin", "purchasing_admin", "purchasing_manager"] as const;

const adjustmentSchema = z.object({
  supply_item_id: z.string().uuid("Barang wajib dipilih"),
  warehouse_id: z.string().uuid("Gudang wajib dipilih"),
  qty_actual: z.number().min(0, "Stok aktual minimal 0"),
  notes: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const validated = adjustmentSchema.parse(await request.json());

    const result = await adjustSupplyStock(db, {
      supplyItemId: validated.supply_item_id,
      warehouseId: validated.warehouse_id,
      qtyActual: validated.qty_actual,
      alasan: validated.notes || null,
      companyId: effectiveCompanyId(scope),
      branchId: effectiveBranchId(scope),
      userId: user.id,
    });

    return NextResponse.json({
      success: true,
      data: result,
      message: "Stok berhasil disesuaikan",
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, message: "Validasi gagal", errors: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    console.error("Error adjusting supply stock:", error);
    return NextResponse.json(
      { success: false, message: "Gagal menyesuaikan stok" },
      { status: 500 }
    );
  }
}
