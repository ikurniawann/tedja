import type { LeadFilters, LeadFormValues, LeadListResponse } from "./types";

async function parseError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    message = body.error ?? body.message ?? fallback;
  } catch {
    // body bukan JSON — pakai fallback
  }
  throw new Error(message);
}

export async function fetchLeads(filters: LeadFilters): Promise<LeadListResponse> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.org_type) params.set("org_type", filters.org_type);
  if (filters.source) params.set("source", filters.source);
  params.set("page", String(filters.page));
  params.set("limit", "20");

  const res = await fetch(`/api/sales-funnel/leads?${params.toString()}`);
  if (!res.ok) await parseError(res, "Gagal memuat leads");
  return res.json();
}

export async function createLead(values: LeadFormValues) {
  const res = await fetch("/api/sales-funnel/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal membuat lead");
  return res.json();
}

export async function updateLead(id: string, values: Partial<LeadFormValues>) {
  const res = await fetch(`/api/sales-funnel/leads/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal memperbarui lead");
  return res.json();
}

export async function deleteLead(id: string) {
  const res = await fetch(`/api/sales-funnel/leads/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) await parseError(res, "Gagal menghapus lead");
}
