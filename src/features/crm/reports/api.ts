import type { CrmReportData, CrmReportPeriodInput, CsReportData } from "./types";

export type * from "./types";

export async function getCrmReports(period: Partial<CrmReportPeriodInput>): Promise<CrmReportData> {
  const params = new URLSearchParams();
  if (period.from) params.set("from", period.from);
  if (period.to) params.set("to", period.to);

  const queryString = params.toString();
  const response = await fetch(`/api/crm/reports${queryString ? `?${queryString}` : ""}`, {
    cache: "no-store",
  });
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || "Gagal memuat laporan CRM");
  }
  return json.data as CrmReportData;
}

export async function getCsReport(
  period: Partial<CrmReportPeriodInput>
): Promise<CsReportData> {
  const sp = new URLSearchParams();
  if (period.from) sp.set("from", period.from);
  if (period.to) sp.set("to", period.to);

  const response = await fetch(`/api/crm/reports/cs?${sp.toString()}`, { cache: "no-store" });
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || "Gagal memuat laporan CS");
  }
  return json.data as CsReportData;
}
