import type {
  ProductPOFormPayload,
  ProductPOFormData,
  ProductPODetail,
  ProductPOListParams,
  ProductPOListResult,
  ApprovedProductPRForPO,
} from "./types";

const MODULE_TYPE = "product";

async function parseJson<T>(res: Response, fallback: string): Promise<T> {
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.message || json.error || fallback);
  }
  return json;
}

export async function listProductPurchaseOrders(
  params: ProductPOListParams = {}
): Promise<ProductPOListResult> {
  const sp = new URLSearchParams();
  sp.set("module_type", MODULE_TYPE);
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.status) sp.set("status", params.status);
  if (params.search) sp.set("search", params.search);

  const res = await fetch(`/api/purchasing/po?${sp.toString()}`);
  const json = await parseJson<{ data: ProductPOListResult["data"]; pagination: ProductPOListResult["pagination"] }>(
    res,
    "Failed to load purchase orders"
  );
  return { data: json.data || [], pagination: json.pagination };
}

export async function getProductPOFormData(): Promise<ProductPOFormData> {
  const res = await fetch(`/api/purchasing/po/form-data?module_type=${MODULE_TYPE}`);
  const json = await parseJson<{ data: ProductPOFormData }>(res, "Failed to load form data");
  return json.data;
}

export async function listApprovedProductPRsForPO(): Promise<ApprovedProductPRForPO[]> {
  const res = await fetch(`/api/purchasing/pr/for-po?module_type=${MODULE_TYPE}`);
  const json = await parseJson<{ data: ApprovedProductPRForPO[] }>(res, "Failed to load purchase requests");
  return json.data || [];
}

export async function getProductPurchaseOrder(id: string): Promise<ProductPODetail> {
  const res = await fetch(`/api/purchasing/po/${id}`);
  const json = await parseJson<{ data: ProductPODetail }>(res, "Failed to load purchase order");
  return json.data;
}

export async function createProductPurchaseOrder(payload: ProductPOFormPayload) {
  const res = await fetch("/api/purchasing/po", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, module_type: MODULE_TYPE }),
  });
  return parseJson<{ data: { id: string; nomor_po?: string } }>(res, "Failed to create purchase order");
}

export async function approveProductPurchaseOrder(id: string) {
  const res = await fetch(`/api/purchasing/po/${id}/approve`, { method: "POST" });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message || json.error || "Failed to approve purchase order");
  }
}

export async function sendProductPurchaseOrder(
  id: string,
  sentVia: "EMAIL" | "WHATSAPP" | "PRINT" | "OTHER"
) {
  const res = await fetch(`/api/purchasing/po/${id}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sent_via: sentVia }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message || json.error || "Failed to send purchase order");
  }
}

export async function cancelProductPurchaseOrder(id: string, reason: string) {
  const res = await fetch(`/api/purchasing/po/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message || json.error || "Failed to cancel purchase order");
  }
}
