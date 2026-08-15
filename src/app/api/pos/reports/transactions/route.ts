import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import {
  parseReportDateRange,
  resolveReportStallFilter,
} from "@/lib/pos/report-stall-filter";
import { isRevenueOrder } from "@/lib/pos/revenue-order";

type TransactionRow = {
  id: string;
  order_number: string | null;
  ordered_at: string | null;
  status: string | null;
  payment_status: string | null;
  payment_method: string | null;
  total_amount: number | string | null;
  ark_coins_used: number | string | null;
  cashier_id: string | null;
  warehouse_id: string | null;
  stall_code: string | null;
  stall_name: string | null;
  checkout_id: string | null;
  checkout_number: string | null;
  sold_from: string | null;
  xendit_qr_id: string | null;
  xendit_external_id: string | null;
};

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const scope = await getApiUserScope();
    const searchParams = request.nextUrl.searchParams;
    const range = parseReportDateRange(
      searchParams.get("date_from"),
      searchParams.get("date_to")
    );
    const stallFilter = await resolveReportStallFilter(
      scope,
      searchParams.get("warehouse_id")
    );

    if (stallFilter.warehouseIds && stallFilter.warehouseIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          filters: {
            date_from: range.dateFrom,
            date_to: range.dateTo,
            warehouse_id: stallFilter.selectedWarehouseId,
          },
          stall_options: stallFilter.stallOptions,
          stall_locked: stallFilter.stallLocked,
          summary: {
            transactions: 0,
            total_sales: 0,
            total_ark_used: 0,
          },
          rows: [],
        },
      });
    }

    const rows = await query<TransactionRow>(
      `SELECT
         o.id,
         o.order_number,
         o.ordered_at,
         o.status,
         o.payment_status,
         o.payment_method,
         o.total_amount,
         o.ark_coins_used,
         o.cashier_id,
         COALESCE(o.warehouse_id, stall_from_item.warehouse_id) AS warehouse_id,
         COALESCE(w_order.code, stall_from_item.stall_code) AS stall_code,
         COALESCE(w_order.name, stall_from_item.stall_name) AS stall_name,
         o.checkout_id,
         o.sold_from,
         chk.checkout_number,
         COALESCE(o.xendit_qr_id, chk.xendit_qr_id) AS xendit_qr_id,
         COALESCE(o.xendit_external_id, chk.xendit_external_id) AS xendit_external_id
       FROM pos.pos_orders o
       LEFT JOIN pos.pos_checkouts chk ON chk.id = o.checkout_id
       LEFT JOIN configuration.warehouses w_order ON w_order.id = o.warehouse_id
       LEFT JOIN LATERAL (
         SELECT
           COALESCE(p.warehouse_id, p_sku.warehouse_id) AS warehouse_id,
           COALESCE(w.code, w_sku.code) AS stall_code,
           COALESCE(w.name, w_sku.name) AS stall_name
         FROM pos.pos_order_items i
         INNER JOIN pos.pos_products pp ON pp.id = i.product_id
         LEFT JOIN item.products p ON p.id = pp.source_product_id AND p.deleted_at IS NULL
         LEFT JOIN configuration.warehouses w ON w.id = p.warehouse_id
         LEFT JOIN item.products p_sku
           ON pp.source_product_id IS NULL
          AND pp.sku = ('PUR-' || p_sku.kode)
          AND p_sku.deleted_at IS NULL
          AND p_sku.kode IS NOT NULL
          AND btrim(p_sku.kode) <> ''
         LEFT JOIN configuration.warehouses w_sku ON w_sku.id = p_sku.warehouse_id
         WHERE i.order_id = o.id
         ORDER BY COALESCE(i.total_amount, 0) DESC, i.id
         LIMIT 1
       ) stall_from_item ON o.warehouse_id IS NULL
       WHERE o.ordered_at >= $1::timestamptz
         AND o.ordered_at <= $2::timestamptz
         AND o.status NOT IN ('cancelled', 'voided', 'merged')
         AND (o.payment_status = 'paid' OR o.status = 'completed')
         AND (
           $3::uuid[] IS NULL
           OR o.warehouse_id = ANY($3::uuid[])
           OR (
             o.warehouse_id IS NULL
             AND stall_from_item.warehouse_id = ANY($3::uuid[])
           )
         )
       ORDER BY o.ordered_at DESC NULLS LAST`,
      [range.startIso, range.endIso, stallFilter.warehouseIds]
    );

    const revenueRows = rows.filter(isRevenueOrder);
    const summary = revenueRows.reduce(
      (acc, row) => {
        acc.transactions += 1;
        acc.total_sales += toNumber(row.total_amount);
        acc.total_ark_used += toNumber(row.ark_coins_used);
        return acc;
      },
      { transactions: 0, total_sales: 0, total_ark_used: 0 }
    );

    return NextResponse.json({
      success: true,
      data: {
        filters: {
          date_from: range.dateFrom,
          date_to: range.dateTo,
          warehouse_id: stallFilter.selectedWarehouseId,
        },
        stall_options: stallFilter.stallOptions,
        stall_locked: stallFilter.stallLocked,
        summary: {
          transactions: summary.transactions,
          total_sales: Math.round(summary.total_sales * 100) / 100,
          total_ark_used: Math.round(summary.total_ark_used * 100) / 100,
        },
        rows: revenueRows.map((row) => ({
          id: row.id,
          order_number: row.order_number,
          ordered_at: row.ordered_at,
          status: row.status,
          payment_status: row.payment_status,
          payment_method: row.payment_method,
          total_amount: toNumber(row.total_amount),
          ark_coins_used: toNumber(row.ark_coins_used),
          cashier_id: row.cashier_id,
          warehouse_id: row.warehouse_id,
          stall_code: row.stall_code,
          stall_name: row.stall_name,
          checkout_id: row.checkout_id,
          checkout_number: row.checkout_number,
          sold_from: row.sold_from,
          xendit_qr_id: row.xendit_qr_id,
          xendit_external_id: row.xendit_external_id,
        })),
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching POS transaction report:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
