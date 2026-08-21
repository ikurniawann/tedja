import { NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { rawMaterialStockSource } from "@/lib/api/stall-scope";

type PurchaseOrderKpiRow = {
  total?: number | null;
  grand_total?: number | null;
};

type ActionPoRow = {
  id: string;
  nomor_po?: string | null;
  tanggal_po?: string | null;
  tanggal_kirim_estimasi?: string | null;
  status?: string | null;
  nama_supplier?: string | null;
};

type StockAlertRow = {
  id: string;
  nama?: string | null;
  kategori?: string | null;
  qty_onhand?: number | null;
  min_stock?: number | null;
  satuan?: string | null;
};

type MonthlyPoRow = {
  total?: number | null;
  grand_total?: number | null;
  created_at?: string | null;
  source_type?: string | null;
};

type SupplierRow = {
  id: string;
  nama_supplier?: string | null;
};

export async function GET(request: Request) {
  try {
    const db = await createServerPgClient();
    const { searchParams } = new URL(request.url);

    // KPI stok & stock alert mengikuti stall aktif di sidebar.
    const { view: stockView, warehouseId } = await rawMaterialStockSource();
    let lowStockQuery = db
      .from(stockView)
      .select("id", { count: "exact", head: true })
      .in("status_stok", ["MENIPIS", "HABIS"]);
    if (warehouseId) lowStockQuery = lowStockQuery.eq("warehouse_id", warehouseId);

    // Get date range from query params
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");

    // ── KPIs ───────────────────────────────────────────────────────────────
    
    // Total PO Bulan Ini (or date range if specified)
    const startOfMonth = startDate
      ? new Date(startDate)
      : (() => {
          const d = new Date();
          d.setDate(1);
          d.setHours(0, 0, 0, 0);
          return d;
        })();
    
    const endOfMonth = endDate
      ? new Date(endDate)
      : (() => {
          const d = new Date();
          d.setMonth(d.getMonth() + 1, 0);
          d.setHours(23, 59, 59, 999);
          return d;
        })();

    const prevMonthStart = new Date(startOfMonth);
    prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
    const prevMonthEnd = new Date(endOfMonth);
    prevMonthEnd.setMonth(prevMonthEnd.getMonth() - 1);

    const [
      { data: currentMonthPOs, error: poError },
      { data: prevMonthPOs },
      { count: lowStockCount },
      { count: pendingApprovalCount },
    ] = await Promise.all([
      db
        .from("v_purchase_orders")
        .select("id, total, grand_total, created_at")
        .gte("created_at", startOfMonth.toISOString())
        .lte("created_at", endOfMonth.toISOString()),
      db
        .from("v_purchase_orders")
        .select("id, total, grand_total, created_at")
        .gte("created_at", prevMonthStart.toISOString())
        .lte("created_at", prevMonthEnd.toISOString()),
      lowStockQuery,
      db
        .from("v_purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending_approval"),
    ]);

    if (poError) {
      console.error("Current month PO error:", poError);
      throw poError;
    }

    const totalPOCount = currentMonthPOs?.length ?? 0;
    const prevPOCount = prevMonthPOs?.length ?? 0;
    const totalPOCountChange = prevPOCount > 0
      ? ((totalPOCount - prevPOCount) / prevPOCount) * 100
      : 0;

    const totalPOValue = (currentMonthPOs as PurchaseOrderKpiRow[] | null)?.reduce((sum, po) => sum + (po.grand_total || po.total || 0), 0) ?? 0;
    const prevPOValue = (prevMonthPOs as PurchaseOrderKpiRow[] | null)?.reduce((sum, po) => sum + (po.grand_total || po.total || 0), 0) ?? 0;
    const totalPOValueChange = prevPOValue > 0
      ? ((totalPOValue - prevPOValue) / prevPOValue) * 100
      : 0;

    // ── Action POs (Overdue & Pending) ────────────────────────────────────

    const { data: actionPOsData } = await db
      .from("v_purchase_orders")
      .select(`
        id,
        nomor_po,
        tanggal_po,
        tanggal_kirim_estimasi,
        status,
        nama_supplier
      `)
      .or("status.eq.sent,status.eq.pending_approval")
      .order("tanggal_kirim_estimasi", { ascending: true, nullsFirst: false })
      .limit(10);

    const formattedActionPOs = ((actionPOsData || []) as ActionPoRow[]).map((po) => ({
      id: po.id,
      po_number: po.nomor_po,
      supplier_name: po.nama_supplier || "Unknown",
      order_date: po.tanggal_po,
      expected_date: po.tanggal_kirim_estimasi,
      status: po.status,
      days_overdue: po.tanggal_kirim_estimasi 
        ? Math.max(0, Math.floor((new Date().getTime() - new Date(po.tanggal_kirim_estimasi).getTime()) / (1000 * 60 * 60 * 24)))
        : 0,
    })) ?? [];

    // ── Stock Alerts ───────────────────────────────────────────────────────

    let stockAlertsQuery = db
      .from(stockView)
      .select("id, nama, kategori, qty_onhand, min_stock, satuan")
      .in("status_stok", ["MENIPIS", "HABIS"]);
    if (warehouseId) stockAlertsQuery = stockAlertsQuery.eq("warehouse_id", warehouseId);

    const { data: stockAlertsData } = await stockAlertsQuery
      .order("qty_onhand", { ascending: true })
      .limit(10);

    const formattedStockAlerts = ((stockAlertsData || []) as StockAlertRow[]).map((item) => ({
      id: item.id,
      material_name: item.nama,
      category: item.kategori || "Uncategorized",
      qty_on_hand: item.qty_onhand || 0,
      minimum_stok: item.min_stock || 0,
      unit: item.satuan || "unit",
      alert_level: item.qty_onhand === 0 ? "critical" : "warning",
    })) ?? [];

    // ── Monthly Trends (simplified) ───────────────────────────────────────

    const { data: monthlyData } = await db
      .from("v_purchase_orders")
      .select("grand_total, total, created_at, source_type")
      .order("created_at", { ascending: true })
      .limit(100);

    const monthlyTrends: Array<Record<string, string | number>> = [];
    if (monthlyData) {
      const months: Record<string, Record<string, string | number>> = {};
      (monthlyData as MonthlyPoRow[]).forEach((po) => {
        const date = new Date(po.created_at || new Date().toISOString());
        const monthKey = date.toLocaleString("id-ID", { month: "short" });
        const category = po.source_type || "manual";
        
        if (!months[monthKey]) {
          months[monthKey] = { month: monthKey };
        }
        months[monthKey][category] = (months[monthKey][category] || 0) + (po.grand_total || po.total || 0);
      });
      
      Object.values(months).forEach((data) => {
        monthlyTrends.push(data);
      });
    }

    // ── HPP Trends (simplified - empty for now) ───────────────────────────

    const formattedHPPTrends: Array<Record<string, string | number>> = [];

    // ── Supplier Performance (simplified) ─────────────────────────────────

    const { data: suppliersData } = await db
      .from("suppliers")
      .select("id, nama_supplier")
      .limit(10);

    const formattedSupplierPerf = ((suppliersData || []) as SupplierRow[]).map((supplier) => ({
      supplier_id: supplier.id,
      supplier_name: supplier.nama_supplier,
      on_time_rate: 85,
      qc_pass_rate: 95,
      total_deliveries: 0,
      avg_lead_time_days: 3,
    })) ?? [];

    return NextResponse.json({
      kpis: {
        totalPOCount,
        totalPOCountChange: Math.round(totalPOCountChange * 10) / 10,
        totalPOValue,
        totalPOValueChange: Math.round(totalPOValueChange * 10) / 10,
        lowStockCount: lowStockCount ?? 0,
        pendingApprovalCount: pendingApprovalCount ?? 0,
      },
      monthlyTrends,
      actionPOs: formattedActionPOs,
      stockAlerts: formattedStockAlerts,
      hppTrends: formattedHPPTrends,
      supplierPerformance: formattedSupplierPerf,
    });
  } catch (error: unknown) {
    console.error("Dashboard API Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorDetails = typeof error === "object" && error !== null
      ? "details" in error
        ? String(error.details)
        : "hint" in error
          ? String(error.hint)
          : "code" in error
            ? String(error.code)
            : ""
      : "";
    return NextResponse.json(
      { 
        error: "Failed to fetch dashboard data", 
        message: errorMessage,
        details: errorDetails
      },
      { status: 500 }
    );
  }
}
