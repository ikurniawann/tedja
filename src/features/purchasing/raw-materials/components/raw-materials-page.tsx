"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import { ITEMS_RAW_MATERIALS_PATH, RM_ROUTES } from "@/modules/purchasing/constants/items-nav";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingTablePagination } from "@/modules/purchasing/components/pagination/PurchasingTablePagination";
import {
  AlertCircle,
  Eye,
  Filter,
  Loader2,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  Download,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { RawMaterialWithStock, MaterialCategory } from "@/types/purchasing";
import { useRawMaterialList, useRawMaterialCategoryOptions } from "../queries";
import { useDeleteRawMaterial, useUpdateRawMaterialStatus } from "../mutations";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  buildLookupLabelMap,
  resolveCategoryLabel,
  toLookupOptions,
} from "../master-lookups";
import { formatAmount } from "@/lib/purchasing/utils";

const STATUS_OPTIONS = [
  { value: "all", label: "All Stock Statuses" },
  { value: "below_minimum", label: "Low or Out of Stock" },
];

const STOCK_STATUS_STYLES: Record<string, string> = {
  AMAN: "border-emerald-200 bg-emerald-50 text-emerald-700",
  MENIPIS: "border-amber-200 bg-amber-50 text-amber-700",
  HABIS: "border-red-200 bg-red-50 text-red-700",
};

