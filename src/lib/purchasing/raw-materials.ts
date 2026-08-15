import type {
  RawMaterial,
  RawMaterialDetail,
  RawMaterialListParams,
} from "@/types/raw-material";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RawMaterialListResponse {
  success: boolean;
  data: RawMaterial[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface RawMaterialDetailResponse {
  success: boolean;
  data: RawMaterialDetail;
}

// ─── API Base ────────────────────────────────────────────────────────────────

const BASE = "/api/purchasing/raw-materials";

async function fetchApi<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }

  if (res.status === 204) return {} as T;
  return res.json();
}

// ─── List ───────────────────────────────────────────────────────────────────

export async function listRawMaterials(
  params?: RawMaterialListParams
): Promise<RawMaterialListResponse> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.kategori) qs.set("kategori", params.kategori);
  if (params?.satuan_besar_id) qs.set("satuan_besar_id", params.satuan_besar_id);
  if (params?.is_active !== undefined) qs.set("is_active", String(params.is_active));
  if (params?.below_minimum) qs.set("below_minimum", "1");
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.sort_by) qs.set("sort_by", params.sort_by);
  if (params?.sort_dir) qs.set("sort_dir", params.sort_dir);

  const url = qs.toString() ? `${BASE}?${qs.toString()}` : BASE;
  return fetchApi<RawMaterialListResponse>(url);
}

// ─── Get One ────────────────────────────────────────────────────────────────

export async function getRawMaterialDetail(
  id: string
): Promise<RawMaterialDetailResponse> {
  return fetchApi<RawMaterialDetailResponse>(`${BASE}/${id}`);
}

// ─── Create ──────────────────────────────────────────────────────────────────

export interface CreateRawMaterialInput {
  kode_bahan: string;
  nama_bahan: string;
  kategori?: string;
  satuan_besar_id: string;
  satuan_kecil_id?: string;
  konversi_factor?: number;
  stok_minimum?: number;
  stok_maximum?: number;
  shelf_life_days?: number;
  storage_condition?: string;
  coa_production?: string;
  coa_rnd?: string;
  coa_asset?: string;
}

export async function createRawMaterial(
  input: CreateRawMaterialInput
): Promise<{ success: boolean; data: RawMaterial; message: string }> {
  return fetchApi(`${BASE}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ─── Update ─────────────────────────────────────────────────────────────────

export interface UpdateRawMaterialInput {
  nama_bahan?: string;
  kategori?: string;
  satuan_besar_id?: string;
  satuan_kecil_id?: string | null;
  konversi_factor?: number;
  stok_minimum?: number;
  stok_maximum?: number | null;
  shelf_life_days?: number;
  storage_condition?: string;
  coa_production?: string;
  coa_rnd?: string;
  coa_asset?: string;
}

export async function updateRawMaterial(
  id: string,
  input: UpdateRawMaterialInput
): Promise<{ success: boolean; data: RawMaterial; message: string; warning?: string | null }> {
  return fetchApi(`${BASE}/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

// ─── Delete ─────────────────────────────────────────────────────────────────

export async function deleteRawMaterial(
  id: string
): Promise<{ success: boolean }> {
  return fetchApi(`${BASE}/${id}`, { method: "DELETE" });
}

// ─── CSV Export ─────────────────────────────────────────────────────────────

export function exportRawMaterialsCSV(data: RawMaterial[]) {
  const headers = [
    "Kode",
    "Nama",
    "Kategori",
    "Satuan Besar",
    "Satuan Kecil",
    "Konversi",
    "Stok On Hand",
    "Stok Min",
    "Stok Max",
    "Avg Cost",
    "Status Stok",
    "Supplier Utama",
    "Shelf Life (hari)",
  ];

  const rows = data.map((m) => [
    m.kode,
    m.nama,
    m.kategori ?? "",
    (m as any).satuan_besar?.nama ?? "",
    (m as any).satuan_kecil?.nama ?? "",
    m.konversi_factor ?? 1,
    m.qty_onhand,
    m.minimum_stock ?? 0,
    m.maximum_stock ?? "",
    m.avg_cost,
    m.status_stok,
    (m as any).supplier_utama?.nama ?? "",
    m.shelf_life_days ?? 0,
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((r) =>
      r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `raw-materials-${new Date().toISOString().split("T")[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
