"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowPathIcon,
  BeakerIcon,
  CubeIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { PRODUCT_ROUTES, RM_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { useProductionDashboard, useProductCogs } from "../queries";
import { useCreateProductionOrder } from "../mutations";
import type { ProductionProduct as Product } from "../types";

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

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function statusClass(status: string) {
  if (status === "COMPLETED") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "IN_PROGRESS") return "bg-sky-50 text-sky-700 border-sky-200";
  if (status === "RELEASED") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "CANCELLED") return "bg-gray-100 text-gray-500 border-gray-200";
  return "bg-pink-50 text-pink-700 border-pink-200";
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

export function ProductionPage() {
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [outputType, setOutputType] = useState<"FINISHED_GOOD" | "WIP">("FINISHED_GOOD");
  const [plannedQty, setPlannedQty] = useState("1");
  const [overheadCost, setOverheadCost] = useState("0");
  const [laborCost, setLaborCost] = useState("0");
  const [packagingCost, setPackagingCost] = useState("0");
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState("");

  const dashboardQuery = useProductionDashboard();
  const orders = dashboardQuery.data?.orders ?? [];
  const products = dashboardQuery.data?.products ?? [];
  const wipInventory = dashboardQuery.data?.wipInventory ?? [];
  const wipSummary = dashboardQuery.data?.wipSummary ?? null;

  const createMutation = useCreateProductionOrder();

  const cogsQuery = useProductCogs(productId, formOpen && !!productId);
  const cogsData = cogsQuery.data ?? null;

  const loading = dashboardQuery.isLoading || dashboardQuery.isFetching || createMutation.isPending;

  const loadData = () => dashboardQuery.refetch();

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === productId),
    [productId, products]
  );

  const filteredProducts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return products;
    return products.filter((product) =>
      [product.nama, product.kode, product.kategori]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    );
  }, [products, search]);

  const readyProducts = products.filter((product) => toNumber(product.total_bahan_baku) > 0).length;
  const draftOrders = orders.filter((order) => ["DRAFT", "RELEASED", "IN_PROGRESS"].includes(order.status)).length;
  const plannedQtyNumber = Math.max(0, toNumber(plannedQty));
  const additionalCosts = toNumber(overheadCost) + toNumber(laborCost) + toNumber(packagingCost);
  const estimatedMaterialCost = toNumber(cogsData?.total_bom_cost) * plannedQtyNumber;
  const estimatedTotalCost = estimatedMaterialCost + additionalCosts;
  const estimatedHpp = plannedQtyNumber > 0 ? estimatedTotalCost / plannedQtyNumber : 0;
  const materialShortages = (cogsData?.breakdown_bahan || []).filter(
    (material) => material.effective_qty * plannedQtyNumber > material.qty_available
  );

  useEffect(() => {
    if (dashboardQuery.isError) {
      console.error("Error loading production data:", dashboardQuery.error);
    }
  }, [dashboardQuery.isError, dashboardQuery.error]);

  const openProductionForm = (product: Product) => {
    setProductId(product.id);
    setOutputType("FINISHED_GOOD");
    setPlannedQty("1");
    setOverheadCost("0");
    setLaborCost("0");
    setPackagingCost("0");
    setMessage("");
    setFormOpen(true);
  };

  const createOrder = async () => {
    if (!productId || plannedQtyNumber <= 0) return;
    setMessage("");
    try {
      const result = await createMutation.mutateAsync({
        product_id: productId,
        output_type: outputType,
        planned_qty: plannedQtyNumber,
        overhead_cost: toNumber(overheadCost),
        labor_cost: toNumber(laborCost),
        packaging_cost: toNumber(packagingCost),
      });
      setMessage(result.message);
      if (result.ok) {
        setFormOpen(false);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal membuat produksi");
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-950">Produksi</h1>
          <p className="text-sm text-gray-500">Pilih produk yang akan diproduksi, cek BOM, stok bahan, dan buat production order.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={RM_ROUTES.productionRecipes}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-pink-700"
          >
            <BeakerIcon className="h-4 w-4" />
            Recipe / BOM
          </Link>
          <button
            type="button"
            onClick={loadData}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-pink-200 bg-white px-3 text-sm font-medium text-pink-700 shadow-sm hover:bg-pink-50"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">Total Produk</p>
          <p className="mt-2 text-2xl font-semibold text-gray-950">{products.length}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 shadow-sm">
          <p className="text-xs font-medium text-emerald-700">Siap Produksi</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-800">{readyProducts}</p>
        </div>
        <div className="rounded-xl border border-pink-100 bg-pink-50/70 p-4 shadow-sm">
          <p className="text-xs font-medium text-pink-700">Order Aktif</p>
          <p className="mt-2 text-2xl font-semibold text-pink-800">{draftOrders}</p>
        </div>
        <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-4 shadow-sm">
          <p className="text-xs font-medium text-sky-700">WIP Siap BOM</p>
          <p className="mt-2 text-2xl font-semibold text-sky-800">{wipSummary?.ready_wip || 0}</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-sky-100 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-sky-100 bg-sky-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-950">WIP Inventory</h2>
            <p className="text-xs text-gray-500">
              Output WIP yang sudah completed akan masuk stok bahan dan bisa dipakai sebagai komponen BOM produk final.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-sky-200 bg-white px-3 py-1 font-semibold text-sky-700">
              {wipSummary?.total_wip || 0} WIP
            </span>
            <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 font-semibold text-emerald-700">
              Nilai {formatCurrency(wipSummary?.total_value || 0)}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">WIP</th>
                <th className="px-4 py-3 text-left font-semibold">Source Product</th>
                <th className="px-4 py-3 text-right font-semibold">Stok</th>
                <th className="px-4 py-3 text-right font-semibold">HPP WIP</th>
                <th className="px-4 py-3 text-left font-semibold">Batch Terakhir</th>
                <th className="px-4 py-3 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {wipInventory.map((item) => (
                <tr key={item.id} className="hover:bg-sky-50/40">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-950">{displayName(item.nama)}</p>
                    <p className="text-xs text-gray-500">{item.kode}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{displayName(item.source_product?.nama) || "-"}</p>
                    <p className="text-xs text-gray-500">{item.source_product?.kode || "-"}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <p className={toNumber(item.qty_onhand) > 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-600"}>
                      {formatNumber(item.qty_onhand)} {item.satuan}
                    </p>
                    <p className="text-xs text-gray-500">{item.status_stok}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-pink-700">{formatCurrency(item.avg_cost)}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{item.latest_batch?.batch_number || "-"}</p>
                    <p className="text-xs text-gray-500">
                      {item.latest_batch ? `${formatNumber(item.latest_batch.qty_produced)} qty · ${formatDate(item.latest_batch.created_at)}` : "Belum ada batch"}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/dashboard/purchasing/reports/stock-card?material_id=${item.id}`}
                        className="rounded-lg border border-sky-200 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                      >
                        Stock Card
                      </Link>
                      <Link
                        href={RM_ROUTES.productionRecipes}
                        className="rounded-lg border border-pink-200 px-3 py-1.5 text-xs font-semibold text-pink-700 hover:bg-pink-50"
                      >
                        Pakai di BOM
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {wipInventory.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                    Belum ada WIP. Buat production order dengan output WIP, lalu release, start, dan complete.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-950">Produk Untuk Diproduksi</h2>
            <p className="text-xs text-gray-500">Produk dengan BOM lengkap bisa langsung dibuatkan production order.</p>
          </div>
          <label className="relative w-full sm:w-80">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari produk..."
              className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Produk</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Komponen</th>
                <th className="px-4 py-3 text-right font-semibold">HPP Estimasi</th>
                <th className="px-4 py-3 text-right font-semibold">Harga Jual</th>
                <th className="px-4 py-3 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProducts.map((product) => {
                const hasBom = toNumber(product.total_bahan_baku) > 0;
                return (
                  <tr key={product.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-950">{displayName(product.nama)}</p>
                      <p className="text-xs text-gray-500">{product.kategori || product.kode || "-"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                          hasBom
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {hasBom ? "Siap Produksi" : "BOM Belum Lengkap"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{formatNumber(product.total_bahan_baku)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-pink-700">{formatCurrency(product.hpp_estimasi)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(product.harga_jual)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`${PRODUCT_ROUTES.productsBom(product.id)}?from=production`}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Recipe
                        </Link>
                        <button
                          type="button"
                          onClick={() => openProductionForm(product)}
                          disabled={!hasBom}
                          className="inline-flex items-center gap-1 rounded-lg bg-pink-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <CubeIcon className="h-3.5 w-3.5" />
                          Buat Order
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                    Produk tidak ditemukan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-950">Production Orders Aktif</h2>
            <p className="text-xs text-gray-500">Gunakan halaman detail untuk release, start, complete, dan cancel.</p>
          </div>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">{orders.length} order</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">No Produksi</th>
                <th className="px-4 py-3 text-left font-semibold">Produk</th>
                <th className="px-4 py-3 text-right font-semibold">Qty</th>
                <th className="px-4 py-3 text-right font-semibold">Material</th>
                <th className="px-4 py-3 text-right font-semibold">HPP</th>
                <th className="px-4 py-3 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={RM_ROUTES.productionOrder(order.id)} className="font-semibold text-gray-950 hover:text-pink-700">
                      {order.nomor_produksi}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass(order.status)}`}>
                        {statusLabel(order.status)}
                      </span>
                      {order.output_type === "WIP" && (
                        <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                          WIP
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{displayName(order.product_nama)}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{formatNumber(toNumber(order.actual_qty) || toNumber(order.planned_qty))}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(order.actual_material_cost || order.planned_material_cost)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-pink-700">{formatCurrency(order.hpp_per_unit)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={RM_ROUTES.productionOrder(order.id)}
                      className="rounded-lg border border-pink-200 px-3 py-1.5 text-xs font-semibold text-pink-700 hover:bg-pink-50"
                    >
                      Detail
                    </Link>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                    Belum ada production order.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {formOpen && selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-950">Buat Production Order</h2>
                <p className="text-sm text-gray-500">{displayName(selectedProduct.nama)}</p>
              </div>
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(90vh-140px)] overflow-y-auto p-5">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-[180px_130px_1fr]">
                    <div className="space-y-1.5">
                      <span className="text-xs font-medium text-gray-500">Output</span>
                      <div className="grid h-11 grid-cols-2 rounded-lg border border-gray-200 bg-gray-50 p-1">
                        <button type="button" onClick={() => setOutputType("FINISHED_GOOD")} className={`rounded-md text-xs font-semibold transition ${outputType === "FINISHED_GOOD" ? "bg-white text-pink-700 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
                          Produk Jadi
                        </button>
                        <button type="button" onClick={() => setOutputType("WIP")} className={`rounded-md text-xs font-semibold transition ${outputType === "WIP" ? "bg-white text-pink-700 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
                          WIP
                        </button>
                      </div>
                    </div>
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-gray-500">Target Qty</span>
                      <input value={plannedQty} onChange={(event) => setPlannedQty(event.target.value)} type="number" min="0" className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100" />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-gray-500">Overhead</span>
                        <input value={overheadCost} onChange={(event) => setOverheadCost(event.target.value)} type="number" min="0" className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100" />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-gray-500">Labor</span>
                        <input value={laborCost} onChange={(event) => setLaborCost(event.target.value)} type="number" min="0" className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100" />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-gray-500">Packaging</span>
                        <input value={packagingCost} onChange={(event) => setPackagingCost(event.target.value)} type="number" min="0" className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100" />
                      </label>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-gray-100 bg-gray-50/70">
                    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                        <BeakerIcon className="h-4 w-4 text-pink-600" />
                        BOM & Stock Coverage
                      </div>
                      <span className="text-xs text-gray-500">{cogsData?.breakdown_bahan?.length || 0} bahan</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {(cogsData?.breakdown_bahan || []).map((material) => {
                        const requiredTotal = material.effective_qty * plannedQtyNumber;
                        const shortage = Math.max(0, requiredTotal - material.qty_available);
                        return (
                          <div key={material.bahan_id} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[1fr_120px_120px_120px] md:items-center">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium text-gray-900">{displayName(material.nama)}</p>
                                {material.material_type === "WIP" && (
                                  <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                                    WIP
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500">Waste {formatNumber(material.waste_percentage)}%</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">Kebutuhan</p>
                              <p className="font-medium">{formatNumber(requiredTotal)} {material.satuan}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">Stok</p>
                              <p className={shortage > 0 ? "font-medium text-red-600" : "font-medium text-gray-900"}>{formatNumber(material.qty_available)}</p>
                            </div>
                            <div className="text-left md:text-right">
                              <p className="text-xs text-gray-500">Shortage</p>
                              <p className={shortage > 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-600"}>
                                {shortage > 0 ? formatNumber(shortage) : "Cukup"}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                      {!cogsData?.breakdown_bahan?.length && (
                        <div className="px-4 py-8 text-center text-sm text-gray-500">
                          Produk belum memiliki BOM.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <aside className="space-y-3">
                  <div className="rounded-xl border border-pink-100 bg-pink-50/50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-pink-700">Preview HPP</p>
                    <h3 className="mt-1 text-lg font-semibold text-gray-950">{displayName(selectedProduct.nama)}</h3>
                    <p className="text-xs text-gray-500">
                      {outputType === "WIP" ? "Output masuk ke stok bahan WIP" : "Output masuk ke stok produk jadi"}
                    </p>
                    <div className="mt-4 grid gap-3">
                      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                        <p className="text-xs font-medium text-gray-500">Material Estimasi</p>
                        <p className="mt-1 text-lg font-semibold text-gray-950">{formatCurrency(estimatedMaterialCost)}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                        <p className="text-xs font-medium text-gray-500">Biaya Tambahan</p>
                        <p className="mt-1 text-lg font-semibold text-gray-950">{formatCurrency(additionalCosts)}</p>
                      </div>
                      <div className="rounded-lg border border-pink-100 bg-pink-50 px-4 py-3">
                        <p className="text-xs font-medium text-pink-700">HPP / Unit</p>
                        <p className="mt-1 text-lg font-semibold text-pink-800">{formatCurrency(estimatedHpp || selectedProduct.hpp_estimasi)}</p>
                      </div>
                      {materialShortages.length > 0 && (
                        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                          <div className="flex gap-2 font-semibold">
                            <ExclamationTriangleIcon className="h-4 w-4" />
                            {materialShortages.length} bahan kurang untuk target qty ini.
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={loading || !productId || plannedQtyNumber <= 0 || !cogsData?.breakdown_bahan?.length}
                      onClick={createOrder}
                      className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-pink-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CubeIcon className="h-4 w-4" />
                      Buat Production Order
                    </button>
                  </div>
                  {message && (
                    <div className="rounded-lg border border-pink-100 bg-pink-50 px-4 py-3 text-sm font-medium text-pink-700">
                      {message}
                    </div>
                  )}
                </aside>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
