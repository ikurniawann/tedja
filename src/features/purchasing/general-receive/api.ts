// EPIC-026 B4 — Penerimaan (GRN) barang operasional (scope 'general').
// Alur RAMPING: TANPA langkah delivery manual — penerimaan langsung dari PO,
// delivery dibuat otomatis di backend (grn/route.ts). TANPA QC & TANPA
// pergerakan stok riil di v1 (item hanya ditandai diterima).

import {
  listGeneralPurchaseOrders,
  getGeneralPurchaseOrder,
} from "../general-po/api";
import type { GeneralPODetail } from "../general-po/types";
import { listWarehouses, getReceivingUserScope } from "../grn/api";

export type { GeneralPODetail } from "../general-po/types";
export { listWarehouses, getReceivingUserScope } from "../grn/api";

const MODULE_TYPE = "general" as const;

// Status PO yang masih bisa diterima (belum tuntas).
const RECEIVABLE_STATUSES = ["approved", "sent", "partially_received", "partial"];

export interface ReceivableGeneralPO {
  id: string;
  nomor_po: string;
  tanggal_po: string;
  vendor_name: string;
  status: string;
  total_items: number;
  progress_pct: number;
}

export async function listReceivableGeneralPOs(
  search?: string
): Promise<ReceivableGeneralPO[]> {
  const result = await listGeneralPurchaseOrders({
    page: 1,
    limit: 100,
    search: search || undefined,
  });
  return result.data
    .filter((po) => RECEIVABLE_STATUSES.includes(String(po.status).toLowerCase()))
    .map((po) => ({
      id: po.id,
      nomor_po: po.nomor_po,
      tanggal_po: po.tanggal_po,
      vendor_name: po.vendor_name || "-",
      status: po.status,
      total_items: po.total_items ?? 0,
      progress_pct: po.progress_pct ?? 0,
    }));
}

export async function getGeneralPOForReceive(id: string): Promise<GeneralPODetail> {
  return getGeneralPurchaseOrder(id);
}

export interface GeneralGrnItemPayload {
  purchase_order_item_id: string;
  supply_item_id: string;
  satuan_id?: string;
  qty_diterima: number;
  qty_ditolak: number;
}

export interface CreateGeneralGrnPayload {
  po_id: string;
  warehouse_id: string;
  tanggal_penerimaan?: string;
  catatan?: string;
  items: GeneralGrnItemPayload[];
}

export async function createGeneralGrn(
  payload: CreateGeneralGrnPayload
): Promise<{ id: string; nomor_grn?: string }> {
  const res = await fetch("/api/purchasing/grn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, module_type: MODULE_TYPE }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    const message =
      typeof json?.error === "string"
        ? json.error
        : json?.error?.message || json?.message || "Gagal menyimpan penerimaan barang";
    throw new Error(message);
  }
  return (json?.data ?? json) as { id: string; nomor_grn?: string };
}
