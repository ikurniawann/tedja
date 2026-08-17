import { NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { withTransaction } from "@/lib/db";
import { insertFinishedGoodsMovementSql } from "@/lib/inventory/finished-goods-movements";
import { fetchProductStockOpnameDetail } from "@/lib/inventory/product-stock-opname";

const OPNAME_ROLES = ["super_admin", "warehouse_admin", "purchasing_admin"] as const;

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireIamMenuPrefix(IAM.itemsInventory);
    const { id } = await context.params;
    const detail = await fetchProductStockOpnameDetail(id);

    if (!detail) {
      return Response.json(
        { success: false, message: "Stock opname produk tidak ditemukan" },
        { status: 404 }
      );
    }

    if (detail.status === "completed") {
      return Response.json(
        { success: false, message: "Stock opname sudah diselesaikan sebelumnya" },
        { status: 400 }
      );
    }

    if (detail.status === "cancelled") {
      return Response.json(
        { success: false, message: "Stock opname yang dibatalkan tidak dapat diselesaikan" },
        { status: 400 }
      );
    }

    const uncounted = detail.lines.filter(
      (line) => line.qty_counted === null || line.qty_counted === undefined
    );
    if (uncounted.length > 0) {
      return Response.json(
        {
          success: false,
          message: `Masih ada ${uncounted.length} baris yang belum dihitung`,
        },
        { status: 400 }
      );
    }

    await withTransaction(async (client) => {
      for (const line of detail.lines) {
        const qtyBefore = line.qty_system;
        const qtyAfter = toNumber(line.qty_counted);
        const qtyDiff = qtyAfter - qtyBefore;

        if (qtyDiff === 0) continue;

        const invRes = await client.query<{
          id: string;
          unit_cost: number | string | null;
        }>(
          `SELECT id, unit_cost
           FROM inventory.finished_goods_inventory
           WHERE id = $1
           FOR UPDATE`,
          [line.inventory_id]
        );

        const inv = invRes.rows[0];
        if (!inv) {
          throw new Error(`Stok produk ${line.inventory_id} tidak ditemukan`);
        }

        await client.query(
          `UPDATE inventory.finished_goods_inventory
           SET qty_available = $1,
               last_movement_at = now(),
               updated_at = now(),
               updated_by = $2
           WHERE id = $3`,
          [qtyAfter, user.id, line.inventory_id]
        );

        await insertFinishedGoodsMovementSql(client, {
          inventoryId: line.inventory_id,
          productId: line.product_id,
          warehouseId: detail.warehouse_id,
          tipe: "adjustment",
          qtyBefore,
          qtyAfter,
          unitCost: toNumber(inv.unit_cost),
          referenceType: "product_stock_opname",
          referenceId: detail.id,
          referenceNumber: detail.opname_number ?? detail.id,
          alasan: "Stock opname completed",
          userId: user.id,
        });
      }

      await client.query(
        `UPDATE inventory.product_stock_opnames
         SET status = 'completed',
             completed_at = now(),
             lines_counted = $2,
             lines_with_variance = $3,
             updated_by = $4,
             updated_at = now()
         WHERE id = $1`,
        [
          detail.id,
          detail.lines.length,
          detail.lines.filter((l) => toNumber(l.qty_variance) !== 0).length,
          user.id,
        ]
      );
    });

    const updated = await fetchProductStockOpnameDetail(id);
    return Response.json({
      success: true,
      data: updated,
      message: "Stock opname produk selesai dan stok telah disesuaikan",
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("POST complete product-stock-opname:", error);
    const message =
      error instanceof Error ? error.message : "Gagal menyelesaikan stock opname produk";
    return Response.json({ success: false, message }, { status: 500 });
  }
}
