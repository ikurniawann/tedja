import { NextRequest } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { withTransaction } from "@/lib/db";
import { insertFinishedGoodsMovementSql } from "@/lib/inventory/finished-goods-movements";
import {
  fetchProductStockOpnameDetail,
  isOpnameInScope,
  summarizeOpnameSkuDeltas,
  type OpnameCompleteLineInput,
} from "@/lib/inventory/product-stock-opname";

const OPNAME_ROLES = ["super_admin", "warehouse_admin", "purchasing_admin"] as const;

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireIamMenuPrefix(IAM.itemsInventory);
    const scope = await getApiUserScope();
    const { id } = await context.params;
    const detail = await fetchProductStockOpnameDetail(id);

    if (!detail || !isOpnameInScope(scope, detail)) {
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
      const lineById = new Map(detail.lines.map((line) => [line.id, line]));
      // Semua baris SKU milik produk yang sama berbagi SATU baris
      // finished_goods_inventory (ensureProductInventoryId) — jadi peta ini
      // konsisten dipetakan dari baris manapun milik produk tersebut.
      const inventoryIdByProduct = new Map(
        detail.lines.map((line) => [line.product_id, line.inventory_id])
      );

      // EPIC-047 Fase 3 — kunci & baca stok LIVE tiap SKU (FOR UPDATE) lebih
      // dulu; ini "qty_before" yang dipakai summarizeOpnameSkuDeltas (murni),
      // BUKAN qty_system hasil snapshot saat opname dibuat.
      const skuBeforeById = new Map<string, number>();
      for (const line of detail.lines) {
        if (!line.pos_sku_id) continue;
        const skuRes = await client.query<{ stock_quantity: number | string }>(
          `SELECT stock_quantity
           FROM pos.pos_product_skus
           WHERE id = $1
           FOR UPDATE`,
          [line.pos_sku_id]
        );
        const sku = skuRes.rows[0];
        if (!sku) {
          throw new Error(`SKU ${line.pos_sku_id} tidak ditemukan`);
        }
        skuBeforeById.set(line.id, toNumber(sku.stock_quantity));
      }

      const lineInputs: OpnameCompleteLineInput[] = detail.lines.map((line) => ({
        id: line.id,
        product_id: line.product_id,
        pos_sku_id: line.pos_sku_id ?? null,
        qty_before: line.pos_sku_id ? skuBeforeById.get(line.id)! : line.qty_system,
        qty_counted: toNumber(line.qty_counted),
      }));

      let summary;
      try {
        summary = summarizeOpnameSkuDeltas(lineInputs);
      } catch (err) {
        throw ApiError.badRequest(
          err instanceof Error ? err.message : "Baris opname tidak valid"
        );
      }

      // Baris ber-SKU: stock_quantity SKU diset absolut ke hasil hitung +
      // satu movement per SKU ber-selisih (zero-delta di-skip;
      // insertFinishedGoodsMovementSql juga no-op sendiri untuk qtyBefore ===
      // qtyAfter, jaga-jaga).
      for (const skuLine of summary.skuLines) {
        if (skuLine.delta === 0) continue;
        const detailLine = lineById.get(skuLine.id)!;

        await client.query(
          `UPDATE pos.pos_product_skus
           SET stock_quantity = $1,
               updated_at = now()
           WHERE id = $2`,
          [skuLine.qty_after, skuLine.pos_sku_id]
        );

        await insertFinishedGoodsMovementSql(client, {
          inventoryId: detailLine.inventory_id,
          productId: skuLine.product_id,
          warehouseId: detail.warehouse_id,
          tipe: "adjustment",
          qtyBefore: skuLine.qty_before,
          qtyAfter: skuLine.qty_after,
          unitCost: toNumber(detailLine.unit_cost),
          referenceType: "product_stock_opname",
          referenceId: detail.id,
          referenceNumber: detail.opname_number ?? detail.id,
          alasan: "Stock opname completed",
          catatan: "opname per varian",
          posSkuId: skuLine.pos_sku_id,
          userId: user.id,
        });
      }

      // Produk ber-varian: finished_goods_inventory (level produk) disesuaikan
      // sebesar Σ selisih SKU-nya, TETAP total (bukan per-SKU). Produk dengan
      // Σ selisih = 0 sudah di-skip oleh summarizeOpnameSkuDeltas.
      for (const productDelta of summary.productDeltas) {
        const inventoryId = inventoryIdByProduct.get(productDelta.product_id)!;
        const invRes = await client.query<{
          id: string;
          qty_available: number | string | null;
          unit_cost: number | string | null;
        }>(
          `SELECT id, qty_available, unit_cost
           FROM inventory.finished_goods_inventory
           WHERE id = $1
           FOR UPDATE`,
          [inventoryId]
        );
        const inv = invRes.rows[0];
        if (!inv) {
          throw new Error(`Stok produk ${inventoryId} tidak ditemukan`);
        }

        const qtyBefore = toNumber(inv.qty_available);
        const qtyAfter = qtyBefore + productDelta.delta;

        await client.query(
          `UPDATE inventory.finished_goods_inventory
           SET qty_available = $1,
               last_movement_at = now(),
               updated_at = now(),
               updated_by = $2
           WHERE id = $3`,
          [qtyAfter, user.id, inv.id]
        );

        await insertFinishedGoodsMovementSql(client, {
          inventoryId: inv.id,
          productId: productDelta.product_id,
          warehouseId: detail.warehouse_id,
          tipe: "adjustment",
          qtyBefore,
          qtyAfter,
          unitCost: toNumber(inv.unit_cost),
          referenceType: "product_stock_opname",
          referenceId: detail.id,
          referenceNumber: detail.opname_number ?? detail.id,
          alasan: "Stock opname completed (Σ varian)",
          userId: user.id,
        });
      }

      // Baris TANPA pos_sku_id — jalur lama, byte-identical.
      for (const line of detail.lines) {
        if (line.pos_sku_id) continue;

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

      // LOW hardening: guard di kolom `status` (bukan hanya cek awal di luar
      // transaksi) supaya dua request complete yang konkuren tidak
      // sama-sama lolos race dan memposting movement dua kali. 0 baris
      // ter-UPDATE (sudah completed duluan) → rollback + 400, pesan sama
      // dengan cek awal.
      const completeResult = await client.query(
        `UPDATE inventory.product_stock_opnames
         SET status = 'completed',
             completed_at = now(),
             lines_counted = $2,
             lines_with_variance = $3,
             updated_by = $4,
             updated_at = now()
         WHERE id = $1 AND status <> 'completed'`,
        [
          detail.id,
          detail.lines.length,
          detail.lines.filter((l) => toNumber(l.qty_variance) !== 0).length,
          user.id,
        ]
      );

      if (completeResult.rowCount === 0) {
        throw ApiError.badRequest("Stock opname sudah diselesaikan sebelumnya");
      }
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
