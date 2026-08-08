import type {
  HPPRow,
  InventoryApiRow,
  InventoryValuationParams,
  PODetailParams,
  POSummaryParams,
  POSummaryResult,
  PoSummaryExportFormat,
  PoSummaryExportResult,
  StockCardParams,
  StockCardResponse,
  SupplierPerfRow,
  ProductionInHouseParams,
  ProductionInHouseResult,
} from "./types";

export type * from "./types";

const BASE = "/api/purchasing/reports";

function buildParams(record: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(record).forEach(([key, value]) => {
    if (value !== undefined && value !== "" && value !== null) {
      params.set(key, String(value));
    }
  });
  return params;
}

export async function getSupplierPerformance(params: {
  date_from?: string;
  date_to?: string;
  supplier_id?: string;
}): Promise<SupplierPerfRow[]> {
  const sp = buildParams({
    date_from: params.date_from,
    date_to: params.date_to,
    supplier_id: params.supplier_id,
  });
  const res = await fetch(`${BASE}/supplier-performance?${sp.toString()}`);
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.success === false) {
    throw new Error(data?.message || data?.error || "Gagal memuat data performa supplier");
  }
  const rows = data.data?.suppliers ?? data.data?.vendors ?? data.items ?? [];
  return (rows as Record<string, unknown>[]).map((row) => ({
    id: String(row.id || row.supplier_id || row.vendor_id || ""),
    rank: row.rank != null ? Number(row.rank) : undefined,
    supplier_code: (row.supplier_code || row.vendor_code) as string | undefined,
    supplier_name: (row.supplier_name || row.vendor_name) as string | undefined,
    contact_person: row.contact_person as string | undefined,
    telepon: row.telepon as string | undefined,
    email: row.email as string | undefined,
    total_po: Number(row.total_po || 0),
    completed_po: Number(row.completed_po || row.approved_po || 0),
    on_time_count: Number(row.on_time_count || 0),
    late_count: Number(row.late_count || 0),
    on_time_rate:
      row.on_time_rate != null
        ? Number(row.on_time_rate)
        : row.on_time_delivery_rate != null
          ? Number(row.on_time_delivery_rate)
          : null,
    reject_rate: Number(row.reject_rate || 0),
    avg_lead_time_days:
      row.avg_lead_time_days != null ? Number(row.avg_lead_time_days) : null,
    total_value: Number(row.total_value ?? row.total_spent ?? 0),
    avg_po_value: Number(row.avg_po_value || 0),
    quality_score: Number(row.quality_score || 0),
    rating: Number(row.rating || 0),
  }));
}

export async function getHppBreakdown(): Promise<HPPRow[]> {
  const res = await fetch(`${BASE}/hpp-breakdown`);
  if (!res.ok) throw new Error("Gagal memuat data HPP");
  const data = await res.json();
  return data.items || [];
}

export async function getPoSummary(
  params: POSummaryParams
): Promise<POSummaryResult> {
  const sp = buildParams({ ...params });
  const response = await fetch(`${BASE}/po-summary?${sp.toString()}`);
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    throw new Error(result?.message || "Gagal memuat laporan PO Summary");
  }
  return {
    summary: result.data.summary || [],
    byStatus: result.data.by_status || [],
    grandTotal: result.data.grand_total || 0,
  };
}

export async function exportPoSummary(
  params: POSummaryParams,
  format: PoSummaryExportFormat
): Promise<PoSummaryExportResult> {
  const sp = buildParams({ ...params, export: format });
  const response = await fetch(`${BASE}/po-summary?${sp.toString()}`);
  if (!response.ok) {
    throw new Error("Gagal export laporan PO Summary");
  }
  if (format === "csv") {
    return { blob: await response.blob(), extension: "csv" };
  }
  const result = await response.json();
  return {
    blob: new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    }),
    extension: "json",
  };
}

export async function getStockCard(
  params: StockCardParams
): Promise<StockCardResponse> {
  const sp = buildParams({ ...params, limit: params.limit ?? 500 });
  const response = await fetch(`${BASE}/stock-card?${sp.toString()}`);
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Gagal memuat stock card");
  }
  return result.data;
}

export async function getInventoryValuation(
  params: InventoryValuationParams
): Promise<InventoryApiRow[]> {
  const sp = buildParams({ date_from: params.date_from, date_to: params.date_to });
  const res = await fetch(`${BASE}/inventory-valuation?${sp.toString()}`, {
    credentials: "same-origin",
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok || result.success === false) {
    throw new Error(result.message || "Gagal memuat valuasi inventory");
  }
  return (result.data || []) as InventoryApiRow[];
}

export async function getPoDetailReport(
  params: PODetailParams
): Promise<unknown[]> {
  const sp = buildParams({ ...params });
  const response = await fetch(`${BASE}/po-detail?${sp.toString()}`);
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    throw new Error(result?.message || result?.error || "Gagal memuat laporan Detail PO");
  }
  return result.data.summary || [];
}

export async function getProductionInHouseReport(
  params: ProductionInHouseParams
): Promise<ProductionInHouseResult> {
  const sp = buildParams({ ...params });
  const response = await fetch(`${BASE}/production-in-house?${sp.toString()}`);
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    throw new Error(
      result?.message || result?.error || "Gagal memuat laporan Produksi Internal"
    );
  }
  return {
    orders: result.data.orders || [],
    byStatus: result.data.by_status || [],
    summary: result.data.summary || {
      total_orders: 0,
      total_planned_qty: 0,
      total_actual_qty: 0,
      total_hpp_value: 0,
      completed_orders: 0,
    },
  };
}

export async function exportProductionInHouseReport(
  params: ProductionInHouseParams
): Promise<Blob> {
  const sp = buildParams({ ...params, export: "csv" });
  const response = await fetch(`${BASE}/production-in-house?${sp.toString()}`);
  if (!response.ok) {
    throw new Error("Gagal mengekspor laporan Produksi Internal");
  }
  return response.blob();
}
