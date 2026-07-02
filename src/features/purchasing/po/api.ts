import {
  listPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  convertPRToPurchaseOrder,
  approvePurchaseOrder,
  sendPurchaseOrder,
  cancelPurchaseOrder,
  getPurchaseOrderPaymentTerms,
  createPurchaseOrderPaymentTerm,
  deletePurchaseOrderPaymentTerm,
  createVendorPayment,
  listSuppliers,
  listRawMaterials,
  listUnits,
  listPriceLists,
  updatePurchaseOrder,
  createPOItem,
  updatePOItem,
  deletePOItem,
} from "@/lib/purchasing";
import type {
  Supplier,
  RawMaterialWithStock,
  Unit,
} from "@/types/purchasing";

export {
  listPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  convertPRToPurchaseOrder,
  approvePurchaseOrder,
  sendPurchaseOrder,
  cancelPurchaseOrder,
  getPurchaseOrderPaymentTerms,
  createPurchaseOrderPaymentTerm,
  deletePurchaseOrderPaymentTerm,
  createVendorPayment,
  listPriceLists,
  updatePurchaseOrder,
  createPOItem,
  updatePOItem,
  deletePOItem,
};

type SuppliersResponse = Supplier[] | { data?: Supplier[] };

export interface POFormData {
  suppliers: Supplier[];
  materials: RawMaterialWithStock[];
  units: Unit[];
}

export interface ApprovedPRForPO {
  id: string;
  pr_number: string;
  status: string;
  converted_po_id?: string | null;
  department?: { name: string };
  requester_name?: string;
  department_name?: string;
  items?: Array<{
    id: string;
    pr_id?: string;
    raw_material_id?: string | null;
    satuan_id?: string | null;
    description: string;
    qty: number;
    unit: string;
    estimated_price: number;
    raw_material?: { id: string; kode: string; nama: string; satuan?: string };
    satuan?: { id: string; nama: string };
  }>;
}

/**
 * Lists approved PRs that have not yet been converted to a PO, used to source
 * the PO creation form.
 */
export async function listApprovedPRsForPO(): Promise<ApprovedPRForPO[]> {
  const res = await fetch("/api/purchasing/pr/for-po");
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`);
  return (json.data || []) as ApprovedPRForPO[];
}

/**
 * Loads the dependent data needed by the PO form. Each resource is fetched
 * independently and failures are tolerated (returns an empty list for the
 * failed resource) so the form remains usable.
 */
export async function getPOFormData(): Promise<POFormData> {
  const [suppliersRes, materialsRes, unitsRes] = await Promise.all([
    listSuppliers().catch(() => [] as Supplier[]),
    listRawMaterials({ limit: 100, is_active: undefined }).catch(() => ({
      data: [] as RawMaterialWithStock[],
    })),
    listUnits().catch(() => ({ data: [] as Unit[] })),
  ]);

  const suppliers = Array.isArray(suppliersRes)
    ? suppliersRes
    : (suppliersRes as SuppliersResponse as { data?: Supplier[] }).data || [];

  return {
    suppliers,
    materials: materialsRes.data || [],
    units: unitsRes?.data || [],
  };
}