const STOCK_STATUS_LABELS: Record<string, string> = {
  AMAN: "Safe",
  MENIPIS: "Low Stock",
  HABIS: "Out of Stock",
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatQty(value?: number | null) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function RawMaterialsPage() {
  const [page, setPage] = useState(1);
  const limit = 10;
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<MaterialCategory | "all">("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingMaterial, setDeletingMaterial] = useState<RawMaterialWithStock | null>(null);
  const [statusDialog, setStatusDialog] = useState<{
    open: boolean;
    material: RawMaterialWithStock | null;
    nextStatus: boolean;
  }>({
    open: false,
    material: null,
    nextStatus: true,
  });
  const [exporting, setExporting] = useState(false);

  const listQuery = useRawMaterialList({
    search: search || undefined,
    kategori: categoryFilter === "all" ? undefined : categoryFilter,
    below_minimum: statusFilter === "below_minimum",
    page,
    limit,
    sort_by: "nama",
    sort_dir: "ASC",
  });
  const categoriesQuery = useRawMaterialCategoryOptions();
  const categoryMap = buildLookupLabelMap(categoriesQuery.data);
  const categoryFilterOptions = [
    { value: "all", label: "All Categories" },
    ...toLookupOptions(categoriesQuery.data),
  ];
  const materials = listQuery.data?.data ?? [];
  const loading = listQuery.isLoading;
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = listQuery.data?.pagination.total_pages ?? 1;

  const deleteMutation = useDeleteRawMaterial();
  const statusMutation = useUpdateRawMaterialStatus();
  const isDeleting = deleteMutation.isPending;
  const statusUpdatingId = statusMutation.isPending ? statusMutation.variables?.id ?? null : null;

  const stockSummary = useMemo(() => {
    return materials.reduce(
      (acc, material) => {
        const status = material.status_stok ?? "AMAN";
        if (status === "MENIPIS") acc.low += 1;
        else if (status === "HABIS") acc.out += 1;
        else acc.safe += 1;
        if (material.is_active !== false) acc.active += 1;
        return acc;
      },
      { safe: 0, low: 0, out: 0, active: 0 }
    );
  }, [materials]);

  useEffect(() => {
    if (listQuery.isError) {
      console.error("Error loading materials:", listQuery.error);
      toast.error(`Failed to load raw materials: ${getErrorMessage(listQuery.error, "Unknown error")}`);
    }
  }, [listQuery.isError, listQuery.error]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const getCategoryLabel = (category?: MaterialCategory | null) =>
    resolveCategoryLabel(category, categoryMap);

  const getStockStatusBadge = (status: string) => {
    const normalized = status || "AMAN";
    return (
      <Badge variant="outline" className={STOCK_STATUS_STYLES[normalized] || STOCK_STATUS_STYLES.AMAN}>
        {normalized === "MENIPIS" || normalized === "HABIS" ? (
          <AlertCircle className="mr-1 inline h-3 w-3" />
        ) : null}
        {STOCK_STATUS_LABELS[normalized] || normalized}
      </Badge>
    );
  };

  const handleResetFilters = () => {
    setSearchQuery("");
    setSearch("");
    setCategoryFilter("all");
    setStatusFilter("all");
    setPage(1);
  };

  const isFilterActive = categoryFilter !== "all" || statusFilter !== "all";
  const activeFilterCount = Number(categoryFilter !== "all") + Number(statusFilter !== "all");

  const handleConfirmToggleStatus = async () => {
    const material = statusDialog.material;
    if (!material || statusMutation.isPending) return;

    try {
      await statusMutation.mutateAsync({ id: material.id, isActive: statusDialog.nextStatus });
      toast.success(`Raw material ${statusDialog.nextStatus ? "activated" : "deactivated"} successfully.`);
      setStatusDialog({ open: false, material: null, nextStatus: true });
    } catch (error: unknown) {
      console.error("Error updating raw material status:", error);
      toast.error(`Failed to update status: ${getErrorMessage(error, "Unknown error")}`);
    }
  };

  const handleOpenDelete = (material: RawMaterialWithStock) => {
    setDeletingMaterial(material);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingMaterial || isDeleting) return;

    try {
      await deleteMutation.mutateAsync(deletingMaterial.id);
      toast.success("Raw material deleted successfully.");
      setDeleteDialogOpen(false);
      setDeletingMaterial(null);
    } catch (error: unknown) {
      console.error("Error deleting raw material:", error);
      toast.error(`Failed to delete raw material: ${getErrorMessage(error, "Unknown error")}`);
    }
  };

  const handleExport = async () => {
    if (exporting) return;

    setExporting(true);
    try {
      const response = await fetch("/api/purchasing/export/raw-materials");
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message || "Export failed");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename =
        match?.[1] || `raw-materials-${new Date().toISOString().split("T")[0]}.xlsx`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);

      toast.success("Raw materials exported to Excel.");
    } catch (error: unknown) {
      console.error("Error exporting raw materials:", error);
      toast.error(`Failed to export: ${getErrorMessage(error, "Unknown error")}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Raw Material Master Data</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage raw material records, categories, chart of accounts, and stock indicators — {total} total
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Link href={RM_ROUTES.materialsImport}>
            <Button
              variant="outline"
              className="purchasing-secondary-button w-full sm:w-auto"
            >
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
          </Link>
          <Link href={`${ITEMS_RAW_MATERIALS_PATH}/insert`}>
            <Button className="purchasing-main-button w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Add Raw Material
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Total Materials", value: total, className: "text-gray-900" },
          { label: "Safe Stock", value: stockSummary.safe, className: "text-emerald-700" },
          { label: "Low Stock", value: stockSummary.low, className: "text-amber-700" },
          { label: "Out of Stock", value: stockSummary.out, className: "text-red-700" },
        ].map((stat) => (
          <Card key={stat.label} className="border-gray-200/70 shadow-xs">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-gray-500">{stat.label}</p>
              <p className={`mt-1 text-2xl font-bold ${stat.className}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <PurchasingListSection
        icon={Package}
        title="Raw Material List"
        description="Review material code, category, chart of accounts mapping, available stock, average cost, and active status."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-96">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search code, name, or category..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-white pl-10 pr-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>

            <Button
              type="button"
              variant="outline"
              onClick={() => setFilterOpen((open) => !open)}
              className={
                isFilterActive
                  ? "h-10 gap-2 rounded-lg border-pink-600 bg-pink-600 px-3 text-sm font-semibold !text-white shadow-sm hover:!border-pink-700 hover:!bg-pink-700 hover:!text-white [&_*]:!text-white [&_svg]:!text-white"
                  : "h-10 gap-2 rounded-lg border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:!border-pink-200 hover:!bg-pink-50 hover:!text-pink-700"
              }
            >
              <Filter className={isFilterActive ? "h-4 w-4 text-white" : "h-4 w-4"} />
              Filter
              {isFilterActive && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-xs text-white">
                  {activeFilterCount}
                </span>
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleExport}
              disabled={exporting}
              title="Export Excel"
              className="purchasing-secondary-button w-full sm:w-auto"
            >
              {exporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Export
            </Button>

            {(search || isFilterActive || page > 1) && (
              <Button variant="outline" onClick={handleResetFilters} className="h-10 shrink-0 rounded-lg">
                Reset
              </Button>
            )}
          </div>
        }
      >
        <div>
          {filterOpen && (
            <div className="border-b border-gray-200/70 bg-gray-50/70 px-5 py-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <Filter className="h-3.5 w-3.5 text-pink-500" />
                    Category
                  </div>
                  <Combobox
                    options={categoryFilterOptions}
                    value={categoryFilter}
                    onChange={(value) => {
                      setCategoryFilter(value as MaterialCategory | "all");
                      setPage(1);
                    }}
                    placeholder="Filter category..."
                    searchPlaceholder="Search category..."
                    emptyMessage="No category found"
                    className="w-full! h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <AlertCircle className="h-3.5 w-3.5 text-pink-500" />
                    Stock Status
                  </div>
                  <Combobox
                    options={STATUS_OPTIONS}
                    value={statusFilter}
                    onChange={(value) => {
                      setStatusFilter(value);
                      setPage(1);
                    }}
                    placeholder="Filter stock status..."
                    searchPlaceholder="Search stock status..."
                    emptyMessage="No stock status found"
                    className="w-full! h-9 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-gray-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
              Loading raw materials...
            </div>
          ) : materials.length === 0 ? (
            <div className="py-14 text-center">
              <Package className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">
                {search || isFilterActive
                  ? "No raw materials match the current filters"
                  : "No raw materials yet"}
              </p>
              {!search && !isFilterActive && (
                <Link href={`${ITEMS_RAW_MATERIALS_PATH}/insert`}>
                  <Button variant="outline" className="purchasing-secondary-button mt-4">
                    Add First Raw Material
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto px-4">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200/70 text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-3 pr-4 text-left font-semibold">Code</th>
                      <th className="px-3 py-3 text-left font-semibold">Material Name</th>
                      <th className="px-3 py-3 text-left font-semibold">Category</th>
                      <th className="px-3 py-3 text-left font-semibold">Chart of Accounts</th>
                      <th className="px-3 py-3 text-right font-semibold">Available Stock</th>
                      <th className="px-3 py-3 text-right font-semibold">Minimum Stock</th>
                      <th className="px-3 py-3 text-right font-semibold">Average Cost</th>
                      <th className="px-3 py-3 text-center font-semibold">Stock Status</th>
                      <th className="px-3 py-3 text-center font-semibold">Active</th>
                      <th className="py-3 pl-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200/70">
                    {materials.map((material) => {
                      const qtyOnHand = material.qty_onhand ?? 0;
                      const minStock = material.stok_minimum ?? 0;
                      const unitLabel =
                        material.satuan_besar_nama || material.satuan_besar?.nama || "-";

                      return (
                        <tr key={material.id} className="transition-colors hover:bg-gray-50/80">
                          <td className="py-3 pr-4">
                            <span className="font-medium text-gray-900">{material.kode}</span>
                          </td>
                          <td className="px-3 py-3">
                            <Link
                              href={`${ITEMS_RAW_MATERIALS_PATH}/${material.id}`}
                              className="font-medium text-pink-700 hover:underline"
                            >
                              {material.nama}
                            </Link>
                          </td>
                          <td className="px-3 py-3 text-gray-700">
                            {getCategoryLabel(material.kategori)}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1">
                              {material.coa_production && (
                                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                                  Production
                                </Badge>
                              )}
                              {material.coa_rnd && (
                                <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
                                  Research and Development
                                </Badge>
                              )}
                              {material.coa_asset && (
                                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                                  Asset
                                </Badge>
                              )}
                              {!material.coa_production && !material.coa_rnd && !material.coa_asset && (
                                <span className="text-sm text-gray-400">-</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span
                              className={
                                qtyOnHand <= 0
                                  ? "font-semibold text-red-600"
                                  : qtyOnHand <= minStock
                                    ? "font-semibold text-amber-600"
                                    : "text-gray-700"
                              }
                            >
                              {formatQty(qtyOnHand)}
                            </span>
                            <span className="ml-1 text-xs text-gray-500">{unitLabel}</span>
                          </td>
                          <td className="px-3 py-3 text-right text-gray-700">{formatQty(minStock)}</td>
                          <td className="px-3 py-3 text-right text-gray-700">
                            {(material.avg_cost ?? 0) > 0 ? formatAmount(material.avg_cost) : "-"}
                          </td>
                          <td className="px-3 py-3 text-center">
                            {getStockStatusBadge(material.status_stok ?? "AMAN")}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <div className="flex items-center justify-center">
                              <Switch
                                checked={material.is_active ?? true}
                                disabled={statusUpdatingId === material.id}
                                onCheckedChange={(checked) =>
                                  setStatusDialog({ open: true, material, nextStatus: checked })
                                }
                                aria-label={`Toggle active status for ${material.nama}`}
                              />
                            </div>
                          </td>
                          <td className="py-3 pl-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Link href={`${ITEMS_RAW_MATERIALS_PATH}/${material.id}`}>
                                <Button variant="ghost" size="sm" className="cursor-pointer" title="View Detail">
                                  <Eye className="h-4 w-4 text-pink-600" />
                                </Button>
                              </Link>
                              <Link href={`${ITEMS_RAW_MATERIALS_PATH}/edit/${material.id}`}>
                                <Button variant="ghost" size="sm" className="cursor-pointer" title="Edit">
                                  <Pencil className="h-4 w-4 text-gray-600" />
                                </Button>
                              </Link>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="cursor-pointer text-red-500 hover:text-red-600"
                                title="Delete"
                                onClick={() => handleOpenDelete(material)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <PurchasingTablePagination
                page={page}
                totalPages={Math.max(1, totalPages)}
                totalItems={total}
                pageSize={limit}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      </PurchasingListSection>

      <ConfirmDialog
        open={statusDialog.open}
        onOpenChange={(open) => {
          if (!open && !statusUpdatingId) {
            setStatusDialog({ open: false, material: null, nextStatus: true });
          }
        }}
        variant="default"
        title={statusDialog.nextStatus ? "Activate Raw Material?" : "Deactivate Raw Material?"}
        description={`Are you sure you want to ${
          statusDialog.nextStatus ? "activate" : "deactivate"
        } "${statusDialog.material?.nama ?? ""}"?`}
        confirmLabel={statusDialog.nextStatus ? "Activate" : "Deactivate"}
        cancelLabel="Cancel"
        loading={Boolean(statusUpdatingId)}
        onConfirm={handleConfirmToggleStatus}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Raw Material?"
        description={`Are you sure you want to delete "${deletingMaterial?.nama ?? ""}"? The record will be hidden from the list. Materials with stock or active bill of materials usage cannot be deleted.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loadingLabel="Deleting..."
        loading={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
