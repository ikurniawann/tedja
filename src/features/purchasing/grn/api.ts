import type {
  GrnListParams,
  GrnListResult,
  ReceivingWorkspaceData,
} from "./types";

export type {
  GrnStatus,
  GrnListRow,
  GrnListParams,
  GrnListResult,
  ReceivingWorkspaceData,
} from "./types";

export async function listGrns(
  params: GrnListParams = {}
): Promise<GrnListResult> {
  const sp = new URLSearchParams();
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.search) sp.set("search", params.search);

  const res = await fetch(`/api/purchasing/grn?${sp.toString()}`);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || json.message || "Gagal memuat data GRN");
  }
  return {
    data: json.data || [],
    total: json.pagination?.total || 0,
  };
}

export async function getGrn<T = unknown>(id: string): Promise<T> {
  const res = await fetch(`/api/purchasing/grn/${id}`);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(
      json?.error?.message || json?.error || json?.message || "Data GRN tidak ditemukan"
    );
  }
  return (json?.data ?? json) as T;
}

export async function getGrnQC<T = unknown>(id: string): Promise<T | null> {
  const res = await fetch(`/api/purchasing/grn/${id}/qc`);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) return null;
  return (json?.data ?? null) as T | null;
}

export type VendorCreditRow = {
  id: string;
  credit_number: string;
  source_type: "receive_reject" | "qc_reject";
  status: string;
  total_amount: number;
  reason_notes?: string | null;
  items?: {
    id: string;
    qty: number;
    unit_price: number;
    line_amount: number;
    raw_material?: { kode?: string; nama?: string };
  }[];
};

export async function getGrnVendorCredits(grnId: string): Promise<VendorCreditRow[]> {
  const res = await fetch(`/api/purchasing/grn/${grnId}/vendor-credits`);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || "Failed to load vendor credits");
  }
  return (json?.data ?? []) as VendorCreditRow[];
}

export async function approveVendorCredit(creditId: string) {
  const res = await fetch(`/api/purchasing/vendor-credits/${creditId}/approve`, {
    method: "PATCH",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || "Failed to approve vendor credit");
  }
  return json.data;
}

export async function deleteGrn(id: string): Promise<{ message?: string }> {
  const res = await fetch(`/api/purchasing/grn/${id}`, { method: "DELETE" });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || json.message || "Gagal menghapus GRN");
  }
  return json;
}

export async function updateGrn(
  id: string,
  payload: unknown
): Promise<unknown> {
  const res = await fetch(`/api/purchasing/grn/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : { error: { message: "Empty response from server" } };
  } catch {
    data = { error: { message: "Invalid response from server" } };
  }
  if (!res.ok) {
    const message =
      typeof data.error === "string"
        ? data.error
        : data.error?.message || data.message || "Gagal mengupdate GRN";
    throw new Error(message);
  }
  return data;
}

export type PurchasingModuleType = "raw_material" | "product";

export async function createGrn(
  payload: unknown,
  moduleType?: PurchasingModuleType
): Promise<unknown> {
  const body =
    moduleType === "product"
      ? { ...(payload as Record<string, unknown>), module_type: "product" }
      : payload;

  const res = await fetch("/api/purchasing/grn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let result: { success?: boolean; error?: string; message?: string } | null = null;
  try {
    result = text ? JSON.parse(text) : null;
  } catch {
    result = { error: text || "Response server tidak valid" };
  }
  if (!res.ok || result?.success === false) {
    const message =
      typeof result?.error === "string"
        ? result.error
        : (result?.error as { message?: string } | undefined)?.message ||
          result?.message ||
          (res.status === 404
            ? "Endpoint penerimaan tidak ditemukan"
            : `Gagal membuat penerimaan barang (${res.status})`);
    throw new Error(message);
  }
  return result;
}

export async function getGrnPOItems<T = unknown>(poId: string): Promise<T[]> {
  const res = await fetch(`/api/purchasing/po/${poId}/items`);
  const json = await res.json();
  return (Array.isArray(json.data) ? json.data : []) as T[];
}

export async function getGrnPO<T = unknown>(poId: string): Promise<T | null> {
  const res = await fetch(`/api/purchasing/po/${poId}`);
  const json = await res.json();
  return (json?.data ?? null) as T | null;
}

export async function listGrnDeliveries<T = unknown>(
  moduleType?: PurchasingModuleType
): Promise<T[]> {
  const sp = new URLSearchParams();
  if (moduleType === "product") sp.set("module_type", "product");

  const query = sp.toString();
  const res = await fetch(
    query ? `/api/purchasing/delivery/for-grn?${query}` : "/api/purchasing/delivery/for-grn",
    { cache: "no-store" }
  );
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || json.message || "Failed to load deliveries");
  }
  return (Array.isArray(json.data) ? json.data : []) as T[];
}

export async function listWarehouses(branchId?: string): Promise<{ id: string; name: string; code: string }[]> {
  const sp = new URLSearchParams();
  if (branchId) sp.set("branch_id", branchId);

  const res = await fetch(`/api/purchasing/warehouses?${sp.toString()}`);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.message || "Gagal memuat data gudang");
  }
  return Array.isArray(json.data) ? json.data : [];
}

export type ReceivingUserScope = {
  role: string | null;
  business_scope: "holding" | "company" | "branch" | null;
  branch_id: string | null;
  is_unscoped: boolean;
};

export async function getReceivingUserScope(): Promise<ReceivingUserScope> {
  const res = await fetch("/api/auth/scope", { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.message || "Gagal memuat scope pengguna");
  }
  return json.data as ReceivingUserScope;
}

export async function getReceivingWorkspace(
  moduleType?: PurchasingModuleType
): Promise<ReceivingWorkspaceData> {
  const sp = new URLSearchParams();
  if (moduleType === "product") sp.set("module_type", "product");

  const query = sp.toString();
  const res = await fetch(
    query
      ? `/api/purchasing/receiving-workspace?${query}`
      : "/api/purchasing/receiving-workspace",
    {
      cache: "no-store",
    }
  );
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.message || "Failed to load receiving workspace");
  }
  return {
    purchase_orders: Array.isArray(json.data?.purchase_orders)
      ? json.data.purchase_orders
      : [],
    deliveries: Array.isArray(json.data?.deliveries) ? json.data.deliveries : [],
    grns: Array.isArray(json.data?.grns) ? json.data.grns : [],
  };
}

export type SubmitGrnQcPayload = {
  status?: "approved" | "rejected" | "partial";
  parameter_inspeksi?: Record<string, unknown>;
  hasil_inspeksi?: Record<string, string>;
  catatan?: string | null;
  rekomendasi?: string | null;
  items: {
    grn_item_id: string;
    raw_material_id?: string | null;
    product_id?: string | null;
    qty_inspected: number;
    qty_accepted: number;
    qty_rejected: number;
    catatan?: string | null;
  }[];
};

export async function createQCInspection(
  grnId: string,
  payload: SubmitGrnQcPayload
): Promise<unknown> {
  const res = await fetch(`/api/purchasing/grn/${grnId}/qc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    const message =
      typeof json?.error === "string"
        ? json.error
        : json?.error?.message || json?.message || "Failed to submit quality control";
    throw new Error(message);
  }
  return json?.data ?? json;
}
