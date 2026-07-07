"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingTablePagination } from "@/modules/purchasing/components/pagination/PurchasingTablePagination";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { formatAmount } from "@/lib/purchasing/utils";
import { Calculator, Download, Eye, Loader2, Package, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { STALL_LABELS } from "@/lib/configuration/stall-labels";
import { ProductWithCOGS } from "@/types/purchasing";
import { useProductList, useProductCategoryOptions, useProductWarehouses } from "../queries";
import { useDeleteProduct, useUpdateProductStatus } from "../mutations";
import { getProductUnitLabel } from "../product-unit";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function ProductsPage() {
  const [page, setPage] = useState(1);
  const limit = 10;
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState<ProductWithCOGS | null>(null);
  const [statusDialog, setStatusDialog] = useState<{
    open: boolean;
    product: ProductWithCOGS | null;
    nextStatus: boolean;
  }>({
    open: false,
    product: null,
    nextStatus: true,
  });
  const [exporting, setExporting] = useState(false);
  const [stallFilter, setStallFilter] = useState("");

  const listQuery = useProductList({
    search: search || undefined,
    warehouse_id: stallFilter || undefined,
    page,
    limit,
  });
  const categoriesQuery = useProductCategoryOptions();
  const warehousesQuery = useProductWarehouses();
  const stallOptions = [
    { value: "", label: `All ${STALL_LABELS.plural}` },
    ...(warehousesQuery.data ?? []).map((w) => ({
      value: w.id,
      label: w.name,
      description: w.code,
    })),
  ];
  const categoryLabelMap = new Map(
    (categoriesQuery.data ?? []).map((row) => [row.code, row.nama])
  );
  const getCategoryLabel = (code?: string | null) =>
    code ? categoryLabelMap.get(code) ?? code : "-";

  const getStallLabel = (product: ProductWithCOGS) =>
    product.warehouse_name || product.warehouse_code || "-";

  const products = listQuery.data?.data ?? [];
  const loading = listQuery.isLoading;
  const total = listQuery.data?.total ?? 0;
  const totalPages = listQuery.data?.total_pages ?? 1;

  const deleteMutation = useDeleteProduct();
  const statusMutation = useUpdateProductStatus();
  const isDeleting = deleteMutation.isPending;
  const statusUpdatingId = statusMutation.isPending ? statusMutation.variables?.id ?? null : null;

  useEffect(() => {
    if (listQuery.isError) {
      console.error("Error loading products:", listQuery.error);
      toast.error(getErrorMessage(listQuery.error, "Failed to load products"));
    }
  }, [listQuery.isError, listQuery.error]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const handleOpenDelete = (product: ProductWithCOGS) => {
    setDeletingProduct(product);
    setIsDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingProduct || isDeleting) return;

    try {
      await deleteMutation.mutateAsync(deletingProduct.id);
      toast.success("Product deleted successfully");
      setIsDeleteDialogOpen(false);
      setDeletingProduct(null);
    } catch (error: unknown) {
      console.error("Error deleting product:", error);
      toast.error(getErrorMessage(error, "Failed to delete product"));
    }
  };

  const handleConfirmToggleStatus = async () => {
    const product = statusDialog.product;
    if (!product || statusMutation.isPending) return;

    try {
      await statusMutation.mutateAsync({ id: product.id, isActive: statusDialog.nextStatus });
      toast.success(
        `Product ${statusDialog.nextStatus ? "activated" : "deactivated"} successfully`
      );
      setStatusDialog({ open: false, product: null, nextStatus: true });
    } catch (error: unknown) {
      console.error("Error updating product status:", error);
      toast.error(getErrorMessage(error, "Failed to update product status"));
    }
  };

  const handleResetFilters = () => {
    setSearchQuery("");
    setSearch("");
    setStallFilter("");
    setPage(1);
  };

  const handleExport = async () => {
    if (exporting) return;

    setExporting(true);
    try {
      const response = await fetch("/api/purchasing/export/products");
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message || "Export failed");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename =
        match?.[1] || `products-${new Date().toISOString().split("T")[0]}.xlsx`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);

      toast.success("Products exported to Excel.");
    } catch (error: unknown) {
      console.error("Error exporting products:", error);
      toast.error(`Failed to export: ${getErrorMessage(error, "Unknown error")}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Products"
        description={
          <>
            Manage finished products, bill of materials, and estimated cost of goods sold — {total}{" "}
            total
          </>
        }
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Link href={PRODUCT_ROUTES.productsImport}>
              <Button
                variant="outline"
                className="h-10 w-full gap-2 rounded-lg border-pink-200 bg-white px-3 text-sm font-medium text-pink-700 shadow-sm hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700 sm:w-auto"
              >
                <Upload className="h-4 w-4" />
                Import
              </Button>
            </Link>
            <Link href={PRODUCT_ROUTES.productsInsert}>
              <Button className="purchasing-main-button w-full sm:w-auto">
                <Plus className="mr-2 h-4 w-4" />
                Create Product
              </Button>
            </Link>
          </div>
        }
      />

      <PurchasingListSection
        icon={Package}
        title="Product List"
        description="Review product code, category, unit, estimated cost of goods sold, selling price, and active status."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <Combobox
              options={stallOptions}
              value={stallFilter}
              onChange={(value) => {
                setStallFilter(value);
                setPage(1);
              }}
              placeholder={
                warehousesQuery.isLoading ? STALL_LABELS.loading : `All ${STALL_LABELS.plural}`
              }
              searchPlaceholder={STALL_LABELS.search}
              emptyMessage={STALL_LABELS.empty}
              disabled={warehousesQuery.isLoading}
              allowClear
              className="h-10 w-full md:w-48"
            />
            <label className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search product code or name..."
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
              onClick={handleExport}
              disabled={exporting}
              className="h-10 gap-2 rounded-lg border-pink-200 bg-white px-3 text-sm font-medium text-pink-700 shadow-sm hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700"
              title="Export Excel"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export
            </Button>
            {(search || stallFilter || page > 1) && (
              <Button
                variant="outline"
                onClick={handleResetFilters}
                className="h-10 shrink-0 rounded-lg"
              >
                Reset
              </Button>
            )}
          </div>
        }
      >
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-gray-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
              Loading products...
            </div>
          ) : products.length === 0 ? (
            <div className="py-14 text-center">
              <Package className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">
                {search ? "No products match the current search" : "No products yet"}
              </p>
              {!search && (
                <Link href={PRODUCT_ROUTES.productsInsert}>
                  <Button variant="outline" className="purchasing-secondary-button mt-4">
                    Create First Product
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Code</th>
                      <th className="px-4 py-3 text-left font-semibold">Product Name</th>
                      <th className="px-4 py-3 text-left font-semibold">Stall</th>
                      <th className="px-4 py-3 text-left font-semibold">Category</th>
                      <th className="px-4 py-3 text-left font-semibold">Unit</th>
                      <th className="px-4 py-3 text-right font-semibold">Estimated COGS</th>
                      <th className="px-4 py-3 text-right font-semibold">Selling Price</th>
                      <th className="px-4 py-3 text-center font-semibold">Active</th>
                      <th className="px-4 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {products.map((product) => (
                      <tr key={product.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">
                            {product.kode_produk || product.kode || "-"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={PRODUCT_ROUTES.productsDetail(product.id)}
                            className="font-medium text-pink-700 hover:underline"
                          >
                            {product.nama}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{getStallLabel(product)}</td>
                        <td className="px-4 py-3 text-gray-700">
                          {getCategoryLabel(product.kategori)}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{getProductUnitLabel(product)}</td>
                        <td className="px-4 py-3 text-right font-medium text-pink-700">
                          {formatAmount(product.hpp_estimasi || 0)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          {formatAmount(product.harga_jual || 0)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center">
                            <Switch
                              checked={product.is_active ?? true}
                              disabled={statusUpdatingId === product.id}
                              onCheckedChange={(checked) =>
                                setStatusDialog({ open: true, product, nextStatus: checked })
                              }
                              aria-label={`Toggle active status for ${product.nama}`}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Link href={PRODUCT_ROUTES.productsDetail(product.id)}>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="View detail"
                                className="cursor-pointer"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Link href={PRODUCT_ROUTES.productsEdit(product.id)}>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Edit product"
                                className="cursor-pointer"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Link href={PRODUCT_ROUTES.productsBom(product.id)}>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Edit bill of materials"
                                className="cursor-pointer"
                              >
                                <Calculator className="h-4 w-4 text-pink-600" />
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Delete product"
                              className="cursor-pointer text-red-500 hover:text-red-600"
                              onClick={() => handleOpenDelete(product)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
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
            setStatusDialog({ open: false, product: null, nextStatus: true });
          }
        }}
        variant="default"
        title={statusDialog.nextStatus ? "Activate Product?" : "Deactivate Product?"}
        description={`Are you sure you want to ${
          statusDialog.nextStatus ? "activate" : "deactivate"
        } product "${statusDialog.product?.nama ?? ""}"?`}
        confirmLabel={statusDialog.nextStatus ? "Activate" : "Deactivate"}
        cancelLabel="Cancel"
        loading={Boolean(statusUpdatingId)}
        onConfirm={handleConfirmToggleStatus}
      />

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Delete Product?"
        description={`Are you sure you want to delete product "${
          deletingProduct?.nama ?? ""
        }"? The record will be hidden from the list.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loadingLabel="Deleting..."
        loading={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
