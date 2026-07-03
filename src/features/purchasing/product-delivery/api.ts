import type {
  CreateProductDeliveryPayload,
  ProductDeliveryDetail,
  ProductDeliveryListParams,
  ProductDeliveryListResult,
  ProductDeliveryPOOption,
} from "./types";

const MODULE_TYPE = "product";

export async function listProductDeliveries(
  params: ProductDeliveryListParams = {}
): Promise<ProductDeliveryListResult> {
  const sp = new URLSearchParams();
  sp.set("module_type", MODULE_TYPE);
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.status) sp.set("status", params.status);
  if (params.po_id) sp.set("po_id", params.po_id);
  if (params.search) sp.set("search", params.search);

  const res = await fetch(`/api/purchasing/delivery?${sp.toString()}`);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.message || json.error || "Failed to load deliveries");
  }
  const total = json.pagination?.total || 0;
  const limit = params.limit || 10;
  return {
    data: json.data || [],
    total,
    totalPages:
      json.pagination?.totalPages ||
      json.pagination?.total_pages ||
      Math.max(1, Math.ceil(total / limit)),
  };
}

export async function getProductDelivery(id: string): Promise<ProductDeliveryDetail> {
  const res = await fetch(`/api/purchasing/delivery/${id}`);
  const json = await res.json();
  if (!res.ok || !json.data) {
    throw new Error(json.message || "Delivery not found");
  }
  const data = json.data;
  return {
    ...data,
    vendor: data.vendor
      ? data.vendor
      : data.supplier
        ? { id: data.supplier.id, nama: data.supplier.nama, kode: data.supplier.kode }
        : null,
  };
}

export async function listProductDeliveryPOOptions(
  includeCancelled = false
): Promise<ProductDeliveryPOOption[]> {
  const sp = new URLSearchParams({ module_type: MODULE_TYPE });
  if (includeCancelled) sp.set("include_cancelled", "true");

  const res = await fetch(`/api/purchasing/delivery/po-options?${sp.toString()}`, {
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.message || json.error || "Failed to load purchase order options");
  }
  return Array.isArray(json.data) ? json.data : [];
}

export async function createProductDelivery(payload: CreateProductDeliveryPayload) {
  const res = await fetch("/api/purchasing/delivery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, module_type: MODULE_TYPE }),
  });
  const json = await res.json();
  if (!res.ok) {
    const apiError = typeof json.error === "string" ? json.error : json.error?.message;
    throw new Error(apiError || json.message || "Failed to create delivery");
  }
  return json.data || {};
}

export async function listProductPOItemsForDelivery(poId: string) {
  const res = await fetch(`/api/purchasing/po-items?po_id=${poId}`);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.message || "Failed to load purchase order items");
  }
  return Array.isArray(json.data) ? json.data : [];
}
