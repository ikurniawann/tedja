import { NextRequest } from "next/server";
import { z } from "zod";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { adjustProductStock } from "@/lib/inventory/product-adjustment";

const ADJUST_ROLES = ["super_admin", "warehouse_admin", "purchasing_admin"] as const;

const adjustmentSchema = z.object({
  product_id: z.string().uuid("Produk wajib dipilih"),
  qty_actual: z.number().min(0, "Stok aktual minimal 0"),
  notes: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiRole([...ADJUST_ROLES]);
    const scope = await getApiUserScope();
    const body = await request.json();
    const validated = adjustmentSchema.parse(body);

    const db = await createServerPgClient();
    const result = await adjustProductStock({
      db,
      scope,
      userId: user.id,
      productId: validated.product_id,
      qtyActual: validated.qty_actual,
      notes: validated.notes,
    });

    if ("error" in result) {
      if (result.error === "not_found") {
        return Response.json(
          { success: false, message: "Produk tidak ditemukan" },
          { status: 404 }
        );
      }
      if (result.error === "forbidden") {
        return Response.json(
          { success: false, message: "Produk tidak tersedia untuk scope Anda" },
          { status: 403 }
        );
      }
      return Response.json(
        { success: false, message: "Data stok produk tidak ditemukan" },
        { status: 404 }
      );
    }

    return Response.json({
      success: true,
      data: result.data,
      adjustment: result.adjustment,
      message:
        result.adjustment.qty_diff === 0
          ? "Stok tidak berubah"
          : "Stok produk berhasil disesuaikan",
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("POST finished-goods/adjustment:", error);
    if (error instanceof z.ZodError) {
      return Response.json(
        { success: false, message: "Validasi gagal", errors: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    return Response.json(
      { success: false, message: "Gagal menyesuaikan stok produk" },
      { status: 500 }
    );
  }
}
