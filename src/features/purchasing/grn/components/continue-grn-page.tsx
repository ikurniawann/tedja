"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { NumericInput } from "@/components/ui/numeric-input";
import { DsDateTimePicker } from "@/components/design-system";
import { toast } from "sonner";
import { getGrn, getGrnPOItems, getGrnPO } from "../api";
import { useUpdateGrn } from "../mutations";
import {
  ArrowLeftIcon,
  ClipboardCheck,
  Info,
  Loader2Icon,
  Package,
  SaveIcon,
  TruckIcon,
} from "lucide-react";

interface GrnItem {
  id: string;
  grn_id?: string;
  purchase_order_item_id?: string;
  raw_material_id: string;
  nama_bahan: string;
  qty_diterima: number;
  qty_ditolak: number;
  previous_qty_diterima: number;
  previous_qty_ditolak: number;
  catatan: string;
  satuan?: string;
}

interface POItem {
  id: string;
  raw_material_id: string;
  nama_bahan: string;
  qty_ordered: number;
  qty_received: number;
  satuan?: string;
}

interface GRNData {
  id: string;
  nomor_grn: string;
  delivery_id: string;
  po_id?: string;
  purchase_order_id?: string;
  po_number: string;
  supplier_name: string;
  no_surat_jalan: string;
  delivery_number?: string;
  tanggal_penerimaan: string;
  status: string;
  catatan: string;
  items: GrnItem[];
  receive_count?: number;
  total_item_diterima?: number;
  total_item_ditolak?: number;
}

type ApiUnit = string | {
  nama?: string;
  nama_satuan?: string;
  kode?: string;
} | null;

type ApiRawMaterial = {
  nama?: string;
  nama_bahan?: string;
  kode?: string;
  satuan_besar?: ApiUnit;
} | null;

type ApiLineItem = {
  id: string;
  grn_id?: string;
  purchase_order_item_id?: string;
  raw_material_id?: string;
  nama_bahan?: string;
  qty_ordered?: number;
  qty_received?: number;
  qty_diterima?: number;
  qty_ditolak?: number;
  catatan?: string | null;
  raw_material?: {
    nama?: string;
    nama_bahan?: string;
    kode?: string;
    satuan_besar?: ApiUnit;
  } | null;
  satuan?: ApiUnit;
  purchase_order_item?: {
    id: string;
    raw_material_id?: string;
    qty_ordered?: number;
    qty_received?: number;
    raw_material?: ApiRawMaterial;
    satuan?: ApiUnit;
  } | null;
};

const GUIDELINES = [
  "Good quantity is the total accepted on this goods receipt line.",
  "You can receive up to the PO remaining balance (outstanding qty).",
  "Any shortfall versus PO remaining is automatically moved to reject.",
  "Receipt date and notes can be updated before submitting.",
];

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatQty(value: number) {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 4,
  }).format(value);
}

function getUnitName(unit?: ApiUnit, fallback = "pcs") {
  if (!unit) return fallback;
  if (typeof unit === "string") return unit || fallback;
  return unit.nama || unit.nama_satuan || unit.kode || fallback;
}

function getMaterialName(rawMaterial?: ApiRawMaterial, fallback = "Unknown") {
  if (!rawMaterial) return fallback;
  return rawMaterial.nama || rawMaterial.nama_bahan || fallback;
}

function getPoRemainingQty(poItem?: POItem) {
  if (!poItem) return 0;
  return Math.max(0, toNumber(poItem.qty_ordered) - toNumber(poItem.qty_received));
}

function findPoItem(item: GrnItem, poItems: POItem[]) {
  return (
    poItems.find((poItem) => poItem.id === item.purchase_order_item_id) ||
    poItems.find((poItem) => poItem.raw_material_id === item.raw_material_id)
  );
}

/** Max total good on this GRN line after continue (previous + PO hutang/sisa). */
function getMaxTotalGoodQty(item: GrnItem, poItem?: POItem) {
  const ordered = toNumber(poItem?.qty_ordered);
  const poRemaining = getPoRemainingQty(poItem);
  const previousGood = toNumber(item.previous_qty_diterima);
  if (ordered <= 0) return previousGood + poRemaining;
  return Math.min(ordered, previousGood + poRemaining);
}

