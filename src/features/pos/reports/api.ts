import type {
  ProfitReport,
  ProfitReportParams,
  ClosingReport,
  ClosingReportParams,
  TransactionReport,
  TransactionReportParams,
  ProductSalesReport,
  ProductSalesReportParams,
  RushHourReport,
  RushHourReportParams,
  VoidReport,
  VoidReportParams,
  PaymentMethodsReport,
  PaymentMethodsReportParams,
} from "./types";

export type * from "./types";

export async function getProfitReport(params: ProfitReportParams): Promise<ProfitReport> {
  const sp = new URLSearchParams({
    date_from: params.date_from,
    date_to: params.date_to,
  });
  const response = await fetch(`/api/pos/reports/profit?${sp.toString()}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error || "Gagal memuat laporan profit POS");
  }
  return payload.data as ProfitReport;
}

export async function getClosingReport(params: ClosingReportParams): Promise<ClosingReport> {
  const sp = new URLSearchParams({ date: params.date });
  if (params.shift_id) sp.set("shift_id", params.shift_id);
  const response = await fetch(`/api/pos/reports/closing?${sp.toString()}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error || "Failed to load cashier closing report");
  }
  return payload.data as ClosingReport;
}

export async function getTransactionReport(
  params: TransactionReportParams
): Promise<TransactionReport> {
  const sp = new URLSearchParams({
    date_from: params.date_from,
    date_to: params.date_to,
  });
  if (params.warehouse_id) sp.set("warehouse_id", params.warehouse_id);
  const response = await fetch(`/api/pos/reports/transactions?${sp.toString()}`, {
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error || "Gagal memuat laporan transaksi");
  }
  return payload.data as TransactionReport;
}

export async function getProductSalesReport(
  params: ProductSalesReportParams
): Promise<ProductSalesReport> {
  const sp = new URLSearchParams({
    date_from: params.date_from,
    date_to: params.date_to,
  });
  if (params.warehouse_id) sp.set("warehouse_id", params.warehouse_id);
  const response = await fetch(`/api/pos/reports/product-sales?${sp.toString()}`, {
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error || "Gagal memuat laporan penjualan produk");
  }
  return payload.data as ProductSalesReport;
}

export async function getRushHourReport(
  params: RushHourReportParams
): Promise<RushHourReport> {
  const sp = new URLSearchParams({
    date_from: params.date_from,
    date_to: params.date_to,
  });
  if (params.warehouse_id) sp.set("warehouse_id", params.warehouse_id);
  const response = await fetch(`/api/pos/reports/rush-hour?${sp.toString()}`, {
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error || "Gagal memuat laporan rush hour");
  }
  return payload.data as RushHourReport;
}

export async function getVoidReport(params: VoidReportParams): Promise<VoidReport> {
  const sp = new URLSearchParams({
    date_from: params.date_from,
    date_to: params.date_to,
  });
  if (params.warehouse_id) sp.set("warehouse_id", params.warehouse_id);
  const response = await fetch(`/api/pos/reports/voids?${sp.toString()}`, {
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error || "Gagal memuat laporan void");
  }
  return payload.data as VoidReport;
}

export async function getPaymentMethodsReport(
  params: PaymentMethodsReportParams
): Promise<PaymentMethodsReport> {
  const sp = new URLSearchParams({
    date_from: params.date_from,
    date_to: params.date_to,
    granularity: params.granularity || "day",
  });
  if (params.warehouse_id) sp.set("warehouse_id", params.warehouse_id);
  const response = await fetch(`/api/pos/reports/payment-methods?${sp.toString()}`, {
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error || "Gagal memuat laporan jenis pembayaran");
  }
  return payload.data as PaymentMethodsReport;
}
