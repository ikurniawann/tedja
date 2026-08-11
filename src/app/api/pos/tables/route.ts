import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { generateTableQrCode } from "@/features/pos/tables/qr-code";
import { resolveTableBoardStatus } from "@/features/pos/restaurant/table-board-status";

type TableRow = {
  id: string;
  table_number?: string | null;
  name?: string | null;
  floor?: string | null;
  area?: string | null;
  capacity?: number | string | null;
  status?: string | null;
  qr_code?: string | null;
  notes?: string | null;
  is_active?: boolean | null;
  pos_x?: number | string | null;
  pos_y?: number | string | null;
};

type ActiveOrderRow = {
  id: string;
  order_number?: string | null;
  table_id?: string | null;
  status?: string | null;
  payment_status?: string | null;
  total_amount?: number | string | null;
  pre_settled_at?: string | null;
};

const TABLE_STATUSES = ["available", "occupied", "reserved", "maintenance"] as const;
const SELECT_COLS =
  "id, table_number, name, floor, area, capacity, status, qr_code, notes, is_active, pos_x, pos_y";

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeTable(
  table: TableRow,
  activeOrder?: ActiveOrderRow | null
) {
  const tableNumber = String(table.table_number || "").trim()
    || String(table.qr_code || "").trim()
    || String(table.name || "").trim()
    || "Meja";
  const orderPayload = activeOrder
    ? {
        id: activeOrder.id,
        order_number: activeOrder.order_number,
        status: activeOrder.status,
        payment_status: activeOrder.payment_status,
        total_amount: toNumber(activeOrder.total_amount),
        pre_settled_at: activeOrder.pre_settled_at ?? null,
      }
    : null;

  return {
    id: table.id,
    table_number: tableNumber,
    name: table.name || tableNumber,
    label: table.name || tableNumber,
    floor: table.floor || null,
    area: table.area || null,
    capacity: toNumber(table.capacity) || 4,
    status: resolveTableBoardStatus({
      tableStatus: table.status || "available",
      activeOrder: orderPayload,
    }),
    qr_code: table.qr_code || null,
    notes: table.notes || null,
    is_active: table.is_active !== false,
    pos_x: table.pos_x == null ? null : Number(table.pos_x),
    pos_y: table.pos_y == null ? null : Number(table.pos_y),
    active_order: orderPayload,
  };
}

function parsePayload(body: Record<string, unknown>, { autoQr }: { autoQr: boolean }) {
  const table_number = String(body.table_number ?? "").trim();
  const name = body.name != null ? String(body.name).trim() || null : null;
  const floor = body.floor != null ? String(body.floor).trim() || null : null;
  const area = body.area != null ? String(body.area).trim() || null : null;
  let qr_code = body.qr_code != null ? String(body.qr_code).trim() || null : null;
  const notes = body.notes != null ? String(body.notes).trim() || null : null;
  const capacity = Math.max(1, Math.floor(toNumber(body.capacity) || 4));
  const is_active = body.is_active !== false;
  const statusRaw = String(body.status ?? "available");
  const status = TABLE_STATUSES.includes(statusRaw as (typeof TABLE_STATUSES)[number])
    ? statusRaw
    : "available";

  if (!table_number) {
    return { error: "Table number is required" as const };
  }

  if (!qr_code && autoQr) {
    qr_code = generateTableQrCode(table_number);
  }

  return {
    data: {
      table_number,
      name,
      floor,
      area,
      qr_code,
      notes,
      capacity,
      is_active,
      status,
    },
  };
}

export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const db = createPgClient();
    const includeInactive =
      request.nextUrl.searchParams.get("include_inactive") === "true";

    let tableQuery = db
      .from("pos_tables")
      .select(SELECT_COLS)
      .order("table_number");

    if (!includeInactive) tableQuery = tableQuery.eq("is_active", true);

    const { data: tables, error: tableError } = await tableQuery;
    if (tableError) throw tableError;

    const { data: activeOrders, error: orderError } = await db
      .from("pos_orders")
      .select(
        "id, order_number, table_id, status, payment_status, total_amount, pre_settled_at"
      )
      .not("table_id", "is", null)
      .in("status", ["pending", "confirmed", "preparing", "ready", "served"])
      .neq("payment_status", "paid");

    if (orderError) throw orderError;

    const activeOrderByTable = new Map<string, ActiveOrderRow>();
    for (const order of (activeOrders ?? []) as ActiveOrderRow[]) {
      if (!order.table_id) continue;
      const existing = activeOrderByTable.get(order.table_id);
      // Prefer a non-pre-settled order when both exist (added food after billing).
      if (
        existing?.pre_settled_at &&
        !order.pre_settled_at
      ) {
        activeOrderByTable.set(order.table_id, order);
        continue;
      }
      if (!existing) {
        activeOrderByTable.set(order.table_id, order);
      }
    }

    const normalizedTables = ((tables ?? []) as TableRow[]).map((table) =>
      normalizeTable(table, activeOrderByTable.get(table.id) ?? null)
    );

    return NextResponse.json({
      success: true,
      data: normalizedTables,
    });
  } catch (error) {
    console.error("POS tables error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to load POS tables",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const parsed = parsePayload(body, { autoQr: true });
    if ("error" in parsed) {
      return NextResponse.json(
        { success: false, error: parsed.error },
        { status: 400 }
      );
    }

    const db = createPgClient();
    const { data, error } = await db
      .from("pos_tables")
      .insert({
        ...parsed.data,
        // New tables should not start as occupied/reserved from master form.
        status:
          parsed.data.status === "occupied" ? "available" : parsed.data.status,
        current_order_id: null,
      })
      .select(SELECT_COLS)
      .single();

    if (error) {
      if (/unique|duplicate/i.test(error.message)) {
        return NextResponse.json(
          {
            success: false,
            error: "Table number or QR code already exists",
          },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: "Table created",
      data: normalizeTable(data as TableRow),
    });
  } catch (error) {
    console.error("POS tables create error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to create table",
      },
      { status: 500 }
    );
  }
}
