import type { ProfitReport, ProfitReportParams, ClosingReport, ClosingReportParams } from "./types";

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
