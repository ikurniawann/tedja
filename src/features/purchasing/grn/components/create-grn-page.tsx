"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { NumericInput } from "@/components/ui/numeric-input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { listGrnDeliveries, getGrnPOItems, getGrnPO, listWarehouses, getReceivingUserScope } from "../api";
import type { ReceivingUserScope } from "../api";
import { useCreateGrn } from "../mutations";
import { DsDateTimePicker } from "@/components/design-system";
import {
  ArrowLeftIcon,
  ClipboardCheck,
  Package,
  TruckIcon,
  Info,
  Loader2Icon,
  SaveIcon,
} from "lucide-react";

interface Delivery {
  id: string;
  no_resi: string;
  nomor_resi: string;
  no_surat_jalan: string;
  kurir: string;
  ekspedisi?: string;
  status: string;
  purchase_order_id: string;
  supplier_id: string;
  tanggal_kirim: string;
  tanggal_estimasi_tiba: string;
  supplier_name?: string;
  po_number?: string;
  po_id?: string;
  branch_id?: string;
}

interface Warehouse {
  id: string;
  name: string;
  code: string;
}

interface POItem {
  id: string;
  raw_material_id: string;
  nama_bahan: string;
  qty_ordered: number;
  qty_received: number;
  satuan?: string;
}

type ApiUnit = string | {
  nama?: string;
  nama_satuan?: string;
  kode?: string;
} | null;

type POItemApiRow = {
  id: string;
  raw_material_id: string;
  nama_bahan?: string;
  qty_ordered?: number | string | null;
  qty_received?: number | string | null;
  raw_material?: {
    nama?: string;
    nama_bahan?: string;
  } | null;
  satuan?: ApiUnit;
  unit?: ApiUnit;
};

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getUnitName(unit?: ApiUnit, fallback = "pcs") {
  if (!unit) return fallback;
  if (typeof unit === "string") return unit || fallback;
  return unit.nama || unit.nama_satuan || unit.kode || fallback;
}

function getMaterialName(
  rawMaterial?: POItemApiRow["raw_material"],
  fallback = "Unknown"
) {
  if (!rawMaterial) return fallback;
  return rawMaterial.nama || rawMaterial.nama_bahan || fallback;
}

function calculateReceiptQuantities(acceptQty: number, remainingQty: number) {
  const accept = Math.max(0, Math.min(toNumber(acceptQty), remainingQty));
  const reject = Math.max(0, remainingQty - accept);
  return { accept, reject };
}

function getRemainingQty(poItem?: POItem) {
  if (!poItem) return 0;
  return Math.max(0, toNumber(poItem.qty_ordered) - toNumber(poItem.qty_received));
}

function mapPOItem(item: POItemApiRow): POItem {
  return {
    id: item.id,
    raw_material_id: item.raw_material_id,
    nama_bahan: item.nama_bahan || getMaterialName(item.raw_material),
    qty_ordered: toNumber(item.qty_ordered),
    qty_received: toNumber(item.qty_received),
    satuan: getUnitName(item.satuan || item.unit),
  };
}

interface GrnItem {
  id: string;
  purchase_order_item_id: string;
  raw_material_id: string;
  nama_bahan: string;
  qty_diterima: number;
  qty_ditolak: number;
  catatan: string;
}

const GUIDELINES = [
  "Select a delivery that has not been received yet.",
  "Destination warehouse and receipt date are required.",
  "Accepted quantity cannot exceed the remaining purchase order quantity.",
  "Any shortfall is automatically moved to the reject column.",
];