function applyDefaultReceiptQty(items: GrnItem[], poItemsList: POItem[]) {
  return items.map((item) => {
    const poItem = findPoItem(item, poItemsList);
    const poRemaining = getPoRemainingQty(poItem);
    const maxTotalGood = getMaxTotalGoodQty(item, poItem);
    const totalGood = maxTotalGood;
    const incrementalGood = Math.max(0, totalGood - toNumber(item.previous_qty_diterima));
    const incrementalReject = Math.max(0, poRemaining - incrementalGood);
    const totalReject = toNumber(item.previous_qty_ditolak) + incrementalReject;
    return { ...item, qty_diterima: totalGood, qty_ditolak: totalReject };
  });
}

function getStatusBadge(status: string) {
  const normalized = status || "pending";
  const labels: Record<string, string> = {
    pending: "Pending",
    partially_received: "Partially Received",
    received: "Received",
    rejected: "Rejected",
  };

  const classes: Record<string, string> = {
    pending: "border-amber-200 bg-amber-50 text-amber-700",
    partially_received: "border-orange-200 bg-orange-50 text-orange-700",
    received: "border-emerald-200 bg-emerald-50 text-emerald-700",
    rejected: "border-red-200 bg-red-50 text-red-700",
  };

  return (
    <Badge variant="outline" className={classes[normalized] || classes.pending}>
      {labels[normalized] || normalized}
    </Badge>
  );
}

