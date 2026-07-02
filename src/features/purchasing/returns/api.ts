import {
  listReturns,
  getReturn,
  createReturn,
  approveReturn,
  rejectReturn,
  getReturnableItems,
  updateReturn,
  cancelReturn,
  shipReturn,
} from "@/lib/purchasing/return";
import { listSuppliers } from "@/lib/purchasing";
import type {
  PurchaseReturn,
  ReturnListParams,
  ReturnableItem,
  Supplier,
} from "@/types/purchasing";

export {
  listReturns,
  getReturn,
  createReturn,
  approveReturn,
  rejectReturn,
  getReturnableItems,
  updateReturn,
  cancelReturn,
  shipReturn,
};

export interface ReturnListResult {
  data: PurchaseReturn[];
  pagination: { page: number; total: number; total_pages: number };
}

export async function listReturnsPaged(
  params: ReturnListParams
): Promise<ReturnListResult> {
  const result = await listReturns(params);
  return {
    data: result.data || [],
    pagination: {
      page: result.pagination?.page ?? 1,
      total: result.pagination?.total ?? 0,
      total_pages: result.pagination?.total_pages ?? 1,
    },
  };
}

export interface ReturnFormData {
  suppliers: Supplier[];
  returnableItems: ReturnableItem[];
}

export interface ReturnGrnOption {
  id: string;
  nomor_grn: string;
  tanggal_penerimaan?: string | null;
  supplier_id: string;
  supplier?: { nama_supplier?: string | null } | null;
}

export async function listReturnGrnOptions(): Promise<ReturnGrnOption[]> {
  const response = await fetch("/api/purchasing/returns/grn-options");
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Failed to load goods receipt options");
  }

  return result.data || [];
}

export async function getReturnFormData(
  grnId?: string | null,
  excludeReturnId?: string | null
): Promise<ReturnFormData> {
  const [suppliers, returnableItems] = await Promise.all([
    listSuppliers({ is_active: true }),
    grnId
      ? getReturnableItems(grnId, excludeReturnId || undefined)
      : Promise.resolve([] as ReturnableItem[]),
  ]);
  return { suppliers, returnableItems };
}
