"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { PurchasingFormHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { formatAmount, formatDate } from "@/lib/purchasing/utils";
import { getProductionModuleConfig } from "../production-module";
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  Loader2,
  PackageCheck,
  Play,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useProductionOrder } from "../queries";
import { useUpdateProductionOrder } from "../mutations";

type ProductionMaterial = {
  id: string;
  raw_material_id: string;
  qty_planned: number | string;
  qty_actual: number | string;
  waste_qty: number | string;
  unit_cost: number | string;
  total_cost: number | string;
  inventory_movement_id?: string | null;
  raw_material?: {
    kode?: string | null;
    nama?: string | null;
  } | null;
  satuan?: {
    nama?: string | null;
  } | null;
  stock?: {
    qty_onhand: number;
    required_qty: number;
    shortage_qty: number;
    stock_status: "ENOUGH" | "INSUFFICIENT";
  } | null;
};

type ProductionBatch = {
  id: string;
  batch_number: string;
  qty_produced: number | string;
  hpp_per_unit: number | string;
  total_cost: number | string;
  output_type?: "FINISHED_GOOD" | "WIP";
  created_at: string;
};

type ProductionDetail = {
  id: string;
  nomor_produksi: string;
  product_nama?: string | null;
  product_kode?: string | null;
  output_type?: "FINISHED_GOOD" | "WIP";
  output_satuan_nama?: string | null;
  planned_qty: number | string;
  actual_qty: number | string;
  status: string;
  planned_material_cost: number | string;
  actual_material_cost: number | string;
  overhead_cost: number | string;
  labor_cost: number | string;
  packaging_cost: number | string;
  waste_cost: number | string;
  hpp_per_unit: number | string;
  catatan?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  materials: ProductionMaterial[];
  batches: ProductionBatch[];
  stock_summary?: {
    total_materials: number;
    insufficient_materials: number;
    can_release: boolean;
  };
};

type CompleteForm = {
  actualQty: string;
  overheadCost: string;
  laborCost: string;
  packagingCost: string;
  wasteCost: string;
  materials: Array<{
    id: string;
    name: string;
    code: string;
    unitName: string;
    plannedQty: number;
    qtyActual: string;
    wasteQty: string;
    unitCost: number;
    stockQty: number;
  }>;
};

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatQty(value: unknown) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(toNumber(value));
}

function displayName(value?: string | null) {
  return (value || "-").replace(/\s+\d{8,}$/g, "").trim();
}

function materialUnitLabel(material: ProductionMaterial) {
  return material.satuan?.nama?.trim() || "-";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    DRAFT: "Draf",
    RELEASED: "Dirilis",
    IN_PROGRESS: "Dalam Proses",
    COMPLETED: "Selesai",
    CANCELLED: "Dibatalkan",
  };
  return labels[status] || status;
}

function statusClass(status: string) {
  if (status === "COMPLETED") return "border-emerald-200/80 bg-emerald-50 text-emerald-700";
  if (status === "IN_PROGRESS") return "border-sky-200/80 bg-sky-50 text-sky-700";
  if (status === "RELEASED") return "border-amber-200/80 bg-amber-50 text-amber-700";
  if (status === "CANCELLED") return "border-gray-200/80 bg-gray-50 text-gray-500";
  return "border-pink-200/80 bg-pink-50 text-pink-700";
}

function buildProcurementItems(materials: ProductionMaterial[]) {
  return encodeURIComponent(
    JSON.stringify(
      materials.map((material) => ({
        id: material.raw_material_id,
        kode: material.raw_material?.kode || "",
        nama: displayName(material.raw_material?.nama),
        qty: Math.ceil(toNumber(material.stock?.shortage_qty)),
        unit: material.satuan?.nama || "unit",
        price: toNumber(material.unit_cost),
      }))
    )
  );
}

const PAGE_ACTION_BUTTON =
  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium shadow-sm sm:w-auto";
const PAGE_MAIN_ACTION = "purchasing-main-button w-full gap-2 sm:w-auto";
const PAGE_SECONDARY_ACTION = "purchasing-secondary-button w-full gap-2 sm:w-auto";
const PAGE_DESTRUCTIVE_ACTION =
  "h-10 w-full gap-2 rounded-lg border-red-200/80 bg-white px-3 text-sm font-medium text-red-600 shadow-sm hover:border-red-200 hover:bg-red-50 hover:text-red-700 sm:w-auto";

