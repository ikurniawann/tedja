import type { CrmDashboardResult } from "./types";

export type * from "./types";

async function parseCrmResponse<T>(response: Response, fallbackError: string): Promise<T> {
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || fallbackError);
  }
  return json as T;
}

export async function getCrmDashboard(): Promise<CrmDashboardResult> {
  const response = await fetch("/api/crm/dashboard", { cache: "no-store" });
  const json = await parseCrmResponse<{ data: CrmDashboardResult["data"]; meta?: { schemaReady?: boolean } }>(
    response,
    "Gagal memuat dashboard CRM"
  );
  return {
    data: json.data,
    schemaReady: Boolean(json.meta?.schemaReady),
  };
}
