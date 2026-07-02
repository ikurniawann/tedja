// ============================================
// LIB: Purchasing Module API Functions
// ============================================

import {
  Supplier,
  SupplierFormData,
  Unit,
  UnitFormData,
  RawMaterial,
  RawMaterialWithStock,
  RawMaterialFormData,
  RawMaterialListParams,
  Inventory,
  InventoryMovement,
  InventoryAdjustmentForm,
  Product,
  ProductWithCOGS,
  ProductFormData,
  BOMItem,
  BOMItemFormData,
  SupplierPriceList,
  SupplierPriceListFormData,
  PurchaseOrder,
  PurchaseOrderWithStats,
  PurchaseOrderItem,
  PurchaseOrderFormData,
  PurchaseOrderItemFormData,
  PurchaseOrderPaymentTerm,
  VendorPayment,
  POListParams,
  Delivery,
  DeliveryFormData,
  GoodsReceipt,
  GoodsReceiptItem,
  GoodsReceiptFormData,
  GoodsReceiptItemFormData,
  QCInspection,
  QCInspectionFormData,
  Return,
  ReturnFormData,
  PaginatedResponse,
} from "@/types/purchasing";

const BASE = "/api/purchasing";

// Helper untuk fetch API
async function fetchApi<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const fieldErrors = error.errors && typeof error.errors === "object"
      ? Object.values(error.errors).flat().filter(Boolean).join(", ")
      : "";
    throw new Error(fieldErrors || error.message || error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ============================================
// SUPPLIERS API
// ============================================

export async function listSuppliers(
  params: { search?: string; is_active?: boolean } = {}
): Promise<Supplier[]> {
  const sp = new URLSearchParams();
  if (params.search) sp.set("search", params.search);
  if (params.is_active !== undefined) sp.set("is_active", String(params.is_active));

  const response = await fetchApi<{ data: Supplier[] }>(
    `${BASE}/suppliers?${sp.toString()}`
  );
  return response.data;
}

export async function getSupplier(id: string): Promise<Supplier> {
  const response = await fetchApi<{ data: Supplier }>(
    `${BASE}/suppliers/${id}`
  );
  return response.data;
}

export async function createSupplier(
  payload: SupplierFormData
): Promise<Supplier> {
  const response = await fetchApi<{ data: Supplier }>(
    `${BASE}/suppliers`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updateSupplier(
  id: string,
  payload: Partial<SupplierFormData>
): Promise<Supplier> {
  const response = await fetchApi<{ data: Supplier }>(
    `${BASE}/suppliers/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function deleteSupplier(id: string): Promise<void> {
  await fetchApi(`${BASE}/suppliers/${id}`, { method: "DELETE" });
}

// ============================================
// UNITS API
// ============================================

export interface UnitListParams {
  search?: string;
  page?: number;
  limit?: number;
}

export async function listUnits(
  params?: UnitListParams
): Promise<{ data: Unit[]; pagination: { page: number; limit: number; total: number; total_pages: number } }> {
  const sp = new URLSearchParams();
  if (params?.search) sp.set("search", params.search);
  if (params?.page) sp.set("page", String(params.page));
  if (params?.limit) sp.set("limit", String(params.limit));

  const response = await fetchApi<{
    data: Unit[];
    pagination: { page: number; limit: number; total: number; total_pages: number };
  }>(`${BASE}/units?${sp.toString()}`);
  return response;
}

export async function createUnit(
  payload: UnitFormData
): Promise<Unit> {
  const response = await fetchApi<{ data: Unit }>(`${BASE}/units`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updateUnit(
  id: string,
  payload: Partial<UnitFormData>
): Promise<Unit> {
  const response = await fetchApi<{ data: Unit }>(
    `${BASE}/units/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updateUnitStatus(
  id: string,
  isActive: boolean
): Promise<Unit> {
  const response = await fetchApi<{ data: Unit }>(
    `${BASE}/units/${id}`,
    {
      method: "PUT",
      body: JSON.stringify({ is_active: isActive }),
    }
  );
  return response.data;
}

export async function deleteUnit(id: string): Promise<void> {
  await fetchApi(`${BASE}/units/${id}`, { method: "DELETE" });
}

// ============================================
// RAW MATERIALS API
// ============================================

export async function listRawMaterials(
  params: RawMaterialListParams = {}
): Promise<PaginatedResponse<RawMaterialWithStock>> {
  const sp = new URLSearchParams();
  if (params.search) sp.set("search", params.search);
  if (params.kategori) sp.set("kategori", params.kategori);
  if (params.satuan_besar_id) sp.set("satuan_besar_id", params.satuan_besar_id);
  if (params.is_active !== undefined) sp.set("is_active", String(params.is_active));
  if (params.below_minimum) sp.set("below_minimum", "true");
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.sort_by) sp.set("sort_by", params.sort_by);
  if (params.sort_dir) sp.set("sort_dir", params.sort_dir);

  return fetchApi<PaginatedResponse<RawMaterialWithStock>>(
    `${BASE}/raw-materials?${sp.toString()}`
  );
}

export async function getRawMaterial(id: string): Promise<RawMaterialWithStock> {
  const response = await fetchApi<{ data: RawMaterialWithStock }>(
    `${BASE}/raw-materials/${id}`
  );
  return response.data;
}

export async function createRawMaterial(
  payload: RawMaterialFormData
): Promise<RawMaterial> {
  const response = await fetchApi<{ data: RawMaterial }>(
    `${BASE}/raw-materials`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updateRawMaterial(
  id: string,
  payload: Partial<RawMaterialFormData>
): Promise<RawMaterial> {
  const response = await fetchApi<{ data: RawMaterial }>(
    `${BASE}/raw-materials/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updateRawMaterialStatus(
  id: string,
  isActive: boolean
): Promise<RawMaterial> {
  const response = await fetchApi<{ data: RawMaterial }>(
    `${BASE}/raw-materials/${id}`,
    {
      method: "PUT",
      body: JSON.stringify({ is_active: isActive }),
    }
  );
  return response.data;
}

export async function deleteRawMaterial(id: string): Promise<void> {
  await fetchApi(`${BASE}/raw-materials/${id}`, { method: "DELETE" });
}

export async function getRawMaterialSuppliers(
  id: string
): Promise<SupplierPriceList[]> {
  const response = await fetchApi<{ data: SupplierPriceList[] }>(
    `${BASE}/raw-materials/${id}/suppliers`
  );
  return response.data;
}

// ============================================
// INVENTORY API
// ============================================

export async function getInventory(): Promise<Inventory[]> {
  const response = await fetchApi<{ data: Inventory[] }>(
    `${BASE}/inventory`
  );
  return response.data;
}

export async function getInventoryDetail(id: string): Promise<Inventory> {
  const response = await fetchApi<{ data: Inventory }>(
    `${BASE}/inventory/${id}`
  );
  return response.data;
}

export async function getInventoryMovements(
  id: string,
  limit: number = 10
): Promise<InventoryMovement[]> {
  const response = await fetchApi<{ data: InventoryMovement[] }>(
    `${BASE}/inventory/${id}/movements?limit=${limit}`
  );
  return response.data;
}

export async function adjustInventory(
  payload: InventoryAdjustmentForm
): Promise<Inventory> {
  const response = await fetchApi<{ data: Inventory }>(
    `${BASE}/inventory/adjustment`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

// ============================================
// PRODUCTS API
// ============================================

export async function listProducts(
  params: { search?: string; is_active?: boolean; page?: number; limit?: number } = {}
): Promise<PaginatedResponse<ProductWithCOGS>> {
  const sp = new URLSearchParams();
  if (params.search) sp.set("search", params.search);
  if (params.is_active !== undefined) sp.set("is_active", String(params.is_active));
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));

  const response = await fetchApi<
    | PaginatedResponse<ProductWithCOGS>
    | {
        success?: boolean;
        data: ProductWithCOGS[];
        pagination: {
          page: number;
          limit: number;
          total: number;
          total_pages: number;
        };
      }
  >(
    `${BASE}/products?${sp.toString()}`
  );

  if ("pagination" in response) {
    return {
      data: response.data,
      total: response.pagination.total,
      page: response.pagination.page,
      limit: response.pagination.limit,
      total_pages: response.pagination.total_pages,
      pagination: response.pagination,
    };
  }

  return response;
}

export async function getProduct(id: string): Promise<ProductWithCOGS> {
  const response = await fetchApi<{ data: ProductWithCOGS }>(
    `${BASE}/products/${id}`
  );
  return response.data;
}

export async function createProduct(
  payload: ProductFormData
): Promise<Product> {
  const response = await fetchApi<{ data: Product }>(
    `${BASE}/products`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updateProduct(
  id: string,
  payload: Partial<ProductFormData>
): Promise<Product> {
  const response = await fetchApi<{ data: Product }>(
    `${BASE}/products/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updateProductStatus(
  id: string,
  isActive: boolean
): Promise<Product> {
  const response = await fetchApi<{ data: Product }>(
    `${BASE}/products/${id}`,
    {
      method: "PUT",
      body: JSON.stringify({ is_active: isActive }),
    }
  );
  return response.data;
}

export async function deleteProduct(id: string): Promise<void> {
  await fetchApi(`${BASE}/products/${id}`, { method: "DELETE" });
}

// ============================================
// BOM API
// ============================================

export async function listBOMItems(
  productId: string
): Promise<BOMItem[]> {
  const response = await fetchApi<{ data: BOMItem[] }>(
    `${BASE}/products/${productId}/bom`
  );
  return response.data;
}

export async function listBOM(
  productId: string
): Promise<BOMItem[]> {
  return listBOMItems(productId);
}

export async function createBOMItem(
  productId: string,
  payload: BOMItemFormData
): Promise<BOMItem> {
  const body = {
    raw_material_id: payload.raw_material_id,
    qty_required: payload.qty_required ?? payload.qty_needed,
    waste_factor: payload.waste_factor ?? ((payload.waste_persen ?? 0) / 100),
    ...((payload.satuan_id ?? payload.unit_id)
      ? { satuan_id: payload.satuan_id ?? payload.unit_id }
      : {}),
  };

  const response = await fetchApi<{ data: BOMItem }>(
    `${BASE}/products/${productId}/bom`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
  return response.data;
}

export async function updateBOMItem(
  id: string,
  payload: Partial<BOMItemFormData>
): Promise<BOMItem> {
  const body = {
    ...(payload.raw_material_id ? { raw_material_id: payload.raw_material_id } : {}),
    ...(payload.qty_required !== undefined || payload.qty_needed !== undefined
      ? { qty_required: payload.qty_required ?? payload.qty_needed }
      : {}),
    ...(payload.satuan_id !== undefined || payload.unit_id !== undefined
      ? { satuan_id: payload.satuan_id ?? payload.unit_id ?? null }
      : {}),
    ...(payload.waste_factor !== undefined || payload.waste_persen !== undefined
      ? { waste_factor: payload.waste_factor ?? ((payload.waste_persen ?? 0) / 100) }
      : {}),
  };

  const response = await fetchApi<{ data: BOMItem }>(
    `${BASE}/bom/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    }
  );
  return response.data;
}

export async function deleteBOMItem(id: string): Promise<void> {
  await fetchApi(`${BASE}/bom/${id}`, { method: "DELETE" });
}

// ============================================
// SUPPLIER PRICE LIST API
// ============================================

export async function listPriceLists(
  params: { supplier_id?: string; raw_material_id?: string; is_active?: boolean; id?: string } = {}
): Promise<SupplierPriceList[] | SupplierPriceList> {
  const sp = new URLSearchParams();
  if (params.id) sp.set("id", params.id);
  if (params.supplier_id) sp.set("supplier_id", params.supplier_id);
  if (params.raw_material_id) sp.set("bahan_baku_id", params.raw_material_id);
  if (params.is_active !== undefined) sp.set("is_active", String(params.is_active));

  const response = await fetchApi<{ data: SupplierPriceList[] | SupplierPriceList }>(
    `${BASE}/price-list?${sp.toString()}`
  );
  return response.data;
}

export async function getPriceList(id: string): Promise<SupplierPriceList> {
  const response = await fetchApi<{ data: SupplierPriceList }>(
    `${BASE}/price-list?id=${id}`
  );
  return response.data;
}

export async function createPriceList(
  payload: SupplierPriceListFormData
): Promise<SupplierPriceList> {
  const response = await fetchApi<{ data: SupplierPriceList }>(
    `${BASE}/price-list`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updatePriceList(
  id: string,
  payload: Partial<SupplierPriceListFormData>
): Promise<SupplierPriceList> {
  const response = await fetchApi<{ data: SupplierPriceList }>(
    `${BASE}/price-list/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function deletePriceList(id: string): Promise<void> {
  await fetchApi(`${BASE}/price-list/${id}`, { method: "DELETE" });
}

// ============================================
// PURCHASE ORDERS API
// ============================================

export async function listPurchaseOrders(
  params: POListParams = {}
): Promise<PaginatedResponse<PurchaseOrderWithStats>> {
  const sp = new URLSearchParams();
  if (params.search) sp.set("search", params.search);
  if (params.status) sp.set("status", params.status);
  if (params.supplier_id) sp.set("supplier_id", params.supplier_id);
  if (params.tanggal_mulai) sp.set("tanggal_mulai", params.tanggal_mulai);
  if (params.tanggal_sampai) sp.set("tanggal_sampai", params.tanggal_sampai);
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));

  return fetchApi<PaginatedResponse<PurchaseOrderWithStats>>(
    `${BASE}/po?${sp.toString()}`
  );
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderWithStats> {
  const response = await fetchApi<{ data: PurchaseOrderWithStats }>(
    `${BASE}/po/${id}`
  );
  return response.data;
}

export async function createPurchaseOrder(
  payload: PurchaseOrderFormData
): Promise<PurchaseOrder> {
  const response = await fetchApi<{ data: PurchaseOrder }>(
    `${BASE}/po`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function convertPRToPurchaseOrder(
  prId: string,
  payload: PurchaseOrderFormData
): Promise<PurchaseOrder> {
  const response = await fetchApi<{ data: PurchaseOrder }>(
    `${BASE}/pr/${prId}/convert-to-po`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updatePurchaseOrder(
  id: string,
  payload: Partial<PurchaseOrderFormData>
): Promise<PurchaseOrder> {
  const response = await fetchApi<{ data: PurchaseOrder }>(
    `${BASE}/po/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function deletePurchaseOrder(id: string): Promise<void> {
  await fetchApi(`${BASE}/po/${id}`, { method: "DELETE" });
}

export async function approvePurchaseOrder(id: string): Promise<PurchaseOrder> {
  const response = await fetchApi<{ data: PurchaseOrder }>(
    `${BASE}/po/${id}/approve`,
    { method: "POST" }
  );
  return response.data;
}

export async function sendPurchaseOrder(
  id: string,
  sentVia: "EMAIL" | "WHATSAPP" | "PRINT" | "OTHER"
): Promise<PurchaseOrder> {
  const response = await fetchApi<{ data: PurchaseOrder }>(
    `${BASE}/po/${id}/send`,
    {
      method: "POST",
      body: JSON.stringify({ sent_via: sentVia }),
    }
  );
  return response.data;
}

export async function cancelPurchaseOrder(
  id: string,
  reason: string
): Promise<PurchaseOrder> {
  const response = await fetchApi<{ data: PurchaseOrder }>(
    `${BASE}/po/${id}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    }
  );
  return response.data;
}

export async function getPurchaseOrderPaymentTerms(id: string): Promise<{
  terms: PurchaseOrderPaymentTerm[];
  payments: VendorPayment[];
}> {
  const response = await fetchApi<{
    data: {
      terms: PurchaseOrderPaymentTerm[];
      payments: VendorPayment[];
    };
  }>(`${BASE}/po/${id}/payment-terms`);
  return response.data;
}

export async function createPurchaseOrderPaymentTerm(
  id: string,
  payload: {
    term_no?: number;
    description: string;
    due_date: string;
    amount: number;
    notes?: string | null;
  }
): Promise<PurchaseOrderPaymentTerm> {
  const response = await fetchApi<{ data: PurchaseOrderPaymentTerm }>(
    `${BASE}/po/${id}/payment-terms`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function deletePurchaseOrderPaymentTerm(
  poId: string,
  termId: string
): Promise<void> {
  await fetchApi(`${BASE}/po/${poId}/payment-terms/${termId}`, {
    method: "DELETE",
  });
}

export async function createVendorPayment(
  id: string,
  payload: {
    payment_term_id?: string | null;
    payment_date?: string;
    amount: number;
    method: VendorPayment["method"];
    reference_number?: string | null;
    notes?: string | null;
  }
): Promise<VendorPayment> {
  const response = await fetchApi<{ data: VendorPayment }>(
    `${BASE}/po/${id}/payments`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

// ============================================
// PURCHASE ORDER ITEMS API
// ============================================

export async function listPOItems(
  poId: string
): Promise<PurchaseOrderItem[]> {
  const response = await fetchApi<{ data: PurchaseOrderItem[] }>(
    `${BASE}/po/${poId}/items`
  );
  return response.data;
}

export async function createPOItem(
  poId: string,
  payload: PurchaseOrderItemFormData
): Promise<PurchaseOrderItem> {
  const { notes, ...rest } = payload;
  const response = await fetchApi<{ data: PurchaseOrderItem }>(
    `${BASE}/po/${poId}/items`,
    {
      method: "POST",
      body: JSON.stringify({ ...rest, catatan: notes || undefined }),
    }
  );
  return response.data;
}

export async function updatePOItem(
  itemId: string,
  payload: Partial<PurchaseOrderItemFormData>
): Promise<PurchaseOrderItem> {
  const { notes, ...rest } = payload;
  const response = await fetchApi<{ data: PurchaseOrderItem }>(
    `${BASE}/po/items/${itemId}`,
    {
      method: "PUT",
      body: JSON.stringify({
        ...rest,
        ...(notes !== undefined ? { catatan: notes || null } : {}),
      }),
    }
  );
  return response.data;
}

export async function deletePOItem(itemId: string): Promise<void> {
  await fetchApi(`${BASE}/po/items/${itemId}`, { method: "DELETE" });
}

// ============================================
// DELIVERIES API
// ============================================

export async function listDeliveries(
  params: { po_id?: string; status?: string } = {}
): Promise<Delivery[]> {
  const sp = new URLSearchParams();
  if (params.po_id) sp.set("po_id", params.po_id);
  if (params.status) sp.set("status", params.status);

  const response = await fetchApi<{ data: Delivery[] }>(
    `${BASE}/deliveries?${sp.toString()}`
  );
  return response.data;
}

export async function getDelivery(id: string): Promise<Delivery> {
  const response = await fetchApi<{ data: Delivery }>(`${BASE}/deliveries/${id}`);
  return response.data;
}

export async function createDelivery(payload: DeliveryFormData): Promise<Delivery> {
  const response = await fetchApi<{ data: Delivery }>(
    `${BASE}/deliveries`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updateDelivery(
  id: string,
  payload: Partial<DeliveryFormData>
): Promise<Delivery> {
  const response = await fetchApi<{ data: Delivery }>(
    `${BASE}/deliveries/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function deleteDelivery(id: string): Promise<void> {
  await fetchApi(`${BASE}/deliveries/${id}`, { method: "DELETE" });
}

// ============================================
// GOODS RECEIPT API
// ============================================

export async function listGoodsReceipts(
  params: { po_id?: string; status?: string; page?: number; limit?: number } = {}
): Promise<PaginatedResponse<GoodsReceipt>> {
  const sp = new URLSearchParams();
  if (params.po_id) sp.set("po_id", params.po_id);
  if (params.status) sp.set("status", params.status);
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));

  return fetchApi<PaginatedResponse<GoodsReceipt>>(
    `${BASE}/grn?${sp.toString()}`
  );
}

export async function getGoodsReceipt(id: string): Promise<GoodsReceipt> {
  const response = await fetchApi<{ data: GoodsReceipt }>(`${BASE}/grn/${id}`);
  return response.data;
}

export async function createGoodsReceipt(payload: GoodsReceiptFormData): Promise<GoodsReceipt> {
  const response = await fetchApi<{ data: GoodsReceipt }>(
    `${BASE}/grn`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updateGoodsReceipt(
  id: string,
  payload: Partial<GoodsReceiptFormData>
): Promise<GoodsReceipt> {
  const response = await fetchApi<{ data: GoodsReceipt }>(
    `${BASE}/grn/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function deleteGoodsReceipt(id: string): Promise<void> {
  await fetchApi(`${BASE}/grn/${id}`, { method: "DELETE" });
}

// GRN Items
export async function listGRNItems(grnId: string): Promise<GoodsReceiptItem[]> {
  const response = await fetchApi<{ data: GoodsReceiptItem[] }>(
    `${BASE}/grn/${grnId}/items`
  );
  return response.data;
}

export async function createGRNItem(
  grnId: string,
  payload: GoodsReceiptItemFormData
): Promise<GoodsReceiptItem> {
  const response = await fetchApi<{ data: GoodsReceiptItem }>(
    `${BASE}/grn/${grnId}/items`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

// ============================================
// QC INSPECTION API
// ============================================

export async function getQCInspection(grnId: string): Promise<QCInspection | null> {
  try {
    const response = await fetchApi<{ data: QCInspection }>(
      `${BASE}/grn/${grnId}/qc`
    );
    return response.data;
  } catch {
    return null;
  }
}

export async function createQCInspection(
  grnId: string,
  payload: QCInspectionFormData
): Promise<QCInspection> {
  const response = await fetchApi<{ data: QCInspection }>(
    `${BASE}/grn/${grnId}/qc`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

// ============================================
// RETURNS API
// ============================================

export async function listReturns(
  params: { grn_id?: string; status?: string } = {}
): Promise<Return[]> {
  const sp = new URLSearchParams();
  if (params.grn_id) sp.set("grn_id", params.grn_id);
  if (params.status) sp.set("status", params.status);

  const response = await fetchApi<{ data: Return[] }>(
    `${BASE}/returns?${sp.toString()}`
  );
  return response.data;
}

export async function getReturn(id: string): Promise<Return> {
  const response = await fetchApi<{ data: Return }>(`${BASE}/returns/${id}`);
  return response.data;
}

export async function createReturn(payload: ReturnFormData): Promise<Return> {
  const response = await fetchApi<{ data: Return }>(
    `${BASE}/returns`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

export async function updateReturn(
  id: string,
  payload: Partial<ReturnFormData>
): Promise<Return> {
  const response = await fetchApi<{ data: Return }>(
    `${BASE}/returns/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return response.data;
}

// ============================================
// REPORTS API
// ============================================

export async function getLowStockReport(): Promise<RawMaterialWithStock[]> {
  const response = await fetchApi<{ data: RawMaterialWithStock[] }>(
    `${BASE}/reports/low-stock`
  );
  return response.data;
}

export async function getInventoryValuation(): Promise<{
  total_value: number;
  by_category: { kategori: string; total_value: number }[];
}> {
  const response = await fetchApi<{
    total_value: number;
    by_category: { kategori: string; total_value: number }[];
  }>(`${BASE}/reports/inventory-valuation`);
  return response;
}