export function ProductionOrderDetailPage({
  moduleType = "raw_material",
}: {
  moduleType?: PurchasingModuleType;
}) {
  const config = getProductionModuleConfig(moduleType);
  const params = useParams();
  const orderId = params.id as string;
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeForm, setCompleteForm] = useState<CompleteForm | null>(null);

  const orderQuery = useProductionOrder<ProductionDetail>(orderId);
  const order = orderQuery.data ?? null;
  const actionMutation = useUpdateProductionOrder();
  const loading = orderQuery.isLoading || orderQuery.isFetching || actionMutation.isPending;

  const insufficientMaterials = useMemo(
    () => (order?.materials || []).filter((material) => toNumber(material.stock?.shortage_qty) > 0),
    [order]
  );

  const loadOrder = () => orderQuery.refetch();

  useEffect(() => {
    if (orderQuery.isError) {
      toast.error(
        orderQuery.error instanceof Error
          ? orderQuery.error.message
          : "Gagal memuat detail order produksi"
      );
    }
  }, [orderQuery.isError, orderQuery.error]);

  const runAction = async (action: "recheck_stock" | "release" | "start" | "cancel") => {
    try {
      const result = await actionMutation.mutateAsync({ id: orderId, payload: { action } });
      if (result.ok) {
        toast.success(result.message || "Order produksi diperbarui");
      } else {
        toast.error(result.message || "Gagal memperbarui order produksi");
      }
      if (result.ok || action === "recheck_stock") await loadOrder();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui order produksi");
    }
  };

  const openComplete = () => {
    if (!order) return;
    setCompleteForm({
      actualQty: String(toNumber(order.actual_qty) || toNumber(order.planned_qty)),
      overheadCost: String(toNumber(order.overhead_cost)),
      laborCost: String(toNumber(order.labor_cost)),
      packagingCost: String(toNumber(order.packaging_cost)),
      wasteCost: String(toNumber(order.waste_cost)),
      materials: order.materials.map((material) => ({
        id: material.id,
        name: displayName(material.raw_material?.nama) || material.raw_material_id,
        code: material.raw_material?.kode || material.raw_material_id,
        unitName: material.satuan?.nama || "",
        plannedQty: toNumber(material.qty_planned),
        qtyActual: String(toNumber(material.qty_actual || material.qty_planned)),
        wasteQty: String(toNumber(material.waste_qty)),
        unitCost: toNumber(material.unit_cost),
        stockQty: toNumber(material.stock?.qty_onhand),
      })),
    });
    setCompleteOpen(true);
  };

  const submitComplete = async () => {
    if (!completeForm) return;
    try {
      const result = await actionMutation.mutateAsync({
        id: orderId,
        payload: {
          action: "complete",
          actual_qty: toNumber(completeForm.actualQty),
          overhead_cost: toNumber(completeForm.overheadCost),
          labor_cost: toNumber(completeForm.laborCost),
          packaging_cost: toNumber(completeForm.packagingCost),
          waste_cost: toNumber(completeForm.wasteCost),
          materials: completeForm.materials.map((material) => ({
            id: material.id,
            qty_actual: toNumber(material.qtyActual),
            waste_qty: toNumber(material.wasteQty),
          })),
        },
      });
      if (result.ok) {
        toast.success(result.message || "Output produksi diterima ke inventori");
        setCompleteOpen(false);
        setCompleteForm(null);
        await loadOrder();
      } else {
        toast.error(result.message || "Gagal menerima output produksi");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menerima output produksi");
    }
  };

  if (loading && !order) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
        Memuat order produksi...
      </div>
    );
  }

  if (!order) {
    return (
      <div className="space-y-4">
        <PurchasingFormHeader
          backHref={config.productionHubRoute}
          title="Order Produksi"
          description="Order produksi yang diminta tidak dapat dimuat."
        />
        <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
          Order produksi tidak ditemukan
        </div>
      </div>
    );
  }

  const canRelease = order.status === "DRAFT";
  const canStart = order.status === "RELEASED";
  const canComplete = order.status === "IN_PROGRESS";
  const canCancel = !["COMPLETED", "CANCELLED"].includes(order.status);
  const actualMaterialCost = toNumber(order.actual_material_cost) || toNumber(order.planned_material_cost);
  const shortageQuery = buildProcurementItems(insufficientMaterials);
  const productionOrderParam = encodeURIComponent(order.nomor_produksi);
  const completePreview = completeForm
    ? (() => {
        const materialCost = completeForm.materials.reduce(
          (sum, material) => sum + toNumber(material.qtyActual) * material.unitCost,
          0
        );
        const overheadCost = toNumber(completeForm.overheadCost);
        const laborCost = toNumber(completeForm.laborCost);
        const packagingCost = toNumber(completeForm.packagingCost);
        const wasteCost = toNumber(completeForm.wasteCost);
        const totalCost = materialCost + overheadCost + laborCost + packagingCost + wasteCost;
        const actualQty = toNumber(completeForm.actualQty);
        const hppPerUnit = actualQty > 0 ? totalCost / actualQty : 0;
        const shortageItems = completeForm.materials.filter((material) => toNumber(material.qtyActual) > material.stockQty);

        return {
          actualQty,
          materialCost,
          overheadCost,
          laborCost,
          packagingCost,
          wasteCost,
          totalCost,
          hppPerUnit,
          shortageItems,
        };
      })()
    : null;

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={config.productionHubRoute}
        title={order.nomor_produksi}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{displayName(order.product_nama || order.output_raw_material_nama || order.item_nama)}</span>
            <span className="text-gray-300">·</span>
            <span>{formatDate(order.created_at)}</span>
            <Badge variant="outline" className={statusClass(order.status)}>
              {statusLabel(order.status)}
            </Badge>
            <Badge
              variant="outline"
              className={
                order.output_type === "WIP"
                  ? "border-sky-200/80 bg-sky-50 text-sky-700"
                  : "border-emerald-200/80 bg-emerald-50 text-emerald-700"
              }
            >
              {order.output_type === "WIP" ? "WIP" : "Barang Jadi"}
            </Badge>
          </span>
        }
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadOrder()}
              disabled={loading}
              className={PAGE_SECONDARY_ACTION}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Muat Ulang
            </Button>
            {["DRAFT", "RELEASED", "IN_PROGRESS"].includes(order.status) && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void runAction("recheck_stock")}
                disabled={loading}
                className={`${PAGE_ACTION_BUTTON} border-emerald-200/80 bg-white text-emerald-700 hover:bg-emerald-50`}
              >
                <RefreshCw className="h-4 w-4" />
                Cek Ulang Stok
              </Button>
            )}
            {canRelease && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void runAction("release")}
                disabled={loading || insufficientMaterials.length > 0}
                className={`${PAGE_ACTION_BUTTON} border-amber-200/80 bg-white text-amber-700 hover:bg-amber-50`}
              >
                <CheckCircle2 className="h-4 w-4" />
                Dirilis
              </Button>
            )}
            {canStart && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void runAction("start")}
                disabled={loading}
                className={`${PAGE_ACTION_BUTTON} border-sky-200/80 bg-white text-sky-700 hover:bg-sky-50`}
              >
                <Play className="h-4 w-4" />
                Mulai
              </Button>
            )}
            {canComplete && (
              <Button
                type="button"
                onClick={openComplete}
                disabled={loading || insufficientMaterials.length > 0}
                className={PAGE_MAIN_ACTION}
              >
                <PackageCheck className="h-4 w-4" />
                Terima Output
              </Button>
            )}
            {canCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void runAction("cancel")}
                disabled={loading}
                className={PAGE_DESTRUCTIVE_ACTION}
              >
                Batal
              </Button>
            )}
          </>
        }
      />

      {insufficientMaterials.length > 0 && (
        <Card className="border-red-200/70 bg-red-50/50 shadow-xs">
          <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <div>
                <h2 className="text-sm font-semibold text-red-800">Stok tidak cukup</h2>
                <p className="mt-1 text-sm text-red-700">
                  Dirilis atau terima output akan diblokir sampai kekurangan bahan di bawah ini teratasi.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void runAction("recheck_stock")}
                disabled={loading}
                className={`${PAGE_ACTION_BUTTON} border-red-200/80 bg-white text-red-700 hover:bg-red-50`}
              >
                <RefreshCw className="h-4 w-4" />
                Cek Ulang Stok
              </Button>
              <Link
                href={`${config.purchasingPoInsertRoute}?source=production&production_order_id=${order.id}&production_order=${productionOrderParam}&items=${shortageQuery}`}
                className={`${PAGE_ACTION_BUTTON} bg-red-600 text-white hover:bg-red-700`}
              >
                Buat Purchase Order
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Kuantitas Rencana</p>
            <p className="mt-2 text-xl font-semibold text-gray-950">
              {formatQty(order.planned_qty)}
              {order.output_satuan_nama ? (
                <span className="ml-1.5 text-sm font-medium text-gray-500">{order.output_satuan_nama}</span>
              ) : null}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Kuantitas Aktual</p>
            <p className="mt-2 text-xl font-semibold text-gray-950">
              {formatQty(order.actual_qty)}
              {order.output_satuan_nama ? (
                <span className="ml-1.5 text-sm font-medium text-gray-500">{order.output_satuan_nama}</span>
              ) : null}
            </p>
          </CardContent>
        </Card>
        <Card className="border-pink-200/70 bg-pink-50/40 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-pink-700">Biaya Bahan</p>
            <p className="mt-2 text-xl font-semibold text-pink-800">{formatAmount(actualMaterialCost)}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-200/70 bg-emerald-50/40 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-emerald-700">HPP / Unit</p>
            <p className="mt-2 text-xl font-semibold text-emerald-800">{formatAmount(order.hpp_per_unit)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200/70 pb-3">
          <div>
            <CardTitle className="text-base">Kebutuhan Bahan</CardTitle>
            <p className="mt-1 text-xs text-gray-500">
              Konsumsi rencana, stok tersedia, dan nilai baris produksi.
            </p>
          </div>
          <Badge
            variant="outline"
            className={
              insufficientMaterials.length > 0
                ? "border-red-200/80 bg-red-50 text-red-700"
                : "border-emerald-200/80 bg-emerald-50 text-emerald-700"
            }
          >
            {insufficientMaterials.length > 0
              ? `${insufficientMaterials.length} kekurangan`
              : "Stok cukup"}
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Bahan</th>
                  <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Satuan</th>
                  <th className="px-4 py-3 text-right font-semibold">Rencana</th>
                  <th className="px-4 py-3 text-right font-semibold">Aktual</th>
                  <th className="px-4 py-3 text-right font-semibold">Stok</th>
                  <th className="px-4 py-3 text-right font-semibold">Kekurangan</th>
                  <th className="px-4 py-3 text-right font-semibold">Biaya</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {order.materials.map((material) => {
                  const shortage = toNumber(material.stock?.shortage_qty);
                  const itemQuery = buildProcurementItems([material]);
                  return (
                    <tr key={material.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-950">{displayName(material.raw_material?.nama)}</p>
                        <p className="text-xs text-gray-500">{material.raw_material?.kode || material.raw_material_id}</p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Badge
                          variant="outline"
                          className="border-gray-200/80 bg-gray-50 font-normal text-gray-700"
                        >
                          {materialUnitLabel(material)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatQty(material.qty_planned)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatQty(material.qty_actual)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatQty(material.stock?.qty_onhand)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {shortage > 0 ? (
                          <div className="space-y-2">
                            <p className="font-semibold text-red-600">{formatQty(shortage)}</p>
                            <div className="flex justify-end">
                              <Link
                                href={`${config.purchasingPoInsertRoute}?source=production&production_order_id=${order.id}&production_order=${productionOrderParam}&items=${itemQuery}`}
                                className={`${PAGE_ACTION_BUTTON} bg-red-600 text-white hover:bg-red-700`}
                              >
                                Purchase Order
                              </Link>
                            </div>
                          </div>
                        ) : (
                          <span className="font-semibold text-emerald-600">Cukup</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-pink-700">
                        {formatAmount(material.total_cost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-12">
        <Card className="border-gray-200/70 shadow-xs xl:col-span-5">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="text-base">Rincian Biaya</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Bahan</span><span className="font-medium">{formatAmount(actualMaterialCost)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Overhead</span><span className="font-medium">{formatAmount(order.overhead_cost)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Tenaga Kerja</span><span className="font-medium">{formatAmount(order.labor_cost)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Kemasan</span><span className="font-medium">{formatAmount(order.packaging_cost)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Susut</span><span className="font-medium">{formatAmount(order.waste_cost)}</span></div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs xl:col-span-7">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Box className="h-4 w-4 text-pink-600" />
              Output Batch
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {order.batches.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200/80 px-4 py-6 text-center text-sm text-gray-500">
                Batch muncul setelah output produksi diterima.
              </div>
            ) : (
              order.batches.map((batch) => (
                <div key={batch.id} className="rounded-lg border border-gray-200/70 bg-gray-50/80 px-4 py-3 text-sm">
                  <p className="font-semibold text-gray-950">{batch.batch_number}</p>
                  <div className="mt-2 grid grid-cols-3 gap-3 text-xs text-gray-500">
                    <span>Qty {formatQty(batch.qty_produced)}{order.output_satuan_nama ? ` ${order.output_satuan_nama}` : ""}</span>
                    <span>{formatAmount(batch.hpp_per_unit)}/satuan</span>
                    <span>{formatDate(batch.created_at)}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={completeOpen && !!completeForm && !!completePreview}
        onOpenChange={(open) => {
          if (!open && !loading) {
            setCompleteOpen(false);
            setCompleteForm(null);
          }
        }}
      >
        {completeForm && completePreview && (
          <DialogPanel size="xl" className="max-h-[min(92vh,960px)]">
            <DialogPanelHeader>
              <DialogPanelTitle>Terima Output Produksi</DialogPanelTitle>
              <DialogPanelDescription>
                Finalisasi kuantitas output, konsumsi bahan aktual, dan HPP untuk {order.nomor_produksi}.
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-5">
              <Card className="border-gray-200/70 shadow-xs">
                <CardHeader className="border-b border-gray-200/70 pb-3">
                  <CardTitle className="text-sm">Output & Biaya Tambahan</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 p-4 md:grid-cols-5">
                  {[
                    ["Output Aktual", "actualQty"],
                    ["Overhead", "overheadCost"],
                    ["Tenaga Kerja", "laborCost"],
                    ["Kemasan", "packagingCost"],
                    ["Biaya Susut", "wasteCost"],
                  ].map(([label, key]) => (
                    <div key={key} className="space-y-1.5">
                      <Label className="text-xs text-gray-500">{label}</Label>
                      <Input
                        value={completeForm[key as keyof Omit<CompleteForm, "materials">]}
                        onChange={(event) =>
                          setCompleteForm({ ...completeForm, [key]: event.target.value })
                        }
                        type="number"
                        min="0"
                        className="h-9 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
                <Card className="border-gray-200/70 shadow-xs">
                  <CardHeader className="border-b border-gray-200/70 pb-3">
                    <CardTitle className="text-sm">Konsumsi Bahan Aktual</CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto p-0">
                    <table className="min-w-[760px] w-full text-sm">
                      <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold">Bahan</th>
                          <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Satuan</th>
                          <th className="px-4 py-3 text-right font-semibold">Rencana</th>
                          <th className="px-4 py-3 text-right font-semibold">Stok</th>
                          <th className="px-4 py-3 text-right font-semibold">Aktual</th>
                          <th className="px-4 py-3 text-right font-semibold">Susut</th>
                          <th className="px-4 py-3 text-right font-semibold">Nilai</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {completeForm.materials.map((material, index) => {
                          const qtyActual = toNumber(material.qtyActual);
                          const isShort = qtyActual > material.stockQty;
                          return (
                            <tr key={material.id} className="hover:bg-gray-50/80">
                              <td className="px-4 py-3">
                                <p className="font-medium text-gray-900">{material.name}</p>
                                <p className="text-xs text-gray-500">
                                  {material.code} · {formatAmount(material.unitCost)} / satuan
                                </p>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <Badge
                                  variant="outline"
                                  className="border-gray-200/80 bg-gray-50 font-normal text-gray-700"
                                >
                                  {material.unitName || "-"}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                                {formatQty(material.plannedQty)}
                              </td>
                              <td
                                className={`px-4 py-3 text-right font-semibold ${isShort ? "text-red-600" : "text-emerald-600"}`}
                              >
                                {formatQty(material.stockQty)}
                              </td>
                              <td className="px-4 py-3">
                                <Input
                                  value={material.qtyActual}
                                  onChange={(event) => {
                                    const materials = [...completeForm.materials];
                                    materials[index] = { ...material, qtyActual: event.target.value };
                                    setCompleteForm({ ...completeForm, materials });
                                  }}
                                  type="number"
                                  min="0"
                                  className={`h-9 text-right text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100 ${isShort ? "border-red-200/80 bg-red-50 text-red-700" : ""}`}
                                />
                              </td>
                              <td className="px-4 py-3">
                                <Input
                                  value={material.wasteQty}
                                  onChange={(event) => {
                                    const materials = [...completeForm.materials];
                                    materials[index] = { ...material, wasteQty: event.target.value };
                                    setCompleteForm({ ...completeForm, materials });
                                  }}
                                  type="number"
                                  min="0"
                                  className="h-9 text-right text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
                                />
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-pink-700">
                                {formatAmount(qtyActual * material.unitCost)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>

                <div className="space-y-4">
                  <Card className="border-pink-200/70 bg-pink-50/40 shadow-xs">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm text-pink-900">Pratinjau HPP</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 p-4 pt-0 text-sm">
                      <div className="flex justify-between gap-3">
                        <span className="text-pink-700">Output</span>
                        <span className="font-semibold text-pink-950">
                          {formatQty(completePreview.actualQty)}
                          {order.output_satuan_nama ? ` ${order.output_satuan_nama}` : ""}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-pink-700">Bahan</span>
                        <span className="font-semibold text-pink-950">{formatAmount(completePreview.materialCost)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-pink-700">Overhead</span>
                        <span className="font-semibold text-pink-950">{formatAmount(completePreview.overheadCost)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-pink-700">Tenaga Kerja</span>
                        <span className="font-semibold text-pink-950">{formatAmount(completePreview.laborCost)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-pink-700">Kemasan</span>
                        <span className="font-semibold text-pink-950">{formatAmount(completePreview.packagingCost)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-pink-700">Susut</span>
                        <span className="font-semibold text-pink-950">{formatAmount(completePreview.wasteCost)}</span>
                      </div>
                      <div className="border-t border-pink-200/70 pt-3">
                        <div className="flex justify-between gap-3">
                          <span className="font-semibold text-pink-800">Total Biaya</span>
                          <span className="font-bold text-pink-950">{formatAmount(completePreview.totalCost)}</span>
                        </div>
                        <div className="mt-3 rounded-lg bg-white px-3 py-3">
                          <p className="text-xs font-medium text-pink-600">HPP / Unit</p>
                          <p className="mt-1 text-2xl font-semibold text-pink-900">
                            {formatAmount(completePreview.hppPerUnit)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {completePreview.actualQty <= 0 && (
                    <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-medium text-red-700">
                      Output aktual harus lebih dari 0 sebelum menerima output produksi.
                    </div>
                  )}

                  {completePreview.shortageItems.length > 0 && (
                    <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                      <h3 className="text-sm font-semibold text-red-800">Stok tidak cukup</h3>
                      <p className="mt-1 text-sm text-red-700">
                        Kurangi konsumsi aktual atau terima barang masuk terlebih dahulu.
                      </p>
                      <div className="mt-3 space-y-2">
                        {completePreview.shortageItems.map((material) => (
                          <div key={material.id} className="rounded-lg bg-white px-3 py-2 text-xs text-red-700">
                            <span className="font-semibold">{material.name}</span>: butuh{" "}
                            {formatQty(material.qtyActual)}, stok {formatQty(material.stockQty)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </DialogPanelBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCompleteOpen(false);
                  setCompleteForm(null);
                }}
                disabled={loading}
                className={`${PAGE_SECONDARY_ACTION} sm:w-auto`}
              >
                Batal
              </Button>
              <Button
                type="button"
                onClick={() => void submitComplete()}
                disabled={loading || completePreview.actualQty <= 0 || completePreview.shortageItems.length > 0}
                className={`${PAGE_MAIN_ACTION} sm:w-auto`}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Menerima...
                  </>
                ) : (
                  <>
                    <PackageCheck className="h-4 w-4" />
                    Terima Output
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogPanel>
        )}
      </Dialog>
    </div>
  );
}