export function ContinueGrnPage() {
  const params = useParams();
  const router = useRouter();
  const grnId = params.id as string;

  const [loading, setLoading] = useState(true);
  const updateMutation = useUpdateGrn();
  const saving = updateMutation.isPending;
  const [grnData, setGrnData] = useState<GRNData | null>(null);
  const [poItems, setPoItems] = useState<POItem[]>([]);
  const [grnItems, setGrnItems] = useState<GrnItem[]>([]);
  const [formData, setFormData] = useState({
    tanggal_penerimaan: "",
    catatan: "",
  });

  const mapPOItem = useCallback((item: ApiLineItem): POItem => ({
    id: item.id,
    raw_material_id: item.raw_material_id || "",
    nama_bahan: item.nama_bahan || getMaterialName(item.raw_material),
    qty_ordered: toNumber(item.qty_ordered),
    qty_received: toNumber(item.qty_received),
    satuan: getUnitName(item.satuan || item.raw_material?.satuan_besar),
  }), []);

  const loadPoItems = useCallback(async (poId: string) => {
    const items = await getGrnPOItems<ApiLineItem>(poId);
    if (items.length > 0) {
      return items.map(mapPOItem);
    }

    const fallback = await getGrnPO<{ items?: ApiLineItem[] }>(poId);
    if (fallback?.items && Array.isArray(fallback.items)) {
      return fallback.items.map(mapPOItem);
    }

    return [];
  }, [mapPOItem]);

  const fetchGrnData = useCallback(async () => {
    setLoading(true);
    try {
      const grn = await getGrn<GRNData>(grnId);
      const poId = grn.purchase_order_id || grn.po_id || "";
      setGrnData({ ...grn, po_id: poId });
      setFormData({
        tanggal_penerimaan: grn.tanggal_penerimaan || new Date().toISOString().split("T")[0],
        catatan: grn.catatan || "",
      });

      if (!grn.items || grn.items.length === 0) {
        setGrnItems([]);
        setPoItems([]);
        return;
      }

      const apiItems = grn.items as unknown as ApiLineItem[];
      let poItemsList: POItem[] = [];

      if (poId) {
        poItemsList = await loadPoItems(poId);
      }

      if (poItemsList.length === 0) {
        poItemsList = apiItems
          .filter((item) => item.purchase_order_item)
          .map((item) => {
            const poItem = item.purchase_order_item!;
            return {
              id: poItem.id,
              raw_material_id: poItem.raw_material_id || item.raw_material_id || "",
              nama_bahan: getMaterialName(item.raw_material || poItem.raw_material),
              qty_ordered: toNumber(poItem.qty_ordered),
              qty_received: toNumber(poItem.qty_received),
              satuan: getUnitName(poItem.satuan || item.satuan || item.raw_material?.satuan_besar),
            };
          });
      }

      const mappedItems: GrnItem[] = apiItems.map((item) => {
        const poItem = item.purchase_order_item;
        const rawMaterial = item.raw_material || poItem?.raw_material;
        return {
          id: item.id,
          grn_id: item.grn_id,
          purchase_order_item_id: item.purchase_order_item_id,
          raw_material_id: item.raw_material_id || poItem?.raw_material_id || "",
          nama_bahan: item.nama_bahan || getMaterialName(rawMaterial),
          qty_diterima: 0,
          qty_ditolak: 0,
          previous_qty_diterima: toNumber(item.qty_diterima),
          previous_qty_ditolak: toNumber(item.qty_ditolak),
          catatan: "",
          satuan: getUnitName(item.satuan || poItem?.satuan || rawMaterial?.satuan_besar),
        };
      });

      setPoItems(poItemsList);
      setGrnItems(applyDefaultReceiptQty(mappedItems, poItemsList));
    } catch (error: unknown) {
      console.error("Fetch error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to load goods receipt.");
    } finally {
      setLoading(false);
    }
  }, [grnId, loadPoItems]);

  useEffect(() => {
    if (grnId) {
      fetchGrnData();
    }
  }, [fetchGrnData, grnId]);

  const handleUpdateAcceptedQty = (index: number, acceptQty: number) => {
    setGrnItems((items) =>
      items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const poItem = findPoItem(item, poItems);
        const poRemaining = getPoRemainingQty(poItem);
        const maxTotalGood = getMaxTotalGoodQty(item, poItem);
        const totalGood = Math.max(
          toNumber(item.previous_qty_diterima),
          Math.min(toNumber(acceptQty), maxTotalGood)
        );
        const incrementalGood = Math.max(0, totalGood - toNumber(item.previous_qty_diterima));
        const incrementalReject = Math.max(0, poRemaining - incrementalGood);
        const totalReject = toNumber(item.previous_qty_ditolak) + incrementalReject;
        return { ...item, qty_diterima: totalGood, qty_ditolak: totalReject };
      })
    );
  };

  const itemRows = useMemo(
    () =>
      grnItems.map((item) => {
        const poItem = findPoItem(item, poItems);
        const qtyOrdered = toNumber(poItem?.qty_ordered);
        const qtyReceived = toNumber(poItem?.qty_received);
        const poRemaining = getPoRemainingQty(poItem);
        const maxTotalGood = getMaxTotalGoodQty(item, poItem);
        const satuan = poItem?.satuan || item.satuan || "pcs";

        return {
          item,
          poItem,
          qtyOrdered,
          qtyReceived,
          poRemaining,
          maxTotalGood,
          satuan,
        };
      }),
    [grnItems, poItems]
  );

  const totals = useMemo(
    () =>
      itemRows.reduce(
        (acc, row) => {
          acc.ordered += row.qtyOrdered;
          acc.received += row.qtyReceived;
          acc.remaining += row.poRemaining;
          acc.newAccepted += row.item.qty_diterima;
          acc.rejected += row.item.qty_ditolak;
          return acc;
        },
        { ordered: 0, received: 0, remaining: 0, newAccepted: 0, rejected: 0 }
      ),
    [itemRows]
  );

  const canSubmit = grnItems.length > 0 && Boolean(formData.tanggal_penerimaan);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const validItems = grnItems.filter(
      (item) => item.qty_diterima > 0 || item.qty_ditolak > 0
    );
    if (validItems.length === 0) {
      toast.error("Enter quantity for at least one item.");
      return;
    }

    try {
      const totalDiterima = validItems.reduce((sum, item) => sum + item.qty_diterima, 0);
      const totalDitolak = validItems.reduce((sum, item) => sum + item.qty_ditolak, 0);

      let newStatus = "pending";
      const totalOrdered = poItems.reduce((sum, item) => sum + item.qty_ordered, 0);
      const projectedPoReceived = poItems.reduce((sum, poItem) => {
        const grnItem = validItems.find(
          (item) =>
            item.purchase_order_item_id === poItem.id ||
            item.raw_material_id === poItem.raw_material_id
        );
        return sum + (grnItem ? grnItem.qty_diterima : poItem.qty_received);
      }, 0);

      if (totalDiterima === 0 && totalDitolak > 0) {
        newStatus = "rejected";
      } else if (projectedPoReceived >= totalOrdered && totalDitolak === 0) {
        newStatus = "received";
      } else if (totalDiterima > 0) {
        newStatus = "pending";
      }

      const payload = {
        status: newStatus,
        catatan: formData.catatan,
        tanggal_penerimaan: formData.tanggal_penerimaan,
        items: validItems.map((item) => ({
          id: item.id,
          grn_id: grnId,
          purchase_order_item_id: item.purchase_order_item_id,
          raw_material_id: item.raw_material_id,
          qty_diterima: item.qty_diterima,
          qty_ditolak: item.qty_ditolak,
          kondisi: "baik" as const,
          catatan: item.catatan || null,
        })),
      };

      await updateMutation.mutateAsync({ id: grnId, payload });
      toast.success(`Goods receipt ${grnData?.nomor_grn || ""} updated successfully.`);
      router.push("/dashboard/purchasing/grn");
      router.refresh();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to update goods receipt.");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-56 items-center justify-center text-sm text-gray-500">
        <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
        Loading goods receipt...
      </div>
    );
  }

  if (!grnData) {
    return (
      <div className="py-12 text-center text-sm text-red-600">Goods receipt not found.</div>
    );
  }

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
            <h1 className="text-2xl font-bold text-gray-900">Continue Goods Receipt</h1>
            <p className="text-sm text-gray-500">
              Record additional received quantities for the remaining purchase order items
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
                <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200/70 bg-gray-50/60 p-4 text-sm md:grid-cols-2">
                  <div>
                    <p className="text-xs text-gray-500">Goods Receipt Number</p>
                    <p className="font-medium text-gray-900">{grnData.nomor_grn}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Status</p>
                    <div className="mt-1">{getStatusBadge(grnData.status)}</div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Purchase Order</p>
                    <p className="font-medium text-gray-900">{grnData.po_number || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Delivery Note Number</p>
                    <p className="font-medium text-gray-900">{grnData.no_surat_jalan || "-"}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs text-gray-500">Supplier</p>
                    <p className="font-medium text-gray-900">{grnData.supplier_name || "-"}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <DsDateTimePicker
                    label="Receipt Date"
                    value={formData.tanggal_penerimaan}
                    onChange={(value) =>
                      setFormData((prev) => ({ ...prev, tanggal_penerimaan: value }))
                    }
                    placeholder="Select receipt date..."
                    dateOnly
                    required
                  />
                  <div className="min-w-0 space-y-1.5 md:col-span-2">
                    <Label htmlFor="catatan" className="text-xs">
                      Notes
                    </Label>
                    <Textarea
                      id="catatan"
                      value={formData.catatan}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, catatan: e.target.value }))
                      }
                      placeholder="Add notes if needed..."
                      rows={3}
                      className="resize-none text-sm"
                    />
                  </div>
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
                {itemRows.length === 0 ? (
                  <div className="py-12 text-center text-sm text-gray-500">
                    No goods receipt items found.
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
                            <th className="w-[104px] px-1.5 py-3 text-center font-semibold">Good</th>
                            <th className="w-[104px] px-1.5 py-3 text-center font-semibold">Reject</th>
                          </tr>
                        </thead>
                        <tbody>
                          {itemRows.map(({ item, poItem, qtyOrdered, qtyReceived, poRemaining, maxTotalGood, satuan }, index) => (
                            <tr key={item.id} className="bg-white hover:bg-gray-50/80">
                              <td className="px-4 py-3 align-top">
                                <div className="font-medium text-gray-900">{item.nama_bahan}</div>
                                {qtyOrdered > 0 && (
                                  <div className="mt-0.5 text-xs text-gray-500">
                                    Purchase Order: {formatQty(qtyOrdered)} {satuan}
                                  </div>
                                )}
                                {!poItem && (
                                  <div className="mt-0.5 text-xs text-amber-600">
                                    Purchase order item data is incomplete.
                                  </div>
                                )}
                                {(item.previous_qty_diterima > 0 || item.previous_qty_ditolak > 0) && (
                                  <div className="mt-1 text-xs text-gray-500">
                                    Previous receipt: {formatQty(item.previous_qty_diterima)} good
                                    {item.previous_qty_ditolak > 0
                                      ? `, ${formatQty(item.previous_qty_ditolak)} reject`
                                      : ""}
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-3 text-center align-middle text-gray-700">
                                {formatQty(qtyOrdered)}
                              </td>
                              <td className="px-2 py-3 text-center align-middle text-gray-700">
                                {formatQty(qtyReceived)}
                              </td>
                              <td className="px-2 py-3 text-center align-middle font-semibold text-pink-700">
                                {formatQty(poRemaining)}
                              </td>
                              <td className="px-1.5 py-1.5 align-middle">
                                <NumericInput
                                  min={item.previous_qty_diterima}
                                  max={maxTotalGood || undefined}
                                  value={item.qty_diterima}
                                  onValueChange={(value) =>
                                    handleUpdateAcceptedQty(index, value || 0)
                                  }
                                  decimalScale={4}
                                  disabled={poRemaining <= 0 && item.qty_diterima <= item.previous_qty_diterima}
                                  className="h-9 w-full border-gray-200/80 bg-white px-2 text-center text-sm focus-visible:border-pink-300 focus-visible:ring-1 focus-visible:ring-pink-200/80 disabled:bg-gray-50"
                                />
                              </td>
                              <td className="px-1.5 py-1.5 align-middle">
                                <div
                                  className={`flex h-9 w-full items-center justify-center rounded-lg border border-gray-200/80 bg-gray-50 px-2 text-sm font-medium ${
                                    item.qty_ditolak > 0 ? "text-red-600" : "text-gray-700"
                                  }`}
                                >
                                  {formatQty(item.qty_ditolak)}
                                </div>
                              </td>
                            </tr>
                          ))}
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
                <dl className="space-y-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-gray-500">Purchase Order</dt>
                    <dd className="text-right font-medium text-gray-900">
                      {grnData.po_number || "-"}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-gray-500">Supplier</dt>
                    <dd className="text-right font-medium text-gray-900">
                      {grnData.supplier_name || "-"}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-gray-500">Items</dt>
                    <dd className="text-right font-medium text-gray-900">{grnItems.length}</dd>
                  </div>
                  <div className="grid grid-cols-3 gap-2 border-t border-gray-200/70 pt-3">
                    <div className="rounded-lg border border-gray-200/70 bg-gray-50 px-3 py-2">
                      <p className="text-xs text-gray-500">Ordered</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">
                        {formatQty(totals.ordered)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-pink-100 bg-pink-50 px-3 py-2">
                      <p className="text-xs text-pink-600">Received</p>
                      <p className="mt-1 text-sm font-semibold text-pink-700">
                        {formatQty(totals.received)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-orange-100 bg-orange-50 px-3 py-2">
                      <p className="text-xs text-orange-600">Remaining</p>
                      <p className="mt-1 text-sm font-semibold text-orange-700">
                        {formatQty(totals.remaining)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start justify-between gap-3 border-t border-gray-200/70 pt-3">
                    <dt className="font-medium text-gray-900">Total Reject</dt>
                    <dd
                      className={`text-right font-semibold ${
                        totals.rejected > 0 ? "text-red-600" : "text-gray-900"
                      }`}
                    >
                      {formatQty(totals.rejected)}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="font-medium text-gray-900">Total Good (this receipt)</dt>
                    <dd className="text-right font-semibold text-gray-900">
                      {formatQty(totals.newAccepted)}
                    </dd>
                  </div>
                </dl>

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
                            {formatQty(item.qty_diterima)}
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
            disabled={saving || !canSubmit}
            className="purchasing-main-button w-full sm:w-auto"
          >
            {saving ? (
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
