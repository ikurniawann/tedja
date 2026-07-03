"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { DsDateTimePicker } from "@/components/design-system";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  PurchasingFormHeader,
  PurchasingFormFooter,
} from "@/modules/purchasing/components/page/purchasing-page-header";
import { Supplier, RawMaterialWithStock, PurchaseOrderFormData, PurchaseOrderItemFormData, Unit, SupplierPriceList, PurchaseOrderItem } from "@/types/purchasing";
import { listPriceLists, updatePurchaseOrder } from "../api";
import { getPurchaseRequest } from "@/features/purchasing/pr/api";
import { usePOFormData, useApprovedPRsForPO, usePurchaseOrder } from "../queries";
import { useCreatePurchaseOrder } from "../mutations";
import { formatAmount } from "@/lib/purchasing/utils";

interface POItemForm extends PurchaseOrderItemFormData {
  id: string;
  pr_item_id?: string;
  raw_material_name?: string;
  raw_material_unit?: string;
  requested_qty?: number;
  requested_satuan_id?: string;
  source?: "manual" | "pr" | "prefill";
  subtotal: number;
}

type SuppliersResponse = Supplier[] | { data?: Supplier[] };
type FetchError = Error & {
  response?: Response;
};

function mapPOItemToForm(item: PurchaseOrderItem): POItemForm {
  const row = item as PurchaseOrderItem & {
    pr_item_id?: string | null;
    satuan_id?: string | null;
    catatan?: string | null;
  };
  const rawMaterial = item.raw_material;
  const satuan = item.satuan;
  const qty = Number(item.qty_ordered || 0);
  const price = Number(item.harga_satuan || 0);
  const note = row.catatan ?? item.notes ?? "";

  return {
    id: item.id,
    pr_item_id: row.pr_item_id || undefined,
    raw_material_id: item.raw_material_id || "",
    satuan_id: row.satuan_id || undefined,
    qty_ordered: qty,
    harga_satuan: price,
    notes: note,
    subtotal: qty * price,
    raw_material_name: rawMaterial?.nama || note,
    raw_material_unit: satuan?.nama || rawMaterial?.satuan || "",
    requested_qty: qty,
    requested_satuan_id: row.satuan_id || undefined,
    source: row.pr_item_id ? "pr" : "manual",
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type UnitOption = { value: string; label: string; description?: string };

function resolveSatuanIdFromPrItem(
  item: {
    satuan_id?: string | null;
    satuan?: { id?: string; nama?: string } | null;
    unit?: string | null;
    raw_material_id?: string | null;
  },
  materials: RawMaterialWithStock[],
  units: Unit[]
): string | undefined {
  if (item.satuan_id) return item.satuan_id;
  if (item.satuan?.id) return item.satuan.id;

  const label = (item.satuan?.nama || item.unit || "").trim();
  if (label) {
    const normalized = label.toLowerCase();
    const match = units.find(
      (unit) =>
        unit.nama.toLowerCase() === normalized ||
        unit.kode?.toLowerCase() === normalized
    );
    if (match) return match.id;
  }

  if (item.raw_material_id) {
    const material = materials.find((entry) => entry.id === item.raw_material_id);
    return material?.satuan_besar_id || undefined;
  }

  return undefined;
}

function buildMaterialUnitOptions(
  materialId: string | undefined,
  materials: RawMaterialWithStock[],
  units: Unit[],
  selected?: { unitId?: string; unitName?: string }
): UnitOption[] {
  const material = materials.find((entry) => entry.id === materialId);
  const conversionUnitIds = (material?.unit_conversions || [])
    .filter((conversion) => conversion.is_active !== false)
    .map((conversion) => conversion.satuan_id);
  const unitIds = Array.from(
    new Set([
      material?.satuan_besar_id,
      material?.satuan_kecil_id,
      selected?.unitId,
      ...conversionUnitIds,
    ].filter(Boolean) as string[])
  );

  const options = unitIds
    .map((unitId) => {
      const unit = units.find((entry) => entry.id === unitId);
      if (unit) {
        return { value: unit.id, label: unit.nama, description: unit.kode };
      }
      if (unitId === selected?.unitId && selected.unitName) {
        return { value: unitId, label: selected.unitName };
      }
      return null;
    })
    .filter(Boolean) as UnitOption[];

  if (selected?.unitId && !options.some((option) => option.value === selected.unitId)) {
    const unit = units.find((entry) => entry.id === selected.unitId);
    options.push({
      value: selected.unitId,
      label: unit?.nama || selected.unitName || "Satuan",
      description: unit?.kode,
    });
  }

  return options;
}

interface PRForPO {
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

type NewPOPageProps = {
  poId?: string;
};

export function NewPOPage({ poId }: NewPOPageProps = {}) {
  const isEditMode = Boolean(poId);
  const router = useRouter();
  const searchParams = useSearchParams();
  const formDataQuery = usePOFormData();
  const detailQuery = usePurchaseOrder(poId || "");
  const existingPo = detailQuery.data ?? null;
  const suppliers = formDataQuery.data?.suppliers ?? [];
  const materials = formDataQuery.data?.materials ?? [];
  const units = formDataQuery.data?.units ?? [];
  const [selectedPR, setSelectedPR] = useState<PRForPO | null>(null);
  const [loadingPR, setLoadingPR] = useState(false);
  const [editPrefillDone, setEditPrefillDone] = useState(!poId);
  const [isSaving, setIsSaving] = useState(false);
  const loading = formDataQuery.isLoading || (isEditMode && (detailQuery.isLoading || !editPrefillDone));
  const approvedPRsQuery = useApprovedPRsForPO();
  const approvedPrs = approvedPRsQuery.data ?? [];
  const approvedPrsErrorShown = useRef(false);

  useEffect(() => {
    if (approvedPRsQuery.isError && !approvedPrsErrorShown.current) {
      approvedPrsErrorShown.current = true;
      toast.error(getErrorMessage(approvedPRsQuery.error, "Failed to load approved purchase requests"));
    }
    if (approvedPRsQuery.isSuccess) {
      approvedPrsErrorShown.current = false;
    }
  }, [approvedPRsQuery.isError, approvedPRsQuery.error, approvedPRsQuery.isSuccess]);
  const createMutation = useCreatePurchaseOrder();
  const isSubmitting = createMutation.isPending || isSaving;
  const prId = isEditMode ? null : searchParams.get("pr_id");
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [formData, setFormData] = useState<PurchaseOrderFormData>({
    supplier_id: "",
    pr_id: prId || undefined,
    tanggal_po: new Date().toISOString().split("T")[0],
    tanggal_kirim_estimasi: "",
    catatan: "",
    alamat_pengiriman: "",
    diskon_persen: 0,
    diskon_nominal: 0,
    ppn_persen: 11,
    source_type: "manual",
    production_order_id: null,
    source_reference: null,
    items: [],
  });
  const [items, setItems] = useState<POItemForm[]>([]);
  const itemsLocked = isEditMode;

  const getConversionFactor = useCallback((materialId: string, unitId?: string) => {
    if (!unitId) return 1;
    const material = materials.find((item) => item.id === materialId);
    const conversion = material?.unit_conversions?.find(
      (item) => item.satuan_id === unitId && item.is_active !== false
    );
    return Number(conversion?.qty_in_base_unit || 1);
  }, [materials]);

  const getUnitName = useCallback((unitId?: string) => {
    return units.find((unit) => unit.id === unitId)?.nama || "";
  }, [units]);

  const getMaterialUnitOptions = useCallback((
    materialId?: string,
    selected?: { unitId?: string; unitName?: string }
  ) => buildMaterialUnitOptions(materialId, materials, units, selected), [materials, units]);

  const findSupplierPrice = useCallback(async (supplierId: string, materialId: string) => {
    if (!supplierId || !materialId) return null;
    const response = await listPriceLists({ supplier_id: supplierId, raw_material_id: materialId, is_active: true });
    const priceLists = (Array.isArray(response) ? response : [response]).filter(Boolean) as SupplierPriceList[];

    return priceLists
      .filter((price) => Number(price.harga ?? price.price ?? 0) > 0 && (price.satuan_id || price.unit_id))
      .sort((a, b) => {
        if (a.is_preferred !== b.is_preferred) return a.is_preferred ? -1 : 1;
        return Number(a.harga ?? a.price ?? 0) - Number(b.harga ?? b.price ?? 0);
      })[0] || null;
  }, []);

  const findSupplierUnitPrice = useCallback(async (
    supplierId: string,
    materialId: string,
    targetUnitId?: string
  ) => {
    if (!supplierId || !materialId || !targetUnitId) return null;

    const response = await listPriceLists({ supplier_id: supplierId, raw_material_id: materialId, is_active: true });
    const priceLists = (Array.isArray(response) ? response : [response])
      .filter((price) => Number(price?.harga ?? price?.price ?? 0) > 0 && (price?.satuan_id || price?.unit_id)) as SupplierPriceList[];

    const sortedPrices = [...priceLists].sort((a, b) => {
      if (a.is_preferred !== b.is_preferred) return a.is_preferred ? -1 : 1;
      return Number(a.harga ?? a.price ?? 0) - Number(b.harga ?? b.price ?? 0);
    });
    const exactPrice = sortedPrices.find((price) => (price.satuan_id || price.unit_id) === targetUnitId);
    const sourcePrice = exactPrice || sortedPrices[0];
    if (!sourcePrice) return null;

    const sourceUnitId = sourcePrice.satuan_id || sourcePrice.unit_id;
    const sourceFactor = getConversionFactor(materialId, sourceUnitId);
    const targetFactor = getConversionFactor(materialId, targetUnitId);
    const unitPrice = Number(sourcePrice.harga ?? sourcePrice.price ?? 0);

    return {
      unitPrice: sourceFactor > 0 ? (unitPrice / sourceFactor) * targetFactor : unitPrice,
      isExact: Boolean(exactPrice),
    };
  }, [getConversionFactor]);

  const applySupplierPriceToItem = useCallback(async (item: POItemForm, supplierId: string): Promise<POItemForm> => {
    if (!supplierId || !item.raw_material_id) return item;

    try {
      const price = await findSupplierPrice(supplierId, item.raw_material_id);
      if (!price) return item;

      const priceUnitId = price.satuan_id || price.unit_id;
      const targetUnitId = item.source === "pr"
        ? item.requested_satuan_id || item.satuan_id || priceUnitId
        : priceUnitId;
      const requestedQty = Number(item.requested_qty ?? item.qty_ordered ?? 0);
      const shouldConvertQty = item.source === "prefill";
      const requestUnitId = item.requested_satuan_id || item.satuan_id || targetUnitId;
      const requestFactor = getConversionFactor(item.raw_material_id, requestUnitId);
      const targetFactor = getConversionFactor(item.raw_material_id, targetUnitId);
      const convertedQty = shouldConvertQty && targetFactor > 0
        ? (requestedQty * requestFactor) / targetFactor
        : Math.max(1, Number(item.qty_ordered || requestedQty || 1));
      const priceFactor = getConversionFactor(item.raw_material_id, priceUnitId);
      const supplierPrice = Number(price.harga ?? price.price ?? 0);
      const unitPrice = priceFactor > 0 ? (supplierPrice / priceFactor) * targetFactor : supplierPrice;

      return {
        ...item,
        satuan_id: targetUnitId,
        raw_material_unit: getUnitName(targetUnitId) || item.raw_material_unit,
        qty_ordered: convertedQty,
        harga_satuan: Math.round(unitPrice),
        subtotal: convertedQty * Math.round(unitPrice),
      };
    } catch (error) {
      console.error("Error applying supplier price:", error);
      return item;
    }
  }, [findSupplierPrice, getConversionFactor, getUnitName]);

  const applySupplierPrices = useCallback(async (supplierId: string, nextItems = items) => {
    if (!supplierId || nextItems.length === 0) return nextItems;
    const pricedItems = await Promise.all(nextItems.map((item) => applySupplierPriceToItem(item, supplierId)));
    setItems(pricedItems);
    return pricedItems;
  }, [applySupplierPriceToItem, items]);

  const applySupplierPricesForItems = useCallback(async (supplierId: string, nextItems: POItemForm[]) => {
    if (!supplierId || nextItems.length === 0) return nextItems;
    const pricedItems = await Promise.all(nextItems.map((item) => applySupplierPriceToItem(item, supplierId)));
    setItems(pricedItems);
    return pricedItems;
  }, [applySupplierPriceToItem]);

  // Auto-fill from URL query params (from Low Stock Report / Production shortage)
  useEffect(() => {
    if (prefillApplied || materials.length === 0 || units.length === 0) return;
    const itemsJson = searchParams.get("items");
    const materialCode = searchParams.get('material');
    const qty = searchParams.get('qty');
    const supplierName = searchParams.get('supplier');

    if (itemsJson) {
      try {
        const parsed = JSON.parse(itemsJson) as Array<{
          id?: string;
          kode?: string;
          qty?: number;
          price?: number;
          unit?: string;
        }>;
        const nextItems = parsed
          .map((prefill, index) => {
            const material =
              materials.find((m) => m.kode === prefill.kode) ||
              (prefill.id ? materials.find((m) => m.id === prefill.id) : undefined);
            if (!material) return null;
            const qtyOrdered = Math.max(0, Number(prefill.qty || 0));
            const unitPrice = Number(prefill.price ?? material.harga_terakhir ?? material.avg_cost ?? 0);
            const unitId = material.satuan_besar_id || material.satuan_kecil_id || "";
            const unitName =
              units.find((unit) => unit.id === unitId)?.nama ||
              material.satuan_besar_nama ||
              prefill.unit ||
              material.satuan ||
              "Unit";
            return {
              id: `prefill-${Date.now()}-${index}`,
              raw_material_id: material.id,
              qty_ordered: qtyOrdered,
              harga_satuan: unitPrice,
              subtotal: qtyOrdered * unitPrice,
              notes: "Production material requirement",
              raw_material_name: material.nama,
              raw_material_unit: unitName,
              satuan_id: unitId || undefined,
              requested_qty: qtyOrdered,
              requested_satuan_id: unitId || undefined,
              source: "prefill",
            } as POItemForm;
          })
          .filter(Boolean) as POItemForm[];

        if (nextItems.length > 0) {
          const productionOrderId = searchParams.get("production_order_id");
          const productionOrderNumber = searchParams.get("production_order");
          setItems(nextItems);
          setFormData((prev) => ({
            ...prev,
            source_type: searchParams.get("source") === "production" ? "production_order" : prev.source_type,
            production_order_id: productionOrderId || prev.production_order_id || null,
            source_reference: productionOrderNumber || prev.source_reference || null,
            catatan: productionOrderNumber
              ? `Kebutuhan bahan produksi ${productionOrderNumber}`
              : prev.catatan,
          }));
          setPrefillApplied(true);
          toast.success(`${nextItems.length} material produksi ditambahkan ke PO`);
          return;
        }
      } catch (error) {
        console.error("Failed to parse PO prefill items:", error);
      }
    }
    
    if (materialCode && qty && materials.length > 0) {
      // Find material by code
      const material = materials.find(m => m.kode === materialCode);
      if (material) {
        if (supplierName && suppliers.length > 0) {
          const supplier = suppliers.find(s => s.nama_supplier.includes(supplierName));
          if (supplier) {
            setFormData(prev => ({ ...prev, supplier_id: supplier.id }));
          }
        }
        
        // Add item to PO
        const unitId = material.satuan_besar_id || material.satuan_kecil_id || "";
        const unit = units.find((u) => u.id === unitId) || units.find((u) => u.nama === material.satuan);
        const newItem: POItemForm = {
          id: `temp-${Date.now()}`,
          raw_material_id: material.id,
          qty_ordered: parseInt(qty),
          harga_satuan: material.harga_terakhir || 0,
          subtotal: parseInt(qty) * (material.harga_terakhir || 0),
          notes: "",
          raw_material_name: material.nama,
          raw_material_unit: unit?.nama || material.satuan_besar_nama || material.satuan || "Pcs",
          satuan_id: unitId || unit?.id || undefined,
          requested_qty: parseInt(qty),
          requested_satuan_id: unitId || unit?.id || undefined,
          source: "prefill",
        };
        
        setItems([newItem]);
        setPrefillApplied(true);
        toast.success(`Material ${material.nama} ditambahkan ke PO (${qty} ${unit?.nama || 'pcs'})`);
      }
    }
  }, [searchParams, materials, suppliers, units, formData.supplier_id, prefillApplied]);

  const loadPRForPO = useCallback(async (id: string) => {
    setLoadingPR(true);
    try {
      const pr = await getPurchaseRequest(id);

      if (pr.status !== "approved" || pr.converted_po_id) {
        toast.error("Purchase request is not approved or already has a purchase order");
        setSelectedPR(null);
        return;
      }

      setSelectedPR(pr as PRForPO);
      setFormData((prev) => ({ ...prev, pr_id: id }));
      const mappedItems: POItemForm[] = (pr.items || []).map((item) => {
        const qty = Number(item.qty || 0);
        const price = Number(item.estimated_price || 0);
        const satuanId = resolveSatuanIdFromPrItem(item, materials, units);
        const unitName =
          item.satuan?.nama ||
          item.unit ||
          units.find((unit) => unit.id === satuanId)?.nama ||
          "";
        return {
          id: item.id,
          pr_item_id: item.id,
          raw_material_id: item.raw_material_id || "",
          satuan_id: satuanId,
          qty_ordered: qty,
          harga_satuan: price,
          notes: item.description || "",
          subtotal: qty * price,
          raw_material_name: item.raw_material?.nama || item.description || "",
          raw_material_unit: unitName,
          requested_qty: qty,
          requested_satuan_id: satuanId,
          source: "pr" as const,
        };
      });
      if (formData.supplier_id) {
        await applySupplierPricesForItems(formData.supplier_id, mappedItems);
      } else {
        setItems(mappedItems);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error loading PR:", error);
      toast.error(message || "Failed to load purchase request");
    } finally {
      setLoadingPR(false);
    }
  }, [applySupplierPricesForItems, formData.supplier_id, materials, units]);

  useEffect(() => {
    if (isEditMode) return;
    if (!prId) return;
    if (formDataQuery.isLoading || units.length === 0) return;
    loadPRForPO(prId);
  }, [isEditMode, loadPRForPO, prId, formDataQuery.isLoading, units.length]);

  useEffect(() => {
    if (!isEditMode || !existingPo || editPrefillDone) return;

    const normalizedStatus = String(existingPo.status || "").toLowerCase();
    if (normalizedStatus !== "draft") {
      toast.error("PO hanya bisa diedit saat status draft");
      router.replace(`/dashboard/purchasing/po/${poId}`);
      return;
    }

    setFormData({
      supplier_id: existingPo.supplier_id || "",
      pr_id: existingPo.pr_id || undefined,
      tanggal_po: existingPo.tanggal_po?.split("T")[0] || new Date().toISOString().split("T")[0],
      tanggal_kirim_estimasi: existingPo.tanggal_kirim_estimasi?.split("T")[0] || "",
      catatan: existingPo.catatan || "",
      alamat_pengiriman: existingPo.alamat_pengiriman || "",
      diskon_persen: Number(existingPo.diskon_persen || 0),
      diskon_nominal: Number(existingPo.diskon_nominal || 0),
      ppn_persen: Number(existingPo.ppn_persen ?? 11),
      source_type: existingPo.source_type || "manual",
      production_order_id: existingPo.production_order_id || null,
      source_reference: existingPo.source_reference || null,
      items: [],
    });

    const mappedItems = (existingPo.items || []).map(mapPOItemToForm);
    setItems(mappedItems);
    if (existingPo.pr_id) {
      setSelectedPR({
        id: existingPo.pr_id,
        pr_number: "Purchase Request terkait",
        status: "converted",
      });
    }
    setEditPrefillDone(true);
  }, [isEditMode, existingPo, editPrefillDone, poId, router]);

  useEffect(() => {
    if (formDataQuery.isError) {
      toast.error(`Failed to load data: ${getErrorMessage(formDataQuery.error, "Unknown error")}`);
    }
  }, [formDataQuery.isError, formDataQuery.error]);

  const clearSelectedPR = () => {
    setSelectedPR(null);
    setItems([]);
    setFormData((prev) => ({ ...prev, pr_id: undefined }));
    router.replace("/dashboard/purchasing/po/insert");
  };

  const handleSelectPR = (id: string) => {
    if (!id) {
      clearSelectedPR();
      return;
    }
    router.replace(`/dashboard/purchasing/po/insert?pr_id=${id}`);
    loadPRForPO(id);
  };

  const addItem = () => {
    setItems(prev => [
      ...prev,
      {
        id: `temp-${Date.now()}`,
        raw_material_id: "",
        qty_ordered: 1,
        harga_satuan: 0,
        subtotal: 0,
        notes: "",
        requested_qty: 1,
        source: "manual",
      },
    ]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const applyUnitPriceForItem = useCallback(async (item: POItemForm, supplierId: string, unitId?: string) => {
    if (!supplierId || !item.raw_material_id || !unitId) return item;

    try {
      const price = await findSupplierUnitPrice(supplierId, item.raw_material_id, unitId);
      if (!price) return item;

      return {
        ...item,
        satuan_id: unitId,
        raw_material_unit: getUnitName(unitId) || item.raw_material_unit,
        harga_satuan: Math.round(price.unitPrice),
        subtotal: Number(item.qty_ordered || 0) * Math.round(price.unitPrice),
      };
    } catch (error) {
      console.error("Error applying unit price:", error);
      return item;
    }
  }, [findSupplierUnitPrice, getUnitName]);

  const updateItem = (index: number, field: keyof POItemForm, value: POItemForm[keyof POItemForm]) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };

    // Recalculate subtotal
    if (field === "qty_ordered" || field === "harga_satuan") {
      const qty = Number(field === "qty_ordered" ? value : newItems[index].qty_ordered);
      const price = Number(field === "harga_satuan" ? value : newItems[index].harga_satuan);
      newItems[index].subtotal = qty * price;
      if (field === "qty_ordered") {
        newItems[index].requested_qty = qty;
      }
    }

    if (field === "satuan_id") {
      newItems[index].requested_satuan_id = String(value || "");
      newItems[index].raw_material_unit = getUnitName(String(value || "")) || newItems[index].raw_material_unit;
    }

    // Update material info
    if (field === "raw_material_id") {
      const material = materials.find((m) => m.id === value);
      const unitId = material?.satuan_besar_id || "";
      newItems[index].raw_material_name = material?.nama;
      newItems[index].raw_material_unit = getUnitName(unitId) || material?.satuan_besar_nama || material?.satuan;
      newItems[index].satuan_id = unitId || undefined;
      newItems[index].requested_satuan_id = unitId || undefined;
    }

    setItems(newItems);

    if (field === "raw_material_id" && formData.supplier_id && String(value)) {
      applySupplierPriceToItem(newItems[index], formData.supplier_id).then((pricedItem) => {
        setItems((current) => current.map((item, itemIndex) => itemIndex === index ? pricedItem : item));
      });
    }

    if (field === "satuan_id" && formData.supplier_id && String(value)) {
      applyUnitPriceForItem(newItems[index], formData.supplier_id, String(value)).then((pricedItem) => {
        setItems((current) => current.map((item, itemIndex) => itemIndex === index ? pricedItem : item));
      });
    }
  };

  const calculateTotals = () => {
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const diskonNominal = formData.diskon_persen
      ? (subtotal * formData.diskon_persen) / 100
      : formData.diskon_nominal || 0;
    const afterDiskon = subtotal - diskonNominal;
    const ppnNominal = (afterDiskon * (formData.ppn_persen || 11)) / 100;
    const total = afterDiskon + ppnNominal;

    return { subtotal, diskonNominal, ppnNominal, total };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.supplier_id) {
      toast.error("Select a supplier first");
      return;
    }
    if (items.length === 0) {
      toast.error("Tambahkan minimal 1 item");
      return;
    }
    const invalidItem = items.find((item) => !item.raw_material_id || item.qty_ordered <= 0 || item.harga_satuan < 0);
    if (invalidItem) {
      toast.error("Lengkapi bahan baku, jumlah, dan harga untuk semua item");
      return;
    }

    try {
      if (isEditMode && poId) {
        setIsSaving(true);

        await updatePurchaseOrder(poId, {
          supplier_id: formData.supplier_id,
          tanggal_po: formData.tanggal_po,
          tanggal_kirim_estimasi: formData.tanggal_kirim_estimasi || undefined,
          catatan: formData.catatan || undefined,
          alamat_pengiriman: formData.alamat_pengiriman || undefined,
          diskon_persen: formData.diskon_persen,
          diskon_nominal: formData.diskon_nominal,
          ppn_persen: formData.ppn_persen,
        });

        toast.success("PO berhasil disubmit");
        router.push(`/dashboard/purchasing/po/${poId}?updated=1`);
        return;
      }

      const payload: PurchaseOrderFormData = {
        ...formData,
        pr_id: formData.pr_id || undefined,
        tanggal_kirim_estimasi: formData.tanggal_kirim_estimasi || "",
        items: items.map((item) => ({
          raw_material_id: item.raw_material_id,
          pr_item_id: item.pr_item_id,
          satuan_id: item.satuan_id,
          qty_ordered: Number(item.qty_ordered || 0),
          harga_satuan: Number(item.harga_satuan || 0),
          notes: item.notes || "",
        })),
      };
      const po = await createMutation.mutateAsync(payload);

      toast.success("PO berhasil dibuat");
      router.push(`/dashboard/purchasing/po/${po.id}`);
    } catch (error: unknown) {
      const typedError = error as FetchError;
      console.error(isEditMode ? "Error updating PO:" : "Error creating PO:", error);

      if (typedError.response) {
        try {
          const errorData = await typedError.response.json();
          if (errorData.errors && Object.keys(errorData.errors).length > 0) {
            const errorMessages = Object.entries(errorData.errors)
              .map(([field, messages]) => `${field}: ${(messages as string[]).join(", ")}`)
              .join("\n");
            toast.error(`Validation failed:\n${errorMessages}`);
          } else {
            toast.error(errorData.message || (isEditMode ? "Failed to update purchase order" : "Failed to create purchase order"));
          }
        } catch {
          toast.error(isEditMode ? "Failed to update purchase order" : "Failed to create purchase order");
        }
      } else {
        toast.error(getErrorMessage(error, isEditMode ? "Failed to update purchase order" : "Failed to create purchase order"));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const { subtotal, diskonNominal, ppnNominal, total } = calculateTotals();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-500">
        Loading purchase order form...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={isEditMode && poId ? `/dashboard/purchasing/po/${poId}` : "/dashboard/purchasing/po"}
        title={isEditMode ? `Edit ${existingPo?.nomor_po || "Purchase Order"}` : "Create Purchase Order"}
        description={
          isEditMode
            ? "Update draft purchase order information. Items cannot be changed."
            : selectedPR
              ? `From purchase request ${selectedPR.pr_number} — items can be adjusted before submitting`
              : "Create a manual purchase order or select an approved purchase request as reference"
        }
      />

      {!isEditMode && (
      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Purchase Request Source</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {selectedPR ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{selectedPR.pr_number}</span>
                  <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                    {selectedPR.status}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {selectedPR.department_name || selectedPR.department?.name || "-"} · {selectedPR.items?.length || 0} item
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => router.push(`/dashboard/purchasing/pr/${selectedPR.id}`)}>
                  View Purchase Request
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={clearSelectedPR}
                  className="gap-2"
                >
                  <X className="h-4 w-4" />
                  Clear
                </Button>
              </div>
            </div>
          ) : (
            <div className="min-w-0 space-y-1.5">
              <Label className="text-xs">Select Approved Purchase Request</Label>
              <Combobox
                options={approvedPrs.map((pr) => ({
                  value: pr.id,
                  label: pr.pr_number,
                  description: `${pr.department_name || pr.department?.name || "-"} · ${pr.items?.length || 0} item${(pr.items?.length || 0) === 1 ? "" : "s"}`,
                }))}
                value={formData.pr_id || ""}
                onChange={handleSelectPR}
                placeholder="Select an approved purchase request without a purchase order..."
                searchPlaceholder="Search purchase request number or department..."
                emptyMessage="No approved purchase requests ready for purchase order creation"
                allowClear
                disabled={loading || loadingPR}
                className="w-full! h-9 text-sm"
              />
              <p className="text-xs text-gray-500">
                Only approved purchase requests without a purchase order are shown. You can still create a manual purchase order without a purchase request.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {isEditMode && formData.pr_id && selectedPR && (
        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Purchase Request Source</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{selectedPR.pr_number}</span>
                <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Purchase Request</Badge>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`/dashboard/purchasing/pr/${selectedPR.id}`)}
              >
                View Purchase Request
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <form id="purchase-order-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <Card className="border-gray-200/70 shadow-xs xl:col-span-8">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4" />
                Purchase Order Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs">
                  Supplier <span className="text-red-500">*</span>
                </Label>
                <Combobox
                  options={suppliers.map((supplier) => ({
                    value: supplier.id,
                    label: supplier.nama_supplier,
                    description: supplier.kode_supplier,
                  }))}
                  value={formData.supplier_id}
                  onChange={(value) => {
                    setFormData((prev) => ({ ...prev, supplier_id: value }));
                    if (value) {
                      applySupplierPrices(value);
                    }
                  }}
                  placeholder="Select supplier..."
                  searchPlaceholder="Search supplier..."
                  emptyMessage="No supplier found"
                  allowClear
                  disabled={loading}
                  className="w-full! h-9 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <DsDateTimePicker
                  label="Purchase Order Date"
                  value={formData.tanggal_po}
                  onChange={(value) => setFormData((prev) => ({ ...prev, tanggal_po: value }))}
                  placeholder="Select purchase order date..."
                  dateOnly
                />
                <DsDateTimePicker
                  label="Estimated Delivery Date"
                  value={formData.tanggal_kirim_estimasi}
                  onChange={(value) =>
                    setFormData((prev) => ({ ...prev, tanggal_kirim_estimasi: value }))
                  }
                  placeholder="Select estimated delivery date..."
                  dateOnly
                />
              </div>

              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs">Notes</Label>
                <Textarea
                  value={formData.catatan}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, catatan: e.target.value }))
                  }
                  placeholder="Notes for supplier..."
                  rows={2}
                  className="resize-none text-sm"
                />
              </div>

              <div className="min-w-0 space-y-1.5">
                <Label className="text-xs">Delivery Address</Label>
                <Textarea
                  value={formData.alamat_pengiriman}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      alamat_pengiriman: e.target.value,
                    })
                  }
                  placeholder="Delivery address..."
                  rows={2}
                  className="resize-none text-sm"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs xl:col-span-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-medium text-gray-900">
                  {formatAmount(subtotal)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Discount</span>
                <span className="font-medium text-gray-900">
                  {formatAmount(diskonNominal)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">PPN ({formData.ppn_persen}%)</span>
                <span className="font-medium text-gray-900">
                  {formatAmount(ppnNominal)}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-200/70 pt-3 text-lg font-semibold text-gray-900">
                <span>Total</span>
                <span>{formatAmount(total)}</span>
              </div>

              <div className="grid grid-cols-1 gap-3 border-t border-gray-200/70 pt-4 sm:grid-cols-2 xl:grid-cols-1">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs">Discount (%)</Label>
                  <div className="flex rounded-lg border border-gray-200/80 bg-white focus-within:border-gray-300 focus-within:ring-1 focus-within:ring-gray-200">
                    <NumericInput
                      min="0"
                      max="100"
                      value={formData.diskon_persen}
                      decimalScale={2}
                      onValueChange={(value) =>
                        setFormData({
                          ...formData,
                          diskon_persen: Math.min(100, Math.max(0, value || 0)),
                          diskon_nominal: 0,
                        })
                      }
                      className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    <div className="flex min-w-10 items-center justify-center rounded-r-lg border-l border-gray-200/80 bg-gray-50 px-3 text-xs font-medium text-gray-500">
                      %
                    </div>
                  </div>
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs">PPN (%)</Label>
                  <div className="flex rounded-lg border border-gray-200/80 bg-white focus-within:border-gray-300 focus-within:ring-1 focus-within:ring-gray-200">
                    <NumericInput
                      min="0"
                      max="100"
                      value={formData.ppn_persen}
                      decimalScale={2}
                      onValueChange={(value) =>
                        setFormData({
                          ...formData,
                          ppn_persen: Math.min(100, Math.max(0, value || 0)),
                        })
                      }
                      className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    <div className="flex min-w-10 items-center justify-center rounded-r-lg border-l border-gray-200/80 bg-gray-50 px-3 text-xs font-medium text-gray-500">
                      %
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">Purchase Order Items</CardTitle>
            {!isEditMode && (
              <Button type="button" onClick={addItem} variant="outline" size="sm" className="purchasing-secondary-button w-full sm:w-auto">
                <Plus className="mr-1 h-4 w-4" />
                Add Item
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item, index) => (
              <div
                key={item.id}
                className="rounded-xl border border-gray-200/70 bg-white/70 p-4"
              >
                <div className="mb-4 flex items-center justify-between border-b border-gray-200/70 pb-3">
                  <p className="text-sm font-medium text-gray-900">Item #{index + 1}</p>
                  {!itemsLocked && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(index)}
                      className="h-8 text-red-500 hover:text-red-600"
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Remove
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                  <div className="min-w-0 space-y-1.5 lg:col-span-4">
                    <Label className="text-xs">
                      Raw Material <span className="text-red-500">*</span>
                    </Label>
                    <Combobox
                      options={materials.map((m) => ({
                        value: m.id,
                        label: m.nama,
                        description: m.kode,
                      }))}
                      value={item.raw_material_id}
                      onChange={(v) => updateItem(index, "raw_material_id", v)}
                      placeholder="Select raw material..."
                      searchPlaceholder="Search raw material (name/code)..."
                      emptyMessage="No raw material found"
                      allowClear
                      disabled={loading || itemsLocked}
                      className="w-full! h-9 text-sm"
                    />
                  </div>

                  <div className="min-w-0 space-y-1.5 lg:col-span-2">
                    <Label className="text-xs">Quantity</Label>
                    <NumericInput
                      min="0"
                      value={item.qty_ordered > 0 ? item.qty_ordered : null}
                      decimalScale={4}
                      placeholder="0"
                      disabled={itemsLocked}
                      onFocus={(event) => event.currentTarget.select()}
                      onValueChange={(value) => updateItem(index, "qty_ordered", value || 0)}
                      className="h-9 text-sm"
                    />
                  </div>

                  <div className="min-w-0 space-y-1.5 lg:col-span-2">
                    <Label className="text-xs">Unit</Label>
                    <Combobox
                      options={getMaterialUnitOptions(item.raw_material_id, {
                        unitId: item.satuan_id,
                        unitName: item.raw_material_unit,
                      })}
                      value={item.satuan_id || ""}
                      onChange={(value) => updateItem(index, "satuan_id", value || undefined)}
                      placeholder={item.raw_material_id ? "Select unit..." : "Select raw material first"}
                      searchPlaceholder="Search unit..."
                      emptyMessage={
                        item.raw_material_id
                          ? "No units configured for this material"
                          : "Select a raw material first"
                      }
                      allowClear={false}
                      disabled={loading || itemsLocked}
                      className="w-full! h-9 text-sm"
                    />
                  </div>

                  <div className="min-w-0 space-y-1.5 lg:col-span-2">
                    <Label className="text-xs">Unit Price</Label>
                    <NumericInput
                      min="0"
                      value={item.harga_satuan}
                      decimalScale={0}
                      disabled={itemsLocked}
                      onValueChange={(value) => updateItem(index, "harga_satuan", value || 0)}
                      className="h-9 text-sm"
                    />
                  </div>

                  <div className="min-w-0 rounded-lg bg-gray-50/80 p-3 lg:col-span-2">
                    <p className="text-xs text-gray-500">Subtotal</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {formatAmount(item.subtotal)}
                    </p>
                  </div>
                </div>
              </div>
            ))}

            {items.length === 0 && (
              <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 py-10 text-center text-sm text-gray-500">
                No items yet. Click &quot;Add Item&quot; to get started.
              </div>
            )}
          </CardContent>
        </Card>

        <PurchasingFormFooter
          onCancel={() =>
            router.push(isEditMode && poId ? `/dashboard/purchasing/po/${poId}` : "/dashboard/purchasing/po")
          }
          submitLabel="Submit"
          loading={isSubmitting}
          disabled={isSubmitting}
          formId="purchase-order-form"
        />
      </form>
    </div>
  );
}
