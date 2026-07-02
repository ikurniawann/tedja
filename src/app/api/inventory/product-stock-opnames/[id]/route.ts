import { NextRequest } from "next/server";
import { z } from "zod";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { fetchProductStockOpnameDetail } from "@/lib/inventory/product-stock-opname";

const OPNAME_ROLES = ["super_admin", "warehouse_admin", "purchasing_admin"] as const;

const lineSchema = z.object({
  id: z.string().uuid(),
  qty_counted: z.number().min(0).nullable(),
  notes: z.string().optional(),
});

const patchSchema = z.object({
  notes: z.string().optional(),
  status: z.enum(["cancelled"]).optional(),
  lines: z.array(lineSchema).optional(),
});

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireApiRole([...OPNAME_ROLES]);
    const { id } = await context.params;
    const detail = await fetchProductStockOpnameDetail(id);

    if (!detail) {
      return Response.json(
        { success: false, message: "Stock opname produk tidak ditemukan" },
        { status: 404 }
      );
    }

    return Response.json({ success: true, data: detail });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("GET product-stock-opname detail:", error);
    return Response.json(
      { success: false, message: "Gagal mengambil detail stock opname produk" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireApiRole([...OPNAME_ROLES]);
    const { id } = await context.params;
    const body = await request.json();
    const validated = patchSchema.parse(body);

    const detail = await fetchProductStockOpnameDetail(id);
    if (!detail) {
      return Response.json(
        { success: false, message: "Stock opname produk tidak ditemukan" },
        { status: 404 }
      );
    }

    if (detail.status === "completed") {
      return Response.json(
        { success: false, message: "Stock opname yang sudah selesai tidak dapat diubah" },
        { status: 400 }
      );
    }

    if (detail.status === "cancelled") {
      return Response.json(
        { success: false, message: "Stock opname yang dibatalkan tidak dapat diubah" },
        { status: 400 }
      );
    }

    const db = await createServerPgClient();

    if (validated.status === "cancelled") {
      await db
        .from("product_stock_opnames")
        .update({
          status: "cancelled",
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      const updated = await fetchProductStockOpnameDetail(id);
      return Response.json({
        success: true,
        data: updated,
        message: "Stock opname produk dibatalkan",
      });
    }

    if (validated.lines?.length) {
      for (const line of validated.lines) {
        const existing = detail.lines.find((l) => l.id === line.id);
        if (!existing) continue;

        const qtyCounted =
          line.qty_counted === null ? null : toNumber(line.qty_counted);
        const qtyVariance =
          qtyCounted === null ? null : qtyCounted - existing.qty_system;

        await db
          .from("product_stock_opname_lines")
          .update({
            qty_counted: qtyCounted,
            qty_variance: qtyVariance,
            notes: line.notes ?? existing.notes,
            updated_at: new Date().toISOString(),
          })
          .eq("id", line.id);
      }
    }

    const refreshed = await fetchProductStockOpnameDetail(id);
    if (!refreshed) {
      return Response.json(
        { success: false, message: "Stock opname produk tidak ditemukan" },
        { status: 404 }
      );
    }

    const linesCounted = refreshed.lines.filter(
      (line) => line.qty_counted !== null && line.qty_counted !== undefined
    ).length;
    const linesWithVariance = refreshed.lines.filter(
      (line) =>
        line.qty_variance !== null &&
        line.qty_variance !== undefined &&
        line.qty_variance !== 0
    ).length;

    const nextStatus =
      refreshed.status === "draft" && linesCounted > 0
        ? "in_progress"
        : refreshed.status;

    await db
      .from("product_stock_opnames")
      .update({
        notes: validated.notes ?? refreshed.notes,
        status: nextStatus,
        lines_counted: linesCounted,
        lines_with_variance: linesWithVariance,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    const updated = await fetchProductStockOpnameDetail(id);
    return Response.json({
      success: true,
      data: updated,
      message: "Perubahan stock opname produk disimpan",
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("PATCH product-stock-opname:", error);
    if (error instanceof z.ZodError) {
      return Response.json(
        { success: false, message: "Validasi gagal", errors: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    return Response.json(
      { success: false, message: "Gagal memperbarui stock opname produk" },
      { status: 500 }
    );
  }
}