export function CreateGrnPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const createMutation = useCreateGrn();
  const loading = createMutation.isPending;
  const [fetchingDeliveries, setFetchingDeliveries] = useState(true);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);
  const [poItems, setPoItems] = useState<POItem[]>([]);
  const [grnItems, setGrnItems] = useState<GrnItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [fetchingWarehouses, setFetchingWarehouses] = useState(false);
  const [resolvedBranchId, setResolvedBranchId] = useState<string | null>(null);
  const [contextBranchResolved, setContextBranchResolved] = useState(false);
  const [userScope, setUserScope] = useState<ReceivingUserScope | null>(null);
  const [formData, setFormData] = useState({
    delivery_id: "",
    warehouse_id: "",
    tanggal_penerimaan: new Date().toISOString().split("T")[0],
    catatan: "",
  });

  const fetchDeliveries = useCallback(async () => {
    setFetchingDeliveries(true);
    try {
      const data = await listGrnDeliveries<Partial<Delivery> & {
        po_id?: string;
        branch_id?: string;
        delivery_number?: string;
        ekspedisi?: string;
        vendor_name?: string;
      }>();
      if (Array.isArray(data)) {
        const enhanced = data.map((d) => ({
          id: d.id!,
          no_resi: d.no_resi || d.nomor_resi || d.delivery_number || "",
          nomor_resi: d.nomor_resi || d.no_resi || d.delivery_number || "",
          no_surat_jalan: d.no_surat_jalan || "",
          kurir: d.kurir || d.ekspedisi || d.vendor_name || "",
          status: d.status || "pending",
          purchase_order_id: d.purchase_order_id || d.po_id || "",
          po_id: d.po_id || d.purchase_order_id || "",
          supplier_id: d.supplier_id || "",
          branch_id: d.branch_id || undefined,
          tanggal_kirim: d.tanggal_kirim || "",
          tanggal_estimasi_tiba: d.tanggal_estimasi_tiba || "",
          supplier_name: d.supplier_name || d.kurir || d.ekspedisi || d.no_surat_jalan || d.no_resi || "Unknown",
          po_number: d.po_number || d.nomor_resi || d.no_resi || "",
        })) as Delivery[];
        setDeliveries(enhanced);
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to load deliveries.");
    } finally {
      setFetchingDeliveries(false);
    }
  }, []);

  useEffect(() => {
    fetchDeliveries();
  }, [fetchDeliveries]);

  useEffect(() => {
    getReceivingUserScope()
      .then(setUserScope)
      .catch((error) => {
        console.error("Error fetching user scope:", error);
        toast.error("Failed to load user branch scope.");
      });
  }, []);

  const warehouseBranchId = useMemo(() => {
    if (!userScope) return null;
    const isBranchUser =
      !userScope.is_unscoped &&
      userScope.business_scope === "branch" &&
      userScope.branch_id;
    if (isBranchUser) return userScope.branch_id;
    return resolvedBranchId;
  }, [userScope, resolvedBranchId]);

  useEffect(() => {
    const deliveryId = searchParams.get("delivery_id");
    if (!deliveryId || fetchingDeliveries) return;

    const delivery = deliveries.find((item) => item.id === deliveryId);
    if (delivery) {
      setSelectedDelivery(delivery);
      setFormData((prev) => ({ ...prev, delivery_id: delivery.id, warehouse_id: "" }));
      return;
    }

    if (deliveries.length > 0 || !fetchingDeliveries) {
      toast.error("This delivery already has a goods receipt or is not eligible.");
    }
  }, [deliveries, searchParams, fetchingDeliveries]);

  const fetchPOItems = useCallback(async (poId: string) => {
    try {
      const data = await getGrnPOItems<POItemApiRow>(poId);
      const rows = Array.isArray(data) && data.length > 0
        ? data
        : (await getGrnPO<{ items?: POItemApiRow[] }>(poId))?.items || [];

      if (!Array.isArray(rows) || rows.length === 0) {
        setPoItems([]);
        setGrnItems([]);
        return;
      }

      const simplifiedPoItems = rows.map(mapPOItem);
      setPoItems(simplifiedPoItems);
      setGrnItems(
        simplifiedPoItems.map((item) => {
          const remaining = Math.max(0, item.qty_ordered - item.qty_received);
          return {
            id: crypto.randomUUID(),
            purchase_order_item_id: item.id,
            raw_material_id: item.raw_material_id,
            nama_bahan: item.nama_bahan,
            qty_diterima: remaining,
            qty_ditolak: 0,
            catatan: "",
          };
        })
      );
    } catch (error) {
      console.error(error);
      toast.error("Failed to load purchase order items.");
    }
  }, []);

  useEffect(() => {
    const poId = selectedDelivery?.purchase_order_id;
    if (poId) {
      fetchPOItems(poId);
    } else {
      setPoItems([]);
      setGrnItems([]);
    }
  }, [fetchPOItems, selectedDelivery]);

  useEffect(() => {
    if (!selectedDelivery) {
      setResolvedBranchId(null);
      setContextBranchResolved(false);
      return;
    }

    const isBranchUser =
      userScope &&
      !userScope.is_unscoped &&
      userScope.business_scope === "branch" &&
      userScope.branch_id;

    if (isBranchUser) {
      setContextBranchResolved(true);
      return;
    }

    if (selectedDelivery.branch_id) {
      setResolvedBranchId(selectedDelivery.branch_id);
      setContextBranchResolved(true);
      return;
    }

    setResolvedBranchId(null);

    const poId = selectedDelivery.purchase_order_id;
    if (!poId) {
      setContextBranchResolved(true);
      return;
    }

    let cancelled = false;
    setContextBranchResolved(false);
    getGrnPO<{ branch_id?: string | null }>(poId)
      .then((po) => {
        if (!cancelled) {
          setResolvedBranchId(po?.branch_id ?? null);
          setContextBranchResolved(true);
        }
      })
      .catch((error) => {
        console.error("Error resolving branch from purchase order:", error);
        if (!cancelled) {
          setResolvedBranchId(null);
          setContextBranchResolved(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDelivery, userScope]);

  useEffect(() => {
    if (!selectedDelivery || userScope === null) {
      setWarehouses([]);
      return;
    }

    const isBranchUser =
      !userScope.is_unscoped &&
      userScope.business_scope === "branch" &&
      Boolean(userScope.branch_id);

    if (!isBranchUser && !contextBranchResolved) {
      return;
    }

    setFetchingWarehouses(true);
    listWarehouses(warehouseBranchId ?? undefined)
      .then((data) => {
        setWarehouses(data);
        if (data.length === 1) {
          setFormData((prev) => ({ ...prev, warehouse_id: data[0].id }));
        }
      })
      .catch((error) => {
        console.error("Error fetching warehouses:", error);
        toast.error("Failed to load warehouses.");
      })
      .finally(() => setFetchingWarehouses(false));
  }, [selectedDelivery, userScope, warehouseBranchId, contextBranchResolved]);

  const handleUpdateAcceptedQty = (id: string, acceptQty: number) => {
    setGrnItems((items) =>
      items.map((item) => {
        if (item.id !== id) return item;
        const poItem = poItems.find((p) => p.id === item.purchase_order_item_id);
        const remaining = getRemainingQty(poItem);
        const { accept, reject } = calculateReceiptQuantities(acceptQty, remaining);
        return { ...item, qty_diterima: accept, qty_ditolak: reject };
      })
    );
  };

  const totalAccepted = useMemo(
    () => grnItems.reduce((sum, item) => sum + Number(item.qty_diterima || 0), 0),
    [grnItems]
  );

  const totalRejected = useMemo(
    () => grnItems.reduce((sum, item) => sum + Number(item.qty_ditolak || 0), 0),
    [grnItems]
  );

  const canSubmit =
    Boolean(formData.delivery_id) &&
    Boolean(formData.warehouse_id) &&
    Boolean(formData.tanggal_penerimaan) &&
    grnItems.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.delivery_id) {
      toast.error("Please select a delivery first.");
      return;
    }

    if (!formData.warehouse_id) {
      toast.error("Please select a destination warehouse.");
      return;
    }

    if (!formData.tanggal_penerimaan) {
      toast.error("Receipt date is required.");
      return;
    }

    if (grnItems.length === 0) {
      toast.error("At least one item is required.");
      return;
    }

    const hasAcceptedQty = grnItems.some((item) => Number(item.qty_diterima || 0) > 0);
    if (!hasAcceptedQty) {
      toast.error("Enter accepted quantity for at least one item.");
      return;
    }

    try {
      const result = (await createMutation.mutateAsync({
        delivery_id: formData.delivery_id,
        warehouse_id: formData.warehouse_id,
        tanggal_penerimaan: formData.tanggal_penerimaan,
        catatan: formData.catatan || undefined,
        items: grnItems.map((item) => ({
          purchase_order_item_id: item.purchase_order_item_id,
          raw_material_id: item.raw_material_id,
          qty_diterima: Number(item.qty_diterima) || 0,
          qty_ditolak: Number(item.qty_ditolak) || 0,
          kondisi: "baik" as const,
          catatan: item.catatan || undefined,
        })),
      })) as { data?: { id?: string } };

      const createdId = result?.data?.id;
      toast.success("Goods receipt created. Proceed to quality control.");
      if (createdId) {
        router.push(`/dashboard/purchasing/grn/${createdId}/qc`);
      } else {
        router.push("/dashboard/purchasing/grn");
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to create goods receipt.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Link href="/dashboard/purchasing/grn">
            <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
              <ArrowLeftIcon className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Record Goods Receipt</h1>
            <p className="text-sm text-gray-500">
              Confirm received items from the selected delivery. Stock is posted after quality control.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TruckIcon className="h-4 w-4" />
                  Receipt Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs">
                    Delivery <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={deliveries.map((delivery) => ({
                      value: delivery.id,
                      label: delivery.no_resi || delivery.nomor_resi || delivery.no_surat_jalan,
                      description: `${delivery.supplier_name || delivery.kurir || "-"} · ${delivery.po_number || delivery.no_surat_jalan || "-"}`,
                    }))}
                    value={formData.delivery_id}
                    onChange={(value) => {
                      const delivery = deliveries.find((item) => item.id === value) || null;
                      setSelectedDelivery(delivery);
                      setFormData((prev) => ({ ...prev, delivery_id: value, warehouse_id: "" }));
                    }}
                    placeholder={fetchingDeliveries ? "Loading deliveries..." : "Select delivery"}
                    searchPlaceholder="Search tracking number or delivery note..."
                    emptyMessage="No eligible deliveries found"
                    allowClear
                    disabled={fetchingDeliveries}
                    className="w-full! h-9 text-sm"
                  />
                </div>

                {selectedDelivery && (
                  <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200/70 bg-gray-50/60 p-4 text-sm md:grid-cols-2">
                    <div>
                      <p className="text-xs text-gray-500">Tracking Number</p>
                      <p className="font-medium text-gray-900">{selectedDelivery.no_resi || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Delivery Note Number</p>
                      <p className="font-medium text-gray-900">{selectedDelivery.no_surat_jalan || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Courier</p>
                      <p className="font-medium text-gray-900">{selectedDelivery.kurir || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Status</p>
                      <Badge variant="outline" className="mt-1 font-medium capitalize">
                        {selectedDelivery.status}
                      </Badge>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <Label className="text-xs">
                      Destination Warehouse <span className="text-red-500">*</span>
                    </Label>
                    <Combobox
                      options={warehouses.map((warehouse) => ({
                        value: warehouse.id,
                        label: warehouse.name,
                        description: warehouse.code,
                      }))}
                      value={formData.warehouse_id}
                      onChange={(value) =>
                        setFormData((prev) => ({ ...prev, warehouse_id: value }))
                      }
                      placeholder={fetchingWarehouses ? "Loading warehouses..." : "Select destination warehouse"}
                      searchPlaceholder="Search warehouse..."
                      emptyMessage={fetchingWarehouses ? "Loading..." : "No warehouse found"}
                      allowClear
                      disabled={!selectedDelivery || fetchingWarehouses}
                      className="w-full! h-9 text-sm"
                    />
                  </div>

                  <DsDateTimePicker
                    label="Receipt Date"
                    value={formData.tanggal_penerimaan}
                    onChange={(value) =>
                      setFormData((prev) => ({ ...prev, tanggal_penerimaan: value }))
                    }
                    placeholder="Select receipt date..."
                    dateOnly
                    required
                    disabled={!selectedDelivery}
                  />
                </div>

                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="catatan" className="text-xs">
                    Notes
                  </Label>
                  <Textarea
                    id="catatan"
                    value={formData.catatan || ""}
                    onChange={(e) => setFormData((prev) => ({ ...prev, catatan: e.target.value }))}
                    placeholder="Add notes if needed..."
                    rows={3}
                    className="resize-none text-sm"
                    disabled={!selectedDelivery}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardCheck className="h-4 w-4" />
                  Confirm Received Items
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {!selectedDelivery ? (
                  <div className="py-12 text-center text-sm text-gray-500">
                    Select a delivery to load purchase order items automatically.
                  </div>
                ) : grnItems.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-sm text-gray-500">
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                    Loading purchase order items...
                  </div>
                ) : (
                  <div className="p-4">
                    <div className="overflow-x-auto rounded-xl border border-gray-200/70">
                      <table className="w-full table-fixed border-collapse text-sm [&_td]:border [&_td]:border-gray-200/70 [&_th]:border [&_th]:border-gray-200/70">
                        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                          <tr>
                            <th className="px-4 py-3 text-left font-semibold">Raw Material</th>
                            <th className="w-[72px] px-2 py-3 text-center font-semibold">Ordered</th>
                            <th className="w-[72px] px-2 py-3 text-center font-semibold">Received</th>
                            <th className="w-[84px] px-2 py-3 text-center font-semibold">Remaining</th>
                            <th className="w-[104px] px-1.5 py-3 text-center font-semibold">Accept</th>
                            <th className="w-[104px] px-1.5 py-3 text-center font-semibold">Reject</th>
                          </tr>
                        </thead>
                        <tbody>
                          {grnItems.map((item) => {
                            const poItem = poItems.find((p) => p.id === item.purchase_order_item_id);
                            const qtyOrdered = toNumber(poItem?.qty_ordered);
                            const qtyReceived = toNumber(poItem?.qty_received);
                            const qtyRemaining = getRemainingQty(poItem);
                            const satuan = poItem?.satuan || "pcs";

                            return (
                              <tr key={item.id} className="bg-white hover:bg-gray-50/80">
                                <td className="px-4 py-3 align-top">
                                  <div className="font-medium text-gray-900">{item.nama_bahan}</div>
                                  {qtyOrdered > 0 && (
                                    <div className="mt-0.5 text-xs text-gray-500">
                                      Purchase Order: {qtyOrdered} {satuan}
                                    </div>
                                  )}
                                </td>
                                <td className="px-2 py-3 text-center align-middle text-gray-700">
                                  {qtyOrdered}
                                </td>
                                <td className="px-2 py-3 text-center align-middle text-gray-700">
                                  {qtyReceived}
                                </td>
                                <td className="px-2 py-3 text-center align-middle font-semibold text-pink-700">
                                  {qtyRemaining}
                                </td>
                                <td className="px-1.5 py-1.5 align-middle">
                                  <NumericInput
                                    min="0"
                                    max={qtyRemaining || undefined}
                                    value={item.qty_diterima}
                                    onValueChange={(value) =>
                                      handleUpdateAcceptedQty(item.id, value || 0)
                                    }
                                    decimalScale={4}
                                    className="h-9 w-full border-gray-200/80 bg-white px-2 text-center text-sm focus-visible:border-pink-300 focus-visible:ring-1 focus-visible:ring-pink-200/80"
                                  />
                                </td>
                                <td className="px-1.5 py-1.5 align-middle">
                                  <div
                                    className={`flex h-9 w-full items-center justify-center rounded-lg border border-gray-200/80 bg-gray-50 px-2 text-sm font-medium ${
                                      item.qty_ditolak > 0 ? "text-red-600" : "text-gray-700"
                                    }`}
                                  >
                                    {item.qty_ditolak}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="xl:col-span-4">
            <Card className="border-gray-200/70 shadow-xs xl:sticky xl:top-6">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="text-base">Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                {selectedDelivery ? (
                  <dl className="space-y-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-gray-500">Purchase Order</dt>
                      <dd className="text-right font-medium text-gray-900">
                        {selectedDelivery.po_number || "-"}
                      </dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-gray-500">Supplier</dt>
                      <dd className="text-right font-medium text-gray-900">
                        {selectedDelivery.supplier_name || "-"}
                      </dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-gray-500">Items</dt>
                      <dd className="text-right font-medium text-gray-900">{grnItems.length}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3 border-t border-gray-200/70 pt-3">
                      <dt className="font-medium text-gray-900">Total Rejected</dt>
                      <dd className={`text-right font-semibold ${totalRejected > 0 ? "text-red-600" : "text-gray-900"}`}>
                        {totalRejected}
                      </dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt className="font-medium text-gray-900">Total Accepted</dt>
                      <dd className="text-right font-semibold text-gray-900">{totalAccepted}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-gray-500">
                    Select a delivery to preview receipt details.
                  </p>
                )}

                <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
                    <Info className="h-4 w-4 text-pink-600" />
                    Guidelines
                  </div>
                  <ul className="space-y-2 text-xs leading-5 text-gray-600">
                    {GUIDELINES.map((line) => (
                      <li key={line} className="flex gap-2">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {grnItems.length > 0 && (
                  <div className="rounded-xl border border-gray-200/70 bg-white p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
                      <Package className="h-4 w-4 text-pink-600" />
                      Item Preview
                    </div>
                    <ul className="space-y-2 text-xs text-gray-600">
                      {grnItems.slice(0, 4).map((item) => (
                        <li key={item.id} className="flex items-center justify-between gap-3">
                          <span className="truncate">{item.nama_bahan}</span>
                          <span className="shrink-0 font-medium text-gray-900">
                            {item.qty_diterima}
                          </span>
                        </li>
                      ))}
                      {grnItems.length > 4 && (
                        <li className="text-gray-500">+{grnItems.length - 4} more items</li>
                      )}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-gray-200/70 pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="purchasing-secondary-button w-full sm:w-auto"
            onClick={() => router.push("/dashboard/purchasing/grn")}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={loading || !canSubmit}
            className="purchasing-main-button w-full sm:w-auto"
          >
            {loading ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <SaveIcon className="mr-2 h-4 w-4" />
                Submit
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
