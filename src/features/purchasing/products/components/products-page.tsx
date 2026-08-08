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
import { Badge } from "@/components/ui/badge";
import { Calculator, Download, Eye, Loader2, Package, Pencil, Plus, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { STALL_LABELS } from "@/lib/configuration/stall-labels";
import { ProductWithCOGS } from "@/types/purchasing";
import { useProductList, useProductCategoryOptions, useProductWarehouses } from "../queries";
import { useApplyProductRecipeHpp, useDeleteProduct, useUpdateProductStatus } from "../mutations";
import { getProductUnitLabel } from "../product-unit";
import { ProductHppCompare } from "./product-hpp-compare";

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
  const [hppReviewOnly, setHppReviewOnly] = useState(false);
  const [hppDialog, setHppDialog] = useState<{
    open: boolean;
    product: ProductWithCOGS | null;
  }>({ open: false, product: null });

  const listQuery = useProductList({
    search: search || undefined,
    warehouse_id: stallFilter || undefined,
    hpp_review: hppReviewOnly || undefined,
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
  const applyHppMutation = useApplyProductRecipeHpp();
  const isDeleting = deleteMutation.isPending;
  const statusUpdatingId = statusMutation.isPending ? statusMutation.variables?.id ?? null : null;

  useEffect(() => {
    if (listQuery.isError) {
      console.error("Error loading products:", listQuery.error);
      toast.error(getErrorMessage(listQuery.error, "Gagal memuat produk"));
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
      toast.success("Produk berhasil dihapus.");
      setIsDeleteDialogOpen(false);
      setDeletingProduct(null);
    } catch (error: unknown) {
      console.error("Error deleting product:", error);
      toast.error(getErrorMessage(error, "Gagal menghapus produk"));
    }
  };

  const handleConfirmToggleStatus = async () => {
    const product = statusDialog.product;
    if (!product || statusMutation.isPending) return;

    try {
      await statusMutation.mutateAsync({ id: product.id, isActive: statusDialog.nextStatus });
      toast.success(
        `Produk berhasil ${statusDialog.nextStatus ? "diaktifkan" : "dinonaktifkan"}.`
      );
      setStatusDialog({ open: false, product: null, nextStatus: true });
    } catch (error: unknown) {
      console.error("Error updating product status:", error);
      toast.error(getErrorMessage(error, "Gagal memperbarui status produk"));
    }
  };

  const handleResetFilters = () => {
    setSearchQuery("");
    setSearch("");
    setStallFilter("");
    setHppReviewOnly(false);
    setPage(1);
  };

  const handleApplyRecipeHpp = async () => {
    const product = hppDialog.product;
    if (!product || applyHppMutation.isPending) return;

    try {
      const result = await applyHppMutation.mutateAsync(product.id);
      toast.success(result.message || "HPP berhasil diperbarui.");
      setHppDialog({ open: false, product: null });
    } catch (error: unknown) {
      console.error("Error applying recipe HPP:", error);
      toast.error(getErrorMessage(error, "Gagal memperbarui HPP"));
    }
  };

  const handleExport = async () => {
    if (exporting) return;

    setExporting(true);
    try {
      const response = await fetch("/api/purchasing/export/products");
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message || "Ekspor gagal");
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

      toast.success("Produk berhasil diekspor ke Excel.");
    } catch (error: unknown) {
      console.error("Error exporting products:", error);
      toast.error(`Gagal mengekspor: ${getErrorMessage(error, "Kesalahan tidak diketahui")}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Produk"
        description={
          <>
            Kelola produk jadi, resep (BOM), dan estimasi HPP — {total} data
            {hppReviewOnly ? " · filter perlu review HPP" : ""}
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
                Impor
              </Button>
            </Link>
            <Link href={PRODUCT_ROUTES.productsInsert}>
              <Button className="purchasing-main-button w-full sm:w-auto">
                <Plus className="mr-2 h-4 w-4" />
                Tambah Produk
              </Button>
            </Link>
          </div>
        }
      />

      <PurchasingListSection
        icon={Package}
        title="Daftar Produk"
        description="Tinjau kode produk, kategori, satuan, HPP saat ini vs seharusnya, harga jual, dan status aktif."
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
                placeholder="Cari kode atau nama produk..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-white pl-10 pr-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label="Hapus pencarian"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setHppReviewOnly((current) => !current);
                setPage(1);
              }}
              className={
                hppReviewOnly
                  ? "h-10 gap-2 rounded-lg border-amber-200/80 bg-amber-50 px-3 text-sm font-medium text-amber-800 shadow-sm hover:border-amber-200 hover:bg-amber-50 hover:text-amber-900"
                  : "h-10 gap-2 rounded-lg border-gray-200/80 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:border-gray-200 hover:bg-gray-50"
              }
            >
              Perlu review HPP
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleExport}
              disabled={exporting}
              className="h-10 gap-2 rounded-lg border-pink-200 bg-white px-3 text-sm font-medium text-pink-700 shadow-sm hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700"
              title="Ekspor Excel"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Ekspor
            </Button>
            {(search || stallFilter || hppReviewOnly || page > 1) && (
              <Button
                variant="outline"
                onClick={handleResetFilters}
                className="h-10 shrink-0 rounded-lg"
              >
                Atur Ulang
              </Button>
            )}
          </div>
        }
      >
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-gray-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
              Memuat produk...
            </div>
          ) : products.length === 0 ? (
            <div className="py-14 text-center">
              <Package className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">
                {hppReviewOnly
                  ? "Tidak ada produk yang HPP-nya perlu di-review"
                  : search
                    ? "Tidak ada produk yang cocok dengan pencarian"
                    : "Belum ada produk"}
              </p>
              {!search && !hppReviewOnly && (
                <Link href={PRODUCT_ROUTES.productsInsert}>
                  <Button variant="outline" className="purchasing-secondary-button mt-4">
                    Tambah Produk Pertama
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
                      <th className="px-4 py-3 text-left font-semibold">Kode</th>
                      <th className="px-4 py-3 text-left font-semibold">Nama Produk</th>
                      <th className="px-4 py-3 text-left font-semibold">Stall</th>
                      <th className="px-4 py-3 text-left font-semibold">Kategori</th>
                      <th className="px-4 py-3 text-left font-semibold">Satuan</th>
                      <th className="px-4 py-3 text-right font-semibold">HPP Saat Ini</th>
                      <th className="px-4 py-3 text-right font-semibold">HPP Seharusnya</th>
                      <th className="px-4 py-3 text-right font-semibold">Harga Jual</th>
                      <th className="px-4 py-3 text-center font-semibold">Aktif</th>
                      <th className="px-4 py-3 text-right font-semibold">Aksi</th>
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
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={PRODUCT_ROUTES.productsDetail(product.id)}
                              className="font-medium text-pink-700 hover:underline"
                            >
                              {product.nama}
                            </Link>
                            {product.hpp_perlu_review ? (
                              <Badge
                                variant="outline"
                                className="border-amber-200/80 bg-amber-50 text-amber-800"
                              >
                                Perlu update
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{getStallLabel(product)}</td>
                        <td className="px-4 py-3 text-gray-700">
                          {getCategoryLabel(product.kategori)}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{getProductUnitLabel(product)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          {formatAmount(product.hpp_tersimpan ?? product.harga_modal ?? 0)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-pink-700">
                          {formatAmount(product.hpp_resep ?? product.hpp_estimasi ?? 0)}
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
                              aria-label={`Ubah status aktif ${product.nama}`}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Link href={PRODUCT_ROUTES.productsDetail(product.id)}>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Lihat detail"
                                className="cursor-pointer"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Link href={PRODUCT_ROUTES.productsEdit(product.id)}>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Ubah produk"
                                className="cursor-pointer"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Link href={PRODUCT_ROUTES.productsBom(product.id)}>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Ubah resep (BOM)"
                                className="cursor-pointer"
                              >
                                <Calculator className="h-4 w-4 text-pink-600" />
                              </Button>
                            </Link>
                            {product.hpp_perlu_review ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Update ke HPP seharusnya"
                                className="cursor-pointer text-amber-700 hover:text-amber-800"
                                disabled={applyHppMutation.isPending}
                                onClick={() => setHppDialog({ open: true, product })}
                              >
                                {applyHppMutation.isPending &&
                                applyHppMutation.variables === product.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-4 w-4" />
                                )}
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Hapus produk"
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
        open={hppDialog.open}
        onOpenChange={(open) => {
          if (!open && !applyHppMutation.isPending) {
            setHppDialog({ open: false, product: null });
          }
        }}
        variant="default"
        title="Update HPP?"
        description={`HPP saat ini "${hppDialog.product?.nama ?? ""}" akan diganti dengan HPP seharusnya. Barang jadi ikut tersinkron ke POS.`}
        confirmLabel="Update HPP"
        cancelLabel="Tetap"
        loadingLabel="Memperbarui..."
        loading={applyHppMutation.isPending}
        onConfirm={handleApplyRecipeHpp}
      >
        {hppDialog.product ? (
          <ProductHppCompare
            hppTersimpan={hppDialog.product.hpp_tersimpan ?? Math.round(hppDialog.product.harga_modal || 0)}
            hppResep={hppDialog.product.hpp_resep ?? Math.round(hppDialog.product.hpp_estimasi || 0)}
            hppSelisih={
              hppDialog.product.hpp_selisih ??
              Math.round(hppDialog.product.hpp_estimasi || 0) -
                Math.round(hppDialog.product.harga_modal || 0)
            }
          />
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={statusDialog.open}
        onOpenChange={(open) => {
          if (!open && !statusUpdatingId) {
            setStatusDialog({ open: false, product: null, nextStatus: true });
          }
        }}
        variant="default"
        title={statusDialog.nextStatus ? "Aktifkan Produk?" : "Nonaktifkan Produk?"}
        description={`Yakin ingin ${
          statusDialog.nextStatus ? "mengaktifkan" : "menonaktifkan"
        } produk "${statusDialog.product?.nama ?? ""}"?`}
        confirmLabel={statusDialog.nextStatus ? "Aktifkan" : "Nonaktifkan"}
        cancelLabel="Batal"
        loading={Boolean(statusUpdatingId)}
        onConfirm={handleConfirmToggleStatus}
      />

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Hapus Produk?"
        description={`Yakin ingin menghapus produk "${
          deletingProduct?.nama ?? ""
        }"? Data akan disembunyikan dari daftar.`}
        confirmLabel="Hapus"
        cancelLabel="Batal"
        loadingLabel="Menghapus..."
        loading={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
