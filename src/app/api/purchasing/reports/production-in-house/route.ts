import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole, ApiError, successResponse } from "@/lib/api/auth";
import { formatRupiah } from "@/lib/purchasing/utils";
import { PRODUCTION_API_ROLES } from "@/lib/manufacturing/constants";

// GET /api/purchasing/reports/production-in-house

const querySchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  date_field: z.enum(["completed_at", "created_at"]).default("completed_at"),
  status: z.string().optional(),
  output_type: z.enum(["all", "FINISHED_GOOD", "WIP"]).default("all"),
  product_id: z.string().uuid().optional(),
  warehouse_id: z.string().uuid().optional(),
  export: z.enum(["json", "csv"]).default("json"),
});

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function startOfDay(date: string) {
  return `${date}T00:00:00.000Z`;
}

function endOfDay(date: string) {
  return `${date}T23:59:59.999Z`;
}

export async function GET(request: NextRequest) {
  try {
    await requireApiRole([...PRODUCTION_API_ROLES]);
    const db = await createServerPgClient();

    const { searchParams } = new URL(request.url);
    const params = querySchema.parse(Object.fromEntries(searchParams));
    const {
      date_from,
      date_to,
      date_field,
      status,
      output_type,
      product_id,
      warehouse_id,
      export: exportFormat,
    } = params;

    let warehouseProductIds: string[] | null = null;
    if (warehouse_id) {
      const { data: products, error: productError } = await db
        .from("products")
        .select("id")
        .eq("warehouse_id", warehouse_id)
        .eq("is_active", true);
      if (productError) throw productError;
      warehouseProductIds = (products || []).map((p: { id: string }) => p.id);
      if (warehouseProductIds.length === 0) {
        return successResponse({
          orders: [],
          by_status: [],
          summary: {
            total_orders: 0,
            total_planned_qty: 0,
            total_actual_qty: 0,
            total_hpp_value: 0,
            completed_orders: 0,
          },
        });
      }
    }

    let query = db
      .from("v_production_orders")
      .select("*")
      .eq("production_context", "product")
      .order(date_field, { ascending: false, nullsFirst: false });

    if (date_from) query = query.gte(date_field, startOfDay(date_from));
    if (date_to) query = query.lte(date_field, endOfDay(date_to));
    if (status && status !== "all") query = query.eq("status", status.toUpperCase());
    if (output_type !== "all") query = query.eq("output_type", output_type);
    if (product_id) query = query.eq("product_id", product_id);
    if (warehouseProductIds) query = query.in("product_id", warehouseProductIds);

    const { data: rows, error } = await query;
    if (error) throw error;

    const productIds = Array.from(
      new Set(
        (rows || [])
          .map((row: { product_id?: string | null }) => row.product_id)
          .filter(Boolean) as string[]
      )
    );

    const warehouseByProduct = new Map<
      string,
      { warehouse_id: string | null; warehouse_name: string | null; warehouse_code: string | null }
    >();

    if (productIds.length > 0) {
      const { data: products, error: productsError } = await db
        .from("products")
        .select("id, warehouse_id")
        .in("id", productIds);
      if (productsError) throw productsError;

      const warehouseIds = Array.from(
        new Set(
          (products || [])
            .map((p: { warehouse_id?: string | null }) => p.warehouse_id)
            .filter(Boolean) as string[]
        )
      );

      const warehouseMap = new Map<string, { name: string; code: string }>();
      if (warehouseIds.length > 0) {
        const { data: warehouses, error: warehouseError } = await db
          .from("warehouses")
          .select("id, name, code")
          .in("id", warehouseIds);
        if (warehouseError) throw warehouseError;
        for (const wh of warehouses || []) {
          warehouseMap.set(wh.id, { name: wh.name, code: wh.code });
        }
      }

      for (const product of products || []) {
        const wh = product.warehouse_id ? warehouseMap.get(product.warehouse_id) : null;
        warehouseByProduct.set(product.id, {
          warehouse_id: product.warehouse_id ?? null,
          warehouse_name: wh?.name ?? null,
          warehouse_code: wh?.code ?? null,
        });
      }
    }

    const byStatus: Record<string, { count: number; actual_qty: number; hpp_value: number }> = {};
    let totalPlanned = 0;
    let totalActual = 0;
    let totalHppValue = 0;
    let completedOrders = 0;

    const orders = (rows || []).map((row: Record<string, any>) => {
      const plannedQty = toNumber(row.planned_qty);
      const actualQty = toNumber(row.actual_qty);
      const hppPerUnit = toNumber(row.hpp_per_unit);
      const materialCost = toNumber(row.actual_material_cost ?? row.planned_material_cost);
      const overhead = toNumber(row.overhead_cost);
      const labor = toNumber(row.labor_cost);
      const packaging = toNumber(row.packaging_cost);
      const waste = toNumber(row.waste_cost);
      const componentCost = materialCost + overhead + labor + packaging + waste;
      const hppValue =
        actualQty > 0 && hppPerUnit > 0
          ? actualQty * hppPerUnit
          : componentCost;
      const statusKey = String(row.status || "UNKNOWN").toUpperCase();
      const warehouse = warehouseByProduct.get(row.product_id) || {
        warehouse_id: null,
        warehouse_name: null,
        warehouse_code: null,
      };

      totalPlanned += plannedQty;
      totalActual += actualQty;
      totalHppValue += hppValue;
      if (statusKey === "COMPLETED") completedOrders += 1;

      if (!byStatus[statusKey]) {
        byStatus[statusKey] = { count: 0, actual_qty: 0, hpp_value: 0 };
      }
      byStatus[statusKey].count += 1;
      byStatus[statusKey].actual_qty += actualQty;
      byStatus[statusKey].hpp_value += hppValue;

      return {
        id: row.id,
        nomor_produksi: row.nomor_produksi,
        product_id: row.product_id,
        product_kode: row.product_kode || row.item_kode || "",
        product_nama: row.product_nama || row.item_nama || "-",
        output_type: row.output_type || "FINISHED_GOOD",
        status: statusKey,
        planned_qty: plannedQty,
        actual_qty: actualQty,
        hpp_per_unit: hppPerUnit,
        hpp_per_unit_formatted: formatRupiah(hppPerUnit),
        actual_material_cost: materialCost,
        overhead_cost: overhead,
        labor_cost: labor,
        packaging_cost: packaging,
        waste_cost: waste,
        total_hpp_value: Math.round(hppValue * 100) / 100,
        total_hpp_value_formatted: formatRupiah(hppValue),
        warehouse_id: warehouse.warehouse_id,
        warehouse_name: warehouse.warehouse_name,
        warehouse_code: warehouse.warehouse_code,
        created_at: row.created_at,
        started_at: row.started_at,
        completed_at: row.completed_at,
      };
    });

    const summary = {
      total_orders: orders.length,
      total_planned_qty: Math.round(totalPlanned * 1000) / 1000,
      total_actual_qty: Math.round(totalActual * 1000) / 1000,
      total_hpp_value: Math.round(totalHppValue * 100) / 100,
      completed_orders: completedOrders,
    };

    const byStatusRows = Object.entries(byStatus)
      .map(([statusKey, value]) => ({
        status: statusKey,
        count: value.count,
        actual_qty: Math.round(value.actual_qty * 1000) / 1000,
        hpp_value: Math.round(value.hpp_value * 100) / 100,
        hpp_value_formatted: formatRupiah(value.hpp_value),
      }))
      .sort((a, b) => b.count - a.count);

    if (exportFormat === "csv") {
      const header = [
        "No Produksi",
        "Produk Kode",
        "Produk Nama",
        "Output Type",
        "Status",
        "Qty Planned",
        "Qty Actual",
        "HPP / Unit",
        "Total HPP",
        "Stall",
        "Created At",
        "Completed At",
      ];
      const csvRows = orders.map((order) => [
        order.nomor_produksi,
        order.product_kode,
        order.product_nama,
        order.output_type,
        order.status,
        String(order.planned_qty),
        String(order.actual_qty),
        String(order.hpp_per_unit),
        String(order.total_hpp_value),
        order.warehouse_name || order.warehouse_code || "",
        order.created_at || "",
        order.completed_at || "",
      ]);
      const csvContent = [
        header.map((h) => `"${h}"`).join(","),
        ...csvRows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")),
      ].join("\n");

      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="production-in-house-${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    }

    return successResponse({
      orders,
      by_status: byStatusRows,
      summary,
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Invalid query params", error.issues).toResponse();
    }
    console.error("Error generating production in-house report:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to generate report",
      },
      { status: 500 }
    );
  }
}
