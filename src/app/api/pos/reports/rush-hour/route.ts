import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import {
  parseReportDateRange,
  resolveReportStallFilter,
} from "@/lib/pos/report-stall-filter";
import { buildRushHourReport } from "@/lib/pos/rush-hour";

type HourRow = {
  hour: number | string;
  dow: number | string;
  transactions: number | string;
  revenue: number | string;
  quantity: number | string;
};

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

    const empty = buildRushHourReport([]);
    const meta = {
      filters: {
        date_from: range.dateFrom,
        date_to: range.dateTo,
        warehouse_id: stallFilter.selectedWarehouseId,
      },
      stall_options: stallFilter.stallOptions,
      stall_locked: stallFilter.stallLocked,
    };

    if (stallFilter.warehouseIds && stallFilter.warehouseIds.length === 0) {
      return NextResponse.json({ success: true, data: { ...meta, ...empty } });
    }

    const rows = await query<HourRow>(
      `SELECT
         EXTRACT(HOUR FROM o.ordered_at AT TIME ZONE 'Asia/Jakarta')::int AS hour,
         EXTRACT(ISODOW FROM o.ordered_at AT TIME ZONE 'Asia/Jakarta')::int AS dow,
         COUNT(*)::int AS transactions,
         COALESCE(SUM(o.total_amount), 0)::float8 AS revenue,
         COALESCE(SUM(oi.qty), 0)::float8 AS quantity
       FROM pos.pos_orders o
       LEFT JOIN (
         SELECT order_id, SUM(quantity) AS qty
         FROM pos.pos_order_items
         GROUP BY order_id
       ) oi ON oi.order_id = o.id
       WHERE o.ordered_at >= $1::timestamptz
         AND o.ordered_at <= $2::timestamptz
         AND o.status NOT IN ('cancelled', 'voided', 'merged')
         AND (o.payment_status = 'paid' OR o.status = 'completed')
         AND ($3::uuid[] IS NULL OR o.warehouse_id = ANY($3::uuid[]))
       GROUP BY 1, 2`,
      [range.startIso, range.endIso, stallFilter.warehouseIds]
    );

    const report = buildRushHourReport(
      rows.map((row) => ({
        hour: toNumber(row.hour),
        dow: toNumber(row.dow),
        transactions: toNumber(row.transactions),
        revenue: toNumber(row.revenue),
        quantity: toNumber(row.quantity),
      }))
    );

    return NextResponse.json({ success: true, data: { ...meta, ...report } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memuat laporan rush hour";
    const known = /tanggal|stall/i.test(message);
    console.error("[pos] rush-hour report:", error);
    return NextResponse.json(
      { success: false, error: known ? message : "Gagal memuat laporan rush hour" },
      { status: known ? 400 : 500 }
    );
  }
}
