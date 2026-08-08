"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelToolbar,
} from "@/components/ui/dialog";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingTablePagination } from "@/modules/purchasing/components/pagination/PurchasingTablePagination";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { formatAmount, formatDate } from "@/lib/purchasing/utils";
import { getProductionModuleConfig } from "../production-module";
import { useProductionDashboard, useProductionCogs } from "../queries";
import { useCreateProductionOrder, useUpdateProductionOrder } from "../mutations";
import { getProductionOrder } from "../api";
import type { ProductionOrder, ProductionProduct as Product } from "../types";
import {
  Beaker,
  Box,
  CheckCircle2,
  ClipboardList,
  Eye,
  Layers,
  Loader2,
  PackageCheck,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

const PAGE_SIZE = 10;

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

function statusClass(status: string) {
  if (status === "COMPLETED") return "border-emerald-200/80 bg-emerald-50 text-emerald-700";
  if (status === "IN_PROGRESS") return "border-sky-200/80 bg-sky-50 text-sky-700";
  if (status === "RELEASED") return "border-amber-200/80 bg-amber-50 text-amber-700";
  if (status === "CANCELLED") return "border-gray-200/80 bg-gray-50 text-gray-500";
  return "border-pink-200/80 bg-pink-50 text-pink-700";
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

type AdditionalCostType = "OVERHEAD" | "LABOR" | "PACKAGING" | "OTHER";

type AdditionalCostLine = {
  id: string;
  description: string;
  type: AdditionalCostType;
  amount: string;
};

const ADDITIONAL_COST_TYPES: Array<{ value: AdditionalCostType; label: string }> = [
  { value: "OVERHEAD", label: "Overhead" },
  { value: "LABOR", label: "Tenaga Kerja" },
  { value: "PACKAGING", label: "Kemasan" },
  { value: "OTHER", label: "Lainnya" },
];

function createAdditionalCostLine(): AdditionalCostLine {
  return {
    id: crypto.randomUUID(),
    description: "",
    type: "OVERHEAD",
    amount: "",
  };
}

function aggregateAdditionalCosts(lines: AdditionalCostLine[]) {
  let overhead = 0;
  let labor = 0;
  let packaging = 0;

  for (const line of lines) {
    const amount = Math.max(0, toNumber(line.amount));
    if (line.type === "LABOR") labor += amount;
    else if (line.type === "PACKAGING") packaging += amount;
    else overhead += amount;
  }

  return {
    overhead,
    labor,
    packaging,
    total: overhead + labor + packaging,
  };
}

type ProductionOrderDetail = {
  planned_qty: number | string;
  actual_qty: number | string;
  overhead_cost: number | string;
  labor_cost: number | string;
  packaging_cost: number | string;
  waste_cost: number | string;
  materials: Array<{
    id: string;
    qty_planned: number | string;
    qty_actual: number | string;
    waste_qty: number | string;
    stock?: {
      shortage_qty: number;
    } | null;
  }>;
};

type ProductionPageProps = {
  moduleType?: PurchasingModuleType;
};

export function ProductionPage({ moduleType = "raw_material" }: ProductionPageProps) {
  const config = getProductionModuleConfig(moduleType);
  const isProduct = config.isProduct;

  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [productPage, setProductPage] = useState(1);
  const [orderPage, setOrderPage] = useState(1);

  const [productId, setProductId] = useState("");
  const [plannedQty, setPlannedQty] = useState("1");
  const [additionalCostLines, setAdditionalCostLines] = useState<AdditionalCostLine[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [receiveOrder, setReceiveOrder] = useState<ProductionOrder | null>(null);
  const [receiveLoading, setReceiveLoading] = useState(false);
  const [orderAction, setOrderAction] = useState<{ id: string; type: string } | null>(null);

  const dashboardQuery = useProductionDashboard(moduleType);
  const orders = dashboardQuery.data?.orders ?? [];
  const products = dashboardQuery.data?.products ?? [];
  const wipInventory = dashboardQuery.data?.wipInventory ?? [];
  const wipSummary = dashboardQuery.data?.wipSummary ?? null;

  const createMutation = useCreateProductionOrder();
  const updateMutation = useUpdateProductionOrder();
  const cogsQuery = useProductionCogs(moduleType, productId, formOpen && !!productId);
  const cogsData = cogsQuery.data ?? null;

  const loading = dashboardQuery.isLoading;
  const refreshing = dashboardQuery.isFetching && !dashboardQuery.isLoading;

  useEffect(() => {
    if (dashboardQuery.isError) {
      toast.error(
        dashboardQuery.error instanceof Error
          ? dashboardQuery.error.message
          : "Gagal memuat data produksi"
      );
    }
  }, [dashboardQuery.isError, dashboardQuery.error]);

  useEffect(() => {
    if (!cogsQuery.isError) return;
    toast.error(
      cogsQuery.error instanceof Error
        ? cogsQuery.error.message
        : "Gagal memuat resep (BOM)"
    );
  }, [cogsQuery.isError, cogsQuery.error]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setProductSearch(productSearchQuery.trim());
      setProductPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [productSearchQuery]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === productId),
    [productId, products]
  );

  const bomLineItems = cogsData?.breakdown_bahan ?? [];
  const hasBomLines = bomLineItems.length > 0;

  const filteredProducts = useMemo(() => {
    const keyword = productSearch.toLowerCase();
    if (!keyword) return products;
    return products.filter((product) =>
      [product.nama, product.kode, product.kategori]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    );
  }, [products, productSearch]);

  const productTotalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const paginatedProducts = filteredProducts.slice(
    (productPage - 1) * PAGE_SIZE,
    productPage * PAGE_SIZE
  );

  const orderTotalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const paginatedOrders = orders.slice((orderPage - 1) * PAGE_SIZE, orderPage * PAGE_SIZE);

  const readyProducts = products.filter((product) => toNumber(product.total_bahan_baku) > 0).length;
  const draftOrders = orders.filter((order) =>
    ["DRAFT", "RELEASED", "IN_PROGRESS"].includes(order.status)
  ).length;
  const plannedQtyNumber = Math.max(0, toNumber(plannedQty));
  const aggregatedAdditionalCosts = useMemo(
    () => aggregateAdditionalCosts(additionalCostLines),
    [additionalCostLines]
  );
  const additionalCosts = aggregatedAdditionalCosts.total;
  const estimatedMaterialCost = toNumber(cogsData?.total_bom_cost) * plannedQtyNumber;
  const estimatedTotalCost = estimatedMaterialCost + additionalCosts;
  const estimatedHpp = plannedQtyNumber > 0 ? estimatedTotalCost / plannedQtyNumber : 0;
  const materialShortages = (cogsData?.breakdown_bahan || []).filter(
    (material) => material.effective_qty * plannedQtyNumber > material.qty_available
  );

  const openProductionForm = (product: Product) => {
    setProductId(product.id);
    setPlannedQty("1");
    setAdditionalCostLines([createAdditionalCostLine()]);
    setFormOpen(true);
  };

  const addAdditionalCostLine = () => {
    setAdditionalCostLines((lines) => [...lines, createAdditionalCostLine()]);
  };

  const updateAdditionalCostLine = (id: string, changes: Partial<AdditionalCostLine>) => {
    setAdditionalCostLines((lines) =>
      lines.map((line) => (line.id === id ? { ...line, ...changes } : line))
    );
  };

  const removeAdditionalCostLine = (id: string) => {
    setAdditionalCostLines((lines) => {
      const next = lines.filter((line) => line.id !== id);
      return next.length > 0 ? next : [createAdditionalCostLine()];
    });
  };

  const handleRefresh = async () => {
    try {
      await dashboardQuery.refetch();
      toast.success("Data produksi diperbarui");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui data produksi");
    }
  };

  const createOrder = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!productId || plannedQtyNumber <= 0) return;

    const productOutputType =
      selectedProduct?.production_output_type === "WIP" ? "WIP" : "FINISHED_GOOD";
    const { overhead, labor, packaging } = aggregatedAdditionalCosts;

    try {
      const result = await createMutation.mutateAsync(
        isProduct
          ? {
              production_context: "product",
              product_id: productId,
              output_type: productOutputType,
              planned_qty: plannedQtyNumber,
              overhead_cost: overhead,
              labor_cost: labor,
              packaging_cost: packaging,
            }
          : {
              production_context: "raw_material",
              raw_material_id: productId,
              planned_qty: plannedQtyNumber,
              overhead_cost: overhead,
              labor_cost: labor,
              packaging_cost: packaging,
            }
      );

      if (result.ok) {
        toast.success(
          result.message ||
            "Order produksi dibuat. Gunakan Dirilis di daftar order untuk melanjutkan alur."
        );
        setFormOpen(false);
        setOrderPage(1);
      } else {
        toast.error(result.message || "Gagal membuat order produksi");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membuat order produksi");
    }
  };

  const runOrderAction = async (orderId: string, action: "release" | "start") => {
    setOrderAction({ id: orderId, type: action });
    try {
      const result = await updateMutation.mutateAsync({ id: orderId, payload: { action } });
      if (result.ok) {
        toast.success(result.message || `Order produksi ${action === "release" ? "dirilis" : "dimulai"}`);
        await dashboardQuery.refetch();
      } else {
        toast.error(result.message || "Gagal memperbarui order produksi");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui order produksi");
    } finally {
      setOrderAction(null);
    }
  };

  const confirmReceive = async () => {
    if (!receiveOrder) return;
    setReceiveLoading(true);
    try {
      const detail = await getProductionOrder<ProductionOrderDetail>(receiveOrder.id);
      const shortages = detail.materials.filter(
        (material) => toNumber(material.stock?.shortage_qty) > 0
      );
      if (shortages.length > 0) {
        toast.error(
          `Tidak dapat menerima output: ${shortages.length} bahan kurang stok. Buka detail order untuk meninjau stok.`
        );
        return;
      }

      const result = await updateMutation.mutateAsync({
        id: receiveOrder.id,
        payload: {
          action: "complete",
          actual_qty: toNumber(detail.actual_qty) || toNumber(detail.planned_qty),
          overhead_cost: toNumber(detail.overhead_cost),
          labor_cost: toNumber(detail.labor_cost),
          packaging_cost: toNumber(detail.packaging_cost),
          waste_cost: toNumber(detail.waste_cost),
          materials: detail.materials.map((material) => ({
            id: material.id,
            qty_actual: toNumber(material.qty_actual || material.qty_planned),
            waste_qty: toNumber(material.waste_qty),
          })),
        },
      });

      if (result.ok) {
        toast.success(result.message || "Output diterima ke inventori");
        setReceiveOrder(null);
        await dashboardQuery.refetch();
      } else {
        toast.error(result.message || "Gagal menerima output produksi");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menerima output produksi");
    } finally {
      setReceiveLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title={isProduct ? "Produksi Internal" : "Produksi Bahan Baku"}
        description={
          <>
            {isProduct
              ? "Pilih produk untuk diproduksi, tinjau kelengkapan resep (BOM), dan buat order produksi"
              : "Pilih bahan baku untuk diproduksi internal, tinjau kelengkapan komponen, dan buat order produksi"}
            {" — "}
            {products.length} {isProduct ? "produk" : "bahan baku"}
          </>
        }
        actions={
          <>
            <Link href={config.productionRecipesRoute}>
              <Button
                variant="outline"
                className="h-10 w-full gap-2 rounded-lg border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700 sm:w-auto"
              >
                <Beaker className="h-4 w-4" />
                Resep (BOM)
              </Button>
            </Link>
            <Button
              type="button"
              variant="outline"
              onClick={handleRefresh}
              disabled={refreshing}
              className="h-10 w-full gap-2 rounded-lg border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700 sm:w-auto"
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Muat Ulang
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Total {isProduct ? "Produk" : "Bahan Baku"}
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{products.length}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-600">
              Siap diproduksi
            </p>
            <p className="mt-1 text-2xl font-bold text-emerald-700">{readyProducts}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-pink-600">Order Aktif</p>
            <p className="mt-1 text-2xl font-bold text-pink-700">{draftOrders}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-sky-600">WIP Siap untuk BOM</p>
            <p className="mt-1 text-2xl font-bold text-sky-700">{wipSummary?.ready_wip || 0}</p>
          </CardContent>
        </Card>
      </div>

      <PurchasingListSection
        icon={Layers}
        title="Stok WIP"
        description="Output WIP yang selesai ditambahkan ke stok bahan dan dapat dipakai sebagai komponen resep (BOM)."
        toolbar={
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="border-sky-200/80 bg-white text-sky-700">
              {wipSummary?.total_wip || 0} item WIP
            </Badge>
            <Badge variant="outline" className="border-emerald-200/80 bg-white text-emerald-700">
              Nilai {formatAmount(wipSummary?.total_value || 0)}
            </Badge>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">WIP</th>
                <th className="px-4 py-3 text-left font-semibold">Produk Sumber</th>
                <th className="px-4 py-3 text-right font-semibold">Stok</th>
                <th className="px-4 py-3 text-right font-semibold">HPP WIP</th>
                <th className="px-4 py-3 text-left font-semibold">Batch Terakhir</th>
                <th className="px-4 py-3 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-pink-600" />
                    Memuat stok WIP...
                  </td>
                </tr>
              ) : wipInventory.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                    Belum ada item WIP. Buat order produksi dengan output WIP, lalu dirilis, mulai, dan selesaikan.
                  </td>
                </tr>
              ) : (
                wipInventory.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{displayName(item.nama)}</p>
                      <p className="text-xs text-gray-500">{item.kode}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">
                        {displayName(item.source_product?.nama) || "-"}
                      </p>
                      <p className="text-xs text-gray-500">{item.source_product?.kode || "-"}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p
                        className={
                          toNumber(item.qty_onhand) > 0
                            ? "font-semibold text-emerald-700"
                            : "font-semibold text-red-600"
                        }
                      >
                        {formatQty(item.qty_onhand)} {item.satuan}
                      </p>
                      <p className="text-xs text-gray-500">{item.status_stok}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-pink-700">
                      {formatAmount(item.avg_cost)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">
                        {item.latest_batch?.batch_number || "-"}
                      </p>
                      <p className="text-xs text-gray-500">
                        {item.latest_batch
                          ? `${formatQty(item.latest_batch.qty_produced)} qty · ${formatDate(item.latest_batch.created_at)}`
                          : "Belum ada batch"}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Link href={config.stockCardRoute(item.id)}>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Lihat kartu stok"
                            className="cursor-pointer"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Link href={config.productionRecipesRoute}>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Gunakan di resep (BOM)"
                            className="cursor-pointer"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </PurchasingListSection>

      <PurchasingListSection
        icon={Box}
        title={isProduct ? "Produk untuk Produksi" : "Bahan Baku untuk Produksi"}
        description={
          isProduct
            ? "Produk dengan resep (BOM) lengkap dapat diubah menjadi order produksi."
            : "Bahan baku dengan resep (BOM) lengkap dapat diproduksi internal."
        }
        toolbar={
          <label className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder={isProduct ? "Cari nama, kode, atau kategori produk..." : "Cari nama atau kode bahan baku..."}
              value={productSearchQuery}
              onChange={(event) => setProductSearchQuery(event.target.value)}
              className="h-10 bg-white pl-10 pr-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
            />
            {productSearchQuery && (
              <button
                type="button"
                onClick={() => setProductSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700"
                aria-label="Hapus pencarian"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
        }
      >
        <div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">{isProduct ? "Produk" : "Bahan Baku"}</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Komponen</th>
                  <th className="px-4 py-3 text-right font-semibold">Estimasi HPP</th>
                  {isProduct && (
                    <th className="px-4 py-3 text-right font-semibold">Harga Jual</th>
                  )}
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={isProduct ? 6 : 5} className="px-4 py-12 text-center text-sm text-gray-500">
                      {isProduct ? "Memuat produk..." : "Memuat bahan baku..."}
                    </td>
                  </tr>
                ) : paginatedProducts.length === 0 ? (
                  <tr>
                    <td colSpan={isProduct ? 6 : 5} className="px-4 py-12 text-center text-sm text-gray-500">
                      Tidak ada {isProduct ? "produk" : "bahan baku"} yang cocok dengan pencarian.
                    </td>
                  </tr>
                ) : (
                  paginatedProducts.map((product) => {
                    const hasBom = toNumber(product.total_bahan_baku) > 0;
                    return (
                      <tr key={product.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{displayName(product.nama)}</p>
                          <p className="text-xs text-gray-500">
                            {product.kode || "-"}
                            {product.kategori ? ` · ${product.kategori}` : ""}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={
                              hasBom
                                ? "border-emerald-200/80 bg-emerald-50 text-emerald-700"
                                : "border-amber-200/80 bg-amber-50 text-amber-700"
                            }
                          >
                            {hasBom ? "Siap diproduksi" : "Resep (BOM) belum lengkap"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          {formatQty(product.total_bahan_baku)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-pink-700">
                          {formatAmount(product.hpp_estimasi)}
                        </td>
                        {isProduct && (
                          <td className="px-4 py-3 text-right text-gray-700">
                            {formatAmount(product.harga_jual)}
                          </td>
                        )}
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Link href={`${config.bomEditorRoute(product.id)}?from=production`}>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Edit resep"
                                className="cursor-pointer"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              title="Buat order produksi"
                              className="cursor-pointer disabled:opacity-40"
                              disabled={!hasBom}
                              onClick={() => openProductionForm(product)}
                            >
                              <Box className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {!loading && filteredProducts.length > 0 && (
            <PurchasingTablePagination
              page={productPage}
              totalPages={productTotalPages}
              totalItems={filteredProducts.length}
              pageSize={PAGE_SIZE}
              onPageChange={setProductPage}
            />
          )}
        </div>
      </PurchasingListSection>

      <PurchasingListSection
        icon={ClipboardList}
        title="Order Produksi Aktif"
        description="Order baru dimulai sebagai Draf. Dirilis untuk reservasi bahan, Mulai untuk memulai produksi, dan Terima untuk memposting output ke inventori."
        toolbar={
          <Badge variant="outline" className="border-gray-200/80 bg-gray-50 text-gray-600">
            {orders.length} order
          </Badge>
        }
      >
        <div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Nomor Produksi</th>
                  <th className="px-4 py-3 text-left font-semibold">{isProduct ? "Produk" : "Bahan Baku"}</th>
                  <th className="px-4 py-3 text-right font-semibold">Kuantitas</th>
                  <th className="px-4 py-3 text-right font-semibold">Biaya Bahan</th>
                  <th className="px-4 py-3 text-right font-semibold">HPP / Unit</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                      Memuat order produksi...
                    </td>
                  </tr>
                ) : paginatedOrders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                      Belum ada order produksi.
                    </td>
                  </tr>
                ) : (
                  paginatedOrders.map((order) => {
                    const rowActionLoading = orderAction?.id === order.id;
                    const releaseLoading = rowActionLoading && orderAction?.type === "release";
                    const startLoading = rowActionLoading && orderAction?.type === "start";

                    return (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link
                          href={config.productionOrderRoute(order.id)}
                          className="font-medium text-pink-700 hover:underline"
                        >
                          {order.nomor_produksi}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="outline" className={statusClass(order.status)}>
                            {statusLabel(order.status)}
                          </Badge>
                          {order.output_type === "WIP" && (
                            <Badge
                              variant="outline"
                              className="border-sky-200/80 bg-sky-50 text-sky-700"
                            >
                              WIP
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">
                          {displayName(order.item_nama || order.product_nama || order.output_raw_material_nama)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatQty(toNumber(order.actual_qty) || toNumber(order.planned_qty))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {formatAmount(order.actual_material_cost || order.planned_material_cost)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-pink-700">
                        {formatAmount(order.hpp_per_unit)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link href={config.productionOrderRoute(order.id)}>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Lihat detail order"
                              className="cursor-pointer"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          {order.status === "DRAFT" && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              title="Dirilis order"
                              disabled={rowActionLoading || receiveLoading}
                              onClick={() => runOrderAction(order.id, "release")}
                              className="h-8 gap-1.5 border-amber-200/80 px-2.5 text-xs font-medium text-amber-700 hover:bg-amber-50"
                            >
                              {releaseLoading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              )}
                              Dirilis
                            </Button>
                          )}
                          {order.status === "RELEASED" && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              title="Mulai produksi"
                              disabled={rowActionLoading || receiveLoading}
                              onClick={() => runOrderAction(order.id, "start")}
                              className="h-8 gap-1.5 border-sky-200/80 px-2.5 text-xs font-medium text-sky-700 hover:bg-sky-50"
                            >
                              {startLoading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Play className="h-3.5 w-3.5" />
                              )}
                              Mulai
                            </Button>
                          )}
                          {order.status === "IN_PROGRESS" && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              title="Terima output ke inventori"
                              disabled={rowActionLoading || receiveLoading}
                              onClick={() => setReceiveOrder(order)}
                              className="h-8 gap-1.5 border-pink-200/80 px-2.5 text-xs font-medium text-pink-700 hover:bg-pink-50"
                            >
                              <PackageCheck className="h-3.5 w-3.5" />
                              Terima
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {!loading && orders.length > 0 && (
            <PurchasingTablePagination
              page={orderPage}
              totalPages={orderTotalPages}
              totalItems={orders.length}
              pageSize={PAGE_SIZE}
              onPageChange={setOrderPage}
            />
          )}
        </div>
      </PurchasingListSection>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogPanel size="2xl" className="max-h-[min(92vh,960px)]">
          <DialogPanelForm onSubmit={createOrder}>
            <DialogPanelHeader>
              <DialogPanelTitle>Buat Order Produksi</DialogPanelTitle>
              <DialogPanelDescription>
                Atur kuantitas output, tinjau kelengkapan resep (BOM), dan kirim order produksi draf.
              </DialogPanelDescription>
            </DialogPanelHeader>

            {selectedProduct && (
              <>
                <DialogPanelToolbar>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {displayName(selectedProduct.nama)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {selectedProduct.kode || "-"}
                        {selectedProduct.kategori ? ` · ${selectedProduct.kategori}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {isProduct && (
                        <Badge
                          variant="outline"
                          className={
                            selectedProduct.production_output_type === "WIP"
                              ? "border-sky-200/80 bg-sky-50 text-sky-700"
                              : "border-emerald-200/80 bg-emerald-50 text-emerald-700"
                          }
                        >
                          {selectedProduct.production_output_type === "WIP"
                            ? "WIP"
                            : "Barang Jadi"}
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className="border-emerald-200/80 bg-emerald-50 text-emerald-700"
                      >
                        {formatQty(selectedProduct.total_bahan_baku)} komponen
                      </Badge>
                      <Badge
                        variant="outline"
                        className="border-pink-200/80 bg-pink-50 text-pink-700"
                      >
                        Est. HPP {formatAmount(selectedProduct.hpp_estimasi)}
                      </Badge>
                      {materialShortages.length > 0 && (
                        <Badge
                          variant="outline"
                          className="border-red-200/80 bg-red-50 text-red-700"
                        >
                          {materialShortages.length} kekurangan
                        </Badge>
                      )}
                    </div>
                  </div>
                </DialogPanelToolbar>

                <DialogPanelBody className="space-y-5">
                  <Card className="border-gray-200/70 shadow-xs">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Kuantitas Target</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="max-w-xs space-y-2">
                        <Label className="text-xs text-gray-600">
                          Kuantitas <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          value={plannedQty}
                          onChange={(event) => setPlannedQty(event.target.value)}
                          type="number"
                          min="0"
                          step="any"
                          className="h-10 text-sm focus:border-pink-400 focus:ring-1 focus:ring-pink-100"
                        />
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-gray-200/70 shadow-xs">
                    <CardHeader className="flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Beaker className="h-4 w-4 text-pink-600" />
                          Resep (BOM)
                        </CardTitle>
                        <p className="mt-1 text-xs text-gray-500">
                          Komponen yang dibutuhkan untuk {formatQty(plannedQtyNumber)} unit
                          {hasBomLines ? ` · ${bomLineItems.length} bahan` : ""}
                        </p>
                      </div>
                      {productId && (
                        <Link href={`${config.bomEditorRoute(productId)}?from=production`}>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-9 border-gray-200/80 text-xs"
                          >
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Edit BOM
                          </Button>
                        </Link>
                      )}
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="min-w-[960px] w-full text-sm">
                          <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                            <tr>
                              <th className="px-4 py-3 text-left font-semibold">Bahan</th>
                              <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Satuan</th>
                              <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">
                                Qty Resep
                              </th>
                              <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">
                                Dibutuhkan
                              </th>
                              <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">
                                Stok
                              </th>
                              <th className="px-4 py-3 text-center font-semibold whitespace-nowrap">
                                Status
                              </th>
                              <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">
                                Biaya Baris
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {cogsQuery.isLoading ? (
                              <tr>
                                <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-500">
                                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-pink-600" />
                                  Memuat resep (BOM)...
                                </td>
                              </tr>
                            ) : cogsQuery.isError ? (
                              <tr>
                                <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-500">
                                  <p>Gagal memuat resep (BOM).</p>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="mt-3"
                                    onClick={() => void cogsQuery.refetch()}
                                  >
                                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                    Coba Lagi
                                  </Button>
                                </td>
                              </tr>
                            ) : !hasBomLines ? (
                              <tr>
                                <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-500">
                                  <p>
                                    {isProduct ? "Produk" : "Bahan baku"} ini belum memiliki resep (BOM).
                                  </p>
                                  {productId && (
                                    <Link href={`${config.bomEditorRoute(productId)}?from=production`}>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="mt-3 border-pink-200 text-pink-700 hover:bg-pink-50"
                                      >
                                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                        Atur Resep (BOM)
                                      </Button>
                                    </Link>
                                  )}
                                </td>
                              </tr>
                            ) : (
                              bomLineItems.map((material) => {
                                const requiredTotal = material.effective_qty * plannedQtyNumber;
                                const lineTotal = material.subtotal * plannedQtyNumber;
                                const shortage = Math.max(0, requiredTotal - material.qty_available);
                                return (
                                  <tr key={material.bahan_id} className="hover:bg-gray-50/80">
                                    <td className="px-4 py-3 align-top">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-medium text-gray-900">
                                          {displayName(material.nama)}
                                        </p>
                                        {material.material_type === "WIP" && (
                                          <Badge
                                            variant="outline"
                                            className="border-sky-200/80 bg-sky-50 text-xs text-sky-700"
                                          >
                                            WIP
                                          </Badge>
                                        )}
                                      </div>
                                      <p className="mt-0.5 text-xs text-gray-500">{material.kode || "-"}</p>
                                    </td>
                                    <td className="px-4 py-3 align-top whitespace-nowrap">
                                      <Badge
                                        variant="outline"
                                        className="border-gray-200/80 bg-gray-50 font-normal text-gray-700"
                                      >
                                        {material.satuan || "-"}
                                      </Badge>
                                    </td>
                                    <td className="px-4 py-3 text-right align-top tabular-nums text-gray-700 whitespace-nowrap">
                                      <p>{formatQty(material.jumlah)}</p>
                                      <p className="text-xs text-gray-500">
                                        Susut {formatQty(material.waste_percentage)}%
                                      </p>
                                    </td>
                                    <td className="px-4 py-3 text-right align-top tabular-nums font-medium text-gray-900 whitespace-nowrap">
                                      {formatQty(requiredTotal)}
                                    </td>
                                    <td className="px-4 py-3 text-right align-top tabular-nums whitespace-nowrap">
                                      <span
                                        className={
                                          shortage > 0
                                            ? "font-medium text-red-600"
                                            : "font-medium text-gray-900"
                                        }
                                      >
                                        {formatQty(material.qty_available)}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-center align-top whitespace-nowrap">
                                      {shortage > 0 ? (
                                        <Badge
                                          variant="outline"
                                          className="border-red-200/80 bg-red-50 text-red-700"
                                        >
                                          Kurang {formatQty(shortage)}
                                        </Badge>
                                      ) : (
                                        <Badge
                                          variant="outline"
                                          className="border-emerald-200/80 bg-emerald-50 text-emerald-700"
                                        >
                                          Cukup
                                        </Badge>
                                      )}
                                    </td>
                                    <td className="px-4 py-3 text-right align-top tabular-nums whitespace-nowrap">
                                      <p className="font-semibold text-pink-700">
                                        {formatAmount(lineTotal)}
                                      </p>
                                      <p className="text-xs text-gray-500">
                                        @ {formatAmount(material.unit_cost)}
                                      </p>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                          {hasBomLines && !cogsQuery.isLoading && (
                            <tfoot className="border-t border-gray-200/70 bg-gray-50/80">
                              <tr>
                                <td
                                  colSpan={6}
                                  className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500"
                                >
                                  Total biaya bahan
                                </td>
                                <td className="px-4 py-3 text-right text-base font-bold tabular-nums text-pink-700">
                                  {formatAmount(estimatedMaterialCost)}
                                </td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-gray-200/70 shadow-xs">
                    <CardHeader className="flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <CardTitle className="text-base">Biaya Tambahan</CardTitle>
                        <p className="mt-1 text-xs text-gray-500">
                          Tambahkan overhead, tenaga kerja, kemasan, atau biaya produksi lainnya.
                        </p>
                      </div>
                      <CardAction>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 border-gray-200/80 text-xs"
                          onClick={addAdditionalCostLine}
                        >
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                          Tambah Baris
                        </Button>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="min-w-[720px] w-full text-sm">
                          <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                            <tr>
                              <th className="px-4 py-3 text-left font-semibold">Keterangan</th>
                              <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Tipe</th>
                              <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">Nominal</th>
                              <th className="px-4 py-3 text-right font-semibold whitespace-nowrap w-16">
                                Aksi
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {additionalCostLines.map((line) => (
                              <tr key={line.id} className="hover:bg-gray-50/80">
                                <td className="px-4 py-3 align-middle">
                                  <Input
                                    value={line.description}
                                    onChange={(event) =>
                                      updateAdditionalCostLine(line.id, {
                                        description: event.target.value,
                                      })
                                    }
                                    placeholder="mis. Tenaga kerja shift, kemasan box"
                                    className="h-10 text-sm focus:border-pink-400 focus:ring-1 focus:ring-pink-100"
                                  />
                                </td>
                                <td className="px-4 py-3 align-middle whitespace-nowrap">
                                  <Select
                                    value={line.type}
                                    onValueChange={(value) =>
                                      updateAdditionalCostLine(line.id, {
                                        type: value as AdditionalCostType,
                                      })
                                    }
                                  >
                                    <SelectTrigger className="h-10 w-full min-w-[140px] border-gray-200/80">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {ADDITIONAL_COST_TYPES.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                          {option.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="px-4 py-3 align-middle">
                                  <Input
                                    value={line.amount}
                                    onChange={(event) =>
                                      updateAdditionalCostLine(line.id, {
                                        amount: event.target.value,
                                      })
                                    }
                                    type="number"
                                    min="0"
                                    step="any"
                                    placeholder="0"
                                    className="h-10 text-right text-sm focus:border-pink-400 focus:ring-1 focus:ring-pink-100"
                                  />
                                </td>
                                <td className="px-4 py-3 text-right align-middle">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeAdditionalCostLine(line.id)}
                                    title="Hapus baris"
                                    className="text-gray-400 hover:bg-red-50 hover:text-red-600"
                                    aria-label="Hapus baris biaya tambahan"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="border-t border-gray-200/70 bg-gray-50/80">
                            <tr>
                              <td
                                colSpan={2}
                                className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500"
                              >
                                Total biaya tambahan
                              </td>
                              <td className="px-4 py-3 text-right text-base font-bold tabular-nums text-gray-900">
                                {formatAmount(additionalCosts)}
                              </td>
                              <td className="px-4 py-3" />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-pink-100/80 bg-pink-50/40 shadow-xs">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold text-pink-800">
                        Pratinjau HPP
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-600">Bahan</span>
                        <span className="font-semibold tabular-nums text-gray-900">
                          {formatAmount(estimatedMaterialCost)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-600">Tambahan</span>
                        <span className="font-semibold tabular-nums text-gray-900">
                          {formatAmount(additionalCosts)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 border-t border-pink-100/80 pt-2">
                        <span className="font-medium text-pink-700">HPP / Unit</span>
                        <span className="text-base font-bold tabular-nums text-pink-800">
                          {formatAmount(estimatedHpp || selectedProduct.hpp_estimasi)}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </DialogPanelBody>
              </>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
                disabled={createMutation.isPending}
                className="purchasing-secondary-button"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={
                  createMutation.isPending ||
                  !productId ||
                  plannedQtyNumber <= 0 ||
                  cogsQuery.isLoading ||
                  !hasBomLines
                }
                className="purchasing-main-button gap-2"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Membuat...
                  </>
                ) : (
                  <>
                    <Box className="h-4 w-4" />
                    Buat Order Produksi
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogPanelForm>
        </DialogPanel>
      </Dialog>

      <Dialog open={!!receiveOrder} onOpenChange={(open) => !open && !receiveLoading && setReceiveOrder(null)}>
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Terima Output Produksi</DialogPanelTitle>
            <DialogPanelDescription>
              Posting kuantitas rencana dan pemakaian bahan ke inventori untuk{" "}
              <span className="font-medium text-gray-900">{receiveOrder?.nomor_produksi}</span>.
              Sesuaikan kuantitas di halaman detail order jika pemakaian aktual berbeda.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReceiveOrder(null)}
              disabled={receiveLoading}
              className="purchasing-secondary-button"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => void confirmReceive()}
              disabled={receiveLoading}
              className="purchasing-main-button gap-2"
            >
              {receiveLoading ? (
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
      </Dialog>
    </div>
  );
}
