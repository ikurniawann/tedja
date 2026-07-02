"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RM_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { useParams } from "next/navigation";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  CubeIcon,
  ExclamationTriangleIcon,
  PlayIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
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

function formatCurrency(value: unknown) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(toNumber(value));
}

function formatNumber(value: unknown) {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 3,
  }).format(toNumber(value));
}

function displayName(value?: string | null) {
  return (value || "-").replace(/\s+\d{8,}$/g, "").trim();
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    DRAFT: "Draft",
    RELEASED: "Released",
    IN_PROGRESS: "In Progress",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
  };
  return labels[status] || status;
}

function statusClass(status: string) {
  if (status === "COMPLETED") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "IN_PROGRESS") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "RELEASED") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "CANCELLED") return "border-gray-200 bg-gray-100 text-gray-500";
  return "border-pink-200 bg-pink-50 text-pink-700";
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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

export function ProductionOrderDetailPage() {
  const params = useParams();
  const orderId = params.id as string;
  const [message, setMessage] = useState("");
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
      setMessage(
        orderQuery.error instanceof Error
          ? orderQuery.error.message
          : "Gagal memuat detail produksi"
      );
    }
  }, [orderQuery.isError, orderQuery.error]);

  const runAction = async (action: "recheck_stock" | "release" | "start" | "cancel") => {
    setMessage("");
    try {
      const result = await actionMutation.mutateAsync({ id: orderId, payload: { action } });
      if (result.ok || action === "recheck_stock") await loadOrder();
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal mengupdate status produksi");
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
  };

  const submitComplete = async () => {
    if (!completeForm) return;
    setMessage("");
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
      setMessage(result.message || "Produksi selesai");
      if (result.ok) {
        setCompleteForm(null);
        await loadOrder();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal menyelesaikan produksi");
    }
  };

  if (loading && !order) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-gray-500">
        Memuat detail produksi...
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <Link href={RM_ROUTES.productionHub} className="inline-flex items-center gap-2 text-sm font-medium text-pink-700">
          <ArrowLeftIcon className="h-4 w-4" />
          Kembali ke Produksi
        </Link>
        <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
          {message || "Production order tidak ditemukan"}
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
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <Link href={RM_ROUTES.productionHub} className="inline-flex items-center gap-2 text-sm font-medium text-pink-700">
            <ArrowLeftIcon className="h-4 w-4" />
            Kembali ke Produksi
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-gray-950">{order.nomor_produksi}</h1>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(order.status)}`}>
                {statusLabel(order.status)}
              </span>
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
                {order.output_type === "WIP" ? "Output WIP" : "Produk Jadi"}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">{displayName(order.product_nama)} · {formatDate(order.created_at)}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={loadOrder} className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <ArrowPathIcon className="h-4 w-4" />
            Refresh
          </button>
          {["DRAFT", "RELEASED", "IN_PROGRESS"].includes(order.status) && (
            <button type="button" onClick={() => runAction("recheck_stock")} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-200 px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50">
              <ArrowPathIcon className="h-4 w-4" />
              Cek Ulang Stok
            </button>
          )}
          {canRelease && (
            <button type="button" onClick={() => runAction("release")} disabled={loading || insufficientMaterials.length > 0} className="inline-flex h-10 items-center gap-2 rounded-lg border border-amber-200 px-3 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50">
              Release
            </button>
          )}
          {canStart && (
            <button type="button" onClick={() => runAction("start")} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-lg border border-sky-200 px-3 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50">
              <PlayIcon className="h-4 w-4" />
              Start
            </button>
          )}
          {canComplete && (
            <button type="button" onClick={openComplete} disabled={loading || insufficientMaterials.length > 0} className="inline-flex h-10 items-center gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-50">
              <CheckCircleIcon className="h-4 w-4" />
              Complete
            </button>
          )}
          {canCancel && (
            <button type="button" onClick={() => runAction("cancel")} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
              Cancel
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-pink-100 bg-pink-50 px-5 py-4 text-sm font-medium text-pink-700">
          {message}
        </div>
      )}

      {insufficientMaterials.length > 0 && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex gap-3">
              <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 text-red-600" />
              <div>
                <h2 className="text-sm font-semibold text-red-800">Stok belum cukup</h2>
                <p className="mt-1 text-sm text-red-700">
                  Release atau complete akan ditahan sampai kekurangan bahan di bawah ini dipenuhi.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => runAction("recheck_stock")}
                disabled={loading}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowPathIcon className="h-3.5 w-3.5" />
                Cek Ulang Stok
              </button>
              <Link
                href={`/dashboard/purchasing/po/insert?source=production&production_order_id=${order.id}&production_order=${productionOrderParam}&items=${shortageQuery}`}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700"
              >
                Buatkan PO
              </Link>
            </div>
          </div>
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">Planned Qty</p>
          <p className="mt-2 text-xl font-semibold text-gray-950">{formatNumber(order.planned_qty)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">Actual Qty</p>
          <p className="mt-2 text-xl font-semibold text-gray-950">{formatNumber(order.actual_qty)}</p>
        </div>
        <div className="rounded-xl border border-pink-100 bg-pink-50/60 p-4 shadow-sm">
          <p className="text-xs font-medium text-pink-700">Material Cost</p>
          <p className="mt-2 text-xl font-semibold text-pink-800">{formatCurrency(actualMaterialCost)}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 shadow-sm">
          <p className="text-xs font-medium text-emerald-700">HPP / Unit</p>
          <p className="mt-2 text-xl font-semibold text-emerald-800">{formatCurrency(order.hpp_per_unit)}</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-950">Material Requirement</h2>
            <p className="text-xs text-gray-500">Kebutuhan bahan, stok tersedia, dan nilai konsumsi produksi.</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${insufficientMaterials.length > 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
            {insufficientMaterials.length > 0 ? `${insufficientMaterials.length} bahan kurang` : "Stok cukup"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Bahan</th>
                <th className="px-4 py-3 text-right font-semibold">Plan</th>
                <th className="px-4 py-3 text-right font-semibold">Actual</th>
                <th className="px-4 py-3 text-right font-semibold">Stok</th>
                <th className="px-4 py-3 text-right font-semibold">Shortage</th>
                <th className="px-4 py-3 text-right font-semibold">Cost</th>
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
                    <td className="px-4 py-3 text-right">{formatNumber(material.qty_planned)} {material.satuan?.nama || ""}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(material.qty_actual)} {material.satuan?.nama || ""}</td>
                    <td className="px-4 py-3 text-right">{formatNumber(material.stock?.qty_onhand)}</td>
                    <td className="px-4 py-3 text-right">
                      {shortage > 0 ? (
                        <div className="space-y-2">
                          <p className="font-semibold text-red-600">{formatNumber(shortage)}</p>
                          <div className="flex justify-end gap-1.5">
                            <Link
                              href={`/dashboard/purchasing/po/insert?source=production&production_order_id=${order.id}&production_order=${productionOrderParam}&items=${itemQuery}`}
                              className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700"
                            >
                              PO
                            </Link>
                          </div>
                        </div>
                      ) : (
                        <span className="font-semibold text-emerald-600">Cukup</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-pink-700">{formatCurrency(material.total_cost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-950">Cost Breakdown</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Material</span><span className="font-medium">{formatCurrency(actualMaterialCost)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Overhead</span><span className="font-medium">{formatCurrency(order.overhead_cost)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Labor</span><span className="font-medium">{formatCurrency(order.labor_cost)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Packaging</span><span className="font-medium">{formatCurrency(order.packaging_cost)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Waste</span><span className="font-medium">{formatCurrency(order.waste_cost)}</span></div>
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-950">Batch Output</h2>
          <div className="mt-4 space-y-3">
            {order.batches.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                Batch akan muncul setelah produksi completed.
              </div>
            ) : (
              order.batches.map((batch) => (
                <div key={batch.id} className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-gray-950">{batch.batch_number}</p>
                    <CubeIcon className="h-4 w-4 text-pink-600" />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-3 text-xs text-gray-500">
                    <span>Qty {formatNumber(batch.qty_produced)}</span>
                    <span>{formatCurrency(batch.hpp_per_unit)}/unit</span>
                    <span>{formatDate(batch.created_at)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {completeForm && completePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-950">Selesaikan Produksi</h2>
                <p className="text-sm text-gray-500">Finalisasi output, konsumsi bahan, dan HPP aktual untuk {order.nomor_produksi}</p>
              </div>
              <button type="button" onClick={() => setCompleteForm(null)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[calc(92vh-142px)] overflow-y-auto p-5">
              <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
                <div className="space-y-5">
                  <section className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="mb-4">
                      <h3 className="text-sm font-semibold text-gray-950">Output & Biaya Aktual</h3>
                      <p className="text-xs text-gray-500">Isi hasil produksi dan biaya tambahan yang benar-benar terjadi.</p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-5">
                      {[
                        ["Output Aktual", "actualQty", ""],
                        ["Overhead", "overheadCost", "Rp"],
                        ["Labor", "laborCost", "Rp"],
                        ["Packaging", "packagingCost", "Rp"],
                        ["Biaya Waste", "wasteCost", "Rp"],
                      ].map(([label, key, prefix]) => (
                        <label key={key} className="space-y-1.5">
                          <span className="text-xs font-medium text-gray-500">{label}</span>
                          <div className="relative">
                            {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400">{prefix}</span>}
                            <input
                              value={completeForm[key as keyof Omit<CompleteForm, "materials">]}
                              onChange={(event) => setCompleteForm({ ...completeForm, [key]: event.target.value })}
                              type="number"
                              min="0"
                              className={`h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100 ${prefix ? "pl-9" : ""}`}
                            />
                          </div>
                        </label>
                      ))}
                    </div>
                  </section>

                  <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                    <div className="border-b border-gray-100 px-4 py-3">
                      <h3 className="text-sm font-semibold text-gray-950">Konsumsi Bahan Aktual</h3>
                      <p className="text-xs text-gray-500">Actual qty akan mengurangi stok bahan saat produksi diselesaikan.</p>
                    </div>
                    <div className="overflow-x-auto">
                      <div className="min-w-[820px]">
                        <div className="grid grid-cols-[1.4fr_110px_110px_110px_120px_120px] gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          <span>Bahan</span>
                          <span className="text-right">Plan</span>
                          <span className="text-right">Stok</span>
                          <span className="text-right">Actual</span>
                          <span className="text-right">Waste</span>
                          <span className="text-right">Nilai</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {completeForm.materials.map((material, index) => {
                            const qtyActual = toNumber(material.qtyActual);
                            const isShort = qtyActual > material.stockQty;

                            return (
                              <div key={material.id} className="grid grid-cols-[1.4fr_110px_110px_110px_120px_120px] items-center gap-3 px-4 py-3 text-sm">
                                <div>
                                  <p className="font-medium text-gray-900">{material.name}</p>
                                  <p className="text-xs text-gray-500">{material.code} · {formatCurrency(material.unitCost)} / unit</p>
                                </div>
                                <div className="text-right text-gray-700">{formatNumber(material.plannedQty)} {material.unitName}</div>
                                <div className={`text-right font-semibold ${isShort ? "text-red-600" : "text-emerald-600"}`}>
                                  {formatNumber(material.stockQty)}
                                </div>
                                <input
                                  value={material.qtyActual}
                                  onChange={(event) => {
                                    const materials = [...completeForm.materials];
                                    materials[index] = { ...material, qtyActual: event.target.value };
                                    setCompleteForm({ ...completeForm, materials });
                                  }}
                                  type="number"
                                  min="0"
                                  className={`h-9 rounded-lg border px-2 text-right text-sm outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100 ${isShort ? "border-red-300 bg-red-50 text-red-700" : "border-gray-200"}`}
                                />
                                <input
                                  value={material.wasteQty}
                                  onChange={(event) => {
                                    const materials = [...completeForm.materials];
                                    materials[index] = { ...material, wasteQty: event.target.value };
                                    setCompleteForm({ ...completeForm, materials });
                                  }}
                                  type="number"
                                  min="0"
                                  className="h-9 rounded-lg border border-gray-200 px-2 text-right text-sm outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
                                />
                                <div className="text-right font-semibold text-pink-700">
                                  {formatCurrency(qtyActual * material.unitCost)}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                <aside className="space-y-4">
                  <div className="rounded-xl border border-pink-100 bg-pink-50/60 p-4">
                    <h3 className="text-sm font-semibold text-pink-900">Preview HPP Aktual</h3>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex justify-between gap-3"><span className="text-pink-700">Output</span><span className="font-semibold text-pink-950">{formatNumber(completePreview.actualQty)}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-pink-700">Material</span><span className="font-semibold text-pink-950">{formatCurrency(completePreview.materialCost)}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-pink-700">Overhead</span><span className="font-semibold text-pink-950">{formatCurrency(completePreview.overheadCost)}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-pink-700">Labor</span><span className="font-semibold text-pink-950">{formatCurrency(completePreview.laborCost)}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-pink-700">Packaging</span><span className="font-semibold text-pink-950">{formatCurrency(completePreview.packagingCost)}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-pink-700">Biaya Waste</span><span className="font-semibold text-pink-950">{formatCurrency(completePreview.wasteCost)}</span></div>
                      <div className="border-t border-pink-200 pt-3">
                        <div className="flex justify-between gap-3"><span className="font-semibold text-pink-800">Total Cost</span><span className="font-bold text-pink-950">{formatCurrency(completePreview.totalCost)}</span></div>
                        <div className="mt-3 rounded-lg bg-white px-3 py-3">
                          <p className="text-xs font-medium text-pink-600">HPP / Unit</p>
                          <p className="mt-1 text-2xl font-semibold text-pink-900">{formatCurrency(completePreview.hppPerUnit)}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {completePreview.actualQty <= 0 && (
                    <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-medium leading-6 text-red-700">
                      Output aktual harus lebih dari 0 sebelum produksi bisa diselesaikan.
                    </div>
                  )}

                  {completePreview.shortageItems.length > 0 && (
                    <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                      <h3 className="text-sm font-semibold text-red-800">Stok aktual kurang</h3>
                      <p className="mt-1 text-sm leading-6 text-red-700">Kurangi actual consumption atau terima barang masuk terlebih dahulu.</p>
                      <div className="mt-3 space-y-2">
                        {completePreview.shortageItems.map((material) => (
                          <div key={material.id} className="rounded-lg bg-white px-3 py-2 text-xs text-red-700">
                            <span className="font-semibold">{material.name}</span>: butuh {formatNumber(material.qtyActual)}, stok {formatNumber(material.stockQty)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </aside>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button type="button" onClick={() => setCompleteForm(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Batal
              </button>
              <button
                type="button"
                onClick={submitComplete}
                disabled={loading || completePreview.actualQty <= 0 || completePreview.shortageItems.length > 0}
                className="rounded-lg bg-pink-600 px-4 py-2 text-sm font-semibold text-white hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Selesaikan Produksi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
