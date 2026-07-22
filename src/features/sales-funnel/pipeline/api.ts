import type {
  DealFilters,
  DealFormValues,
  DealUpdatePayload,
  SalesDeal,
  SalesLostReason,
  SalesStage,
  StageUpdatePayload,
} from "./types";

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

export async function fetchStages(all = false): Promise<SalesStage[]> {
  const res = await fetch(`/api/sales-funnel/stages${all ? "?all=1" : ""}`);
  if (!res.ok) await parseError(res, "Gagal memuat tahap pipeline");
  const body = (await res.json()) as { data: SalesStage[] };
  return body.data;
}

export async function updateStage(id: string, values: StageUpdatePayload) {
  const res = await fetch(`/api/sales-funnel/stages/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal memperbarui tahap");
  return res.json();
}

export async function fetchLostReasons(): Promise<SalesLostReason[]> {
  const res = await fetch("/api/sales-funnel/lost-reasons");
  if (!res.ok) await parseError(res, "Gagal memuat alasan kalah");
  const body = (await res.json()) as { data: SalesLostReason[] };
  return body.data;
}

export async function fetchDeals(filters: DealFilters): Promise<SalesDeal[]> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.event_type) params.set("event_type", filters.event_type);
  const qs = params.toString();
  const res = await fetch(`/api/sales-funnel/deals${qs ? `?${qs}` : ""}`);
  if (!res.ok) await parseError(res, "Gagal memuat deals");
  const body = (await res.json()) as { data: SalesDeal[] };
  return body.data;
}

export async function createDeal(values: DealFormValues) {
  const res = await fetch("/api/sales-funnel/deals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lead_id: values.lead_id,
      title: values.title,
      event_type: values.event_type,
      event_date: values.event_date || null,
      is_event_date_fixed: values.is_event_date_fixed,
      pax_estimate: values.pax_estimate ? Number(values.pax_estimate) : null,
      value_estimate: values.value_estimate ? Number(values.value_estimate) : null,
    }),
  });
  if (!res.ok) await parseError(res, "Gagal membuat deal");
  return res.json();
}

export async function updateDeal(id: string, values: DealUpdatePayload) {
  const res = await fetch(`/api/sales-funnel/deals/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal memperbarui deal");
  return res.json();
}

export async function deleteDeal(id: string) {
  const res = await fetch(`/api/sales-funnel/deals/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) await parseError(res, "Gagal menghapus deal");
}

// ── Pembayaran deal (Fase G) ─────────────────────────────────────────

export interface DealPayment {
  id: string;
  amount: number;
  method: string;
  paid_on: string;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface DealPaymentTermProgress {
  label: string;
  due_date: string | null;
  percent: number;
  amount: number;
  paid: number;
  status: "lunas" | "sebagian" | "belum";
}

export interface DealPaymentData {
  payments: DealPayment[];
  summary: {
    reference_total: number;
    reference_quote_number: string | null;
    reference_is_accepted: boolean;
    total_paid: number;
    outstanding: number;
  };
  terms: DealPaymentTermProgress[];
}

export interface CreatePaymentValues {
  amount: number;
  method: string;
  paid_on: string;
  note?: string | null;
}

export async function fetchDealPayments(dealId: string): Promise<DealPaymentData> {
  const res = await fetch(`/api/sales-funnel/deals/${dealId}/payments`);
  if (!res.ok) await parseError(res, "Gagal memuat pembayaran");
  const body = (await res.json()) as { data: DealPaymentData };
  return body.data;
}

export async function createDealPayment(dealId: string, values: CreatePaymentValues) {
  const res = await fetch(`/api/sales-funnel/deals/${dealId}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal mencatat pembayaran");
  return res.json();
}

export async function deleteDealPayment(dealId: string, paymentId: string) {
  const res = await fetch(
    `/api/sales-funnel/deals/${dealId}/payments/${paymentId}`,
    { method: "DELETE" }
  );
  if (!res.ok && res.status !== 204) {
    await parseError(res, "Gagal menghapus catatan pembayaran");
  }
}
