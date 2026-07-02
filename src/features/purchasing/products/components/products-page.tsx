"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ITEMS_PRODUCTS_PATH } from "@/modules/purchasing/constants/items-nav";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingTablePagination } from "@/modules/purchasing/components/pagination/PurchasingTablePagination";
import { Calculator, Eye, Loader2, Package, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ProductWithCOGS } from "@/types/purchasing";
import { useProductList, useProductCategoryOptions } from "../queries";
import { useDeleteProduct, useUpdateProductStatus } from "../mutations";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getProductUnitLabel } from "../product-unit";

export function ProductsPage() {
  const [page, setPage] = useState(1);
  const limit = 20;
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

  const getErrorMessage = (error: unknown, fallback: string) => {
    return error instanceof Error ? error.message : fallback;
  };

  const listQuery = useProductList({ search: search || undefined, page, limit });
  const categoriesQuery = useProductCategoryOptions();
  const categoryLabelMap = new Map(
    (categoriesQuery.data ?? []).map((row) => [row.code, row.nama])
  );
  const getCategoryLabel = (code?: string | null) =>
    code ? categoryLabelMap.get(code) ?? code : "-";
  const products = listQuery.data?.data ?? [];
  const loading = listQuery.isLoading;
  const total = listQuery.data?.total ?? 0;
  const totalPages = listQuery.data?.total_pages ?? 0;

  const deleteMutation = useDeleteProduct();
  const statusMutation = useUpdateProductStatus();
  const isDeleting = deleteMutation.isPending;
  const statusUpdatingId = statusMutation.isPending ? statusMutation.variables?.id ?? null : null;

  useEffect(() => {
    if (listQuery.isError) {
      console.error("Error loading products:", listQuery.error);
      toast.error("Gagal memuat data produk");
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
    if (!deletingProduct) return;
    if (isDeleting) return;

    try {
      await deleteMutation.mutateAsync(deletingProduct.id);
      toast.success("Produk berhasil dihapus");
      setIsDeleteDialogOpen(false);
      setDeletingProduct(null);
    } catch (error: unknown) {
      console.error("Error deleting product:", error);
      toast.error(getErrorMessage(error, "Gagal menghapus produk"));
    }
  };

  const handleConfirmToggleStatus = async () => {
    const product = statusDialog.product;
    if (!product) return;
    if (statusMutation.isPending) return;

    try {
      await statusMutation.mutateAsync({ id: product.id, isActive: statusDialog.nextStatus });
      toast.success(`Produk berhasil ${statusDialog.nextStatus ? "diaktifkan" : "dinonaktifkan"}`);
      setStatusDialog({ open: false, product: null, nextStatus: true });
    } catch (error: unknown) {
      console.error("Error updating product status:", error);
      toast.error(getErrorMessage(error, "Gagal mengubah status produk"));
    }
  };

  const formatCurrency = (num: number | string | null | undefined) => {
    const value = Number(num) || 0;
    return `Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value)}`;
  };

  const handleResetFilters = () => {
    setSearchQuery("");
    setSearch("");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Master Produk</h1>
          <p className="mt-1 text-sm text-gray-500">
            Kelola produk jadi dengan BOM (Bill of Materials) — {total} total
          </p>
        </div>
        <Link href={`${ITEMS_PRODUCTS_PATH}/insert`}>
          <Button className="h-10 w-full gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-pink-700 sm:w-auto">
            <Plus className="mr-2 h-4 w-4" />
            Tambah Produk
          </Button>
        </Link>
      </div>

      <PurchasingListSection
        icon={Package}
        title="Daftar Produk"
        description="Kelola produk jadi, kategori, harga jual, dan estimasi HPP."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder="Cari produk..."
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

            {(search || page > 1) && (
              <Button variant="outline" onClick={handleResetFilters} className="h-9 flex-shrink-0">
                Reset
              </Button>
            )}
          </div>
        }
      >
        <div>
          {loading ? (
            <div className="py-12 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
              <p className="mt-2 text-sm text-gray-500">Memuat data...</p>
            </div>
          ) : products.length === 0 ? (
            <div className="py-14 text-center">
              <Package className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">
                {search ? "Tidak ada produk yang cocok dengan pencarian" : "Belum ada data produk"}
              </p>
              {!search && (
                <Link href={`${ITEMS_PRODUCTS_PATH}/insert`}>
                  <Button variant="outline" className="mt-4">
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
                      <th className="px-4 py-3 text-left font-semibold">Kategori</th>
                      <th className="px-4 py-3 text-left font-semibold">Satuan</th>
                      <th className="px-4 py-3 text-right font-semibold">HPP Estimasi</th>
                      <th className="px-4 py-3 text-right font-semibold">Harga Jual</th>
                      <th className="px-4 py-3 text-center font-semibold">Status</th>
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
                          <Link
                            href={`${ITEMS_PRODUCTS_PATH}/${product.id}`}
                            className="font-medium text-pink-600 hover:underline"
                          >
                            {product.nama}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{getCategoryLabel(product.kategori)}</td>
                        <td className="px-4 py-3 text-gray-700">{getProductUnitLabel(product)}</td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          <div className="flex items-center justify-end gap-1">
                            <Calculator className="h-3 w-3 text-gray-400" />
                            {formatCurrency(product.hpp_estimasi || 0)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          {formatCurrency(product.harga_jual || 0)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center">
                            <Switch
                              checked={product.is_active ?? true}
                              disabled={statusUpdatingId === product.id}
                              onCheckedChange={(checked) =>
                                setStatusDialog({ open: true, product, nextStatus: checked })
                              }
                              aria-label={`Ubah status ${product.nama}`}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link href={`${ITEMS_PRODUCTS_PATH}/${product.id}`}>
                              <Button variant="ghost" size="sm" className="cursor-pointer">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Link href={`${ITEMS_PRODUCTS_PATH}/edit/${product.id}`}>
                              <Button variant="ghost" size="sm" className="cursor-pointer">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Link href={`${ITEMS_PRODUCTS_PATH}/bom/${product.id}`}>
                              <Button variant="ghost" size="sm" className="cursor-pointer">
                                <Calculator className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              size="sm"
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

      {/* Status Dialog */}
      <ConfirmDialog
        open={statusDialog.open}
        onOpenChange={(open) => {
          if (!open && !statusUpdatingId) {
            setStatusDialog({ open: false, product: null, nextStatus: true });
          }
        }}
        variant="default"
        title={statusDialog.nextStatus ? "Aktifkan Produk?" : "Nonaktifkan Produk?"}
        description={`Apakah Anda yakin ingin ${
          statusDialog.nextStatus ? "mengaktifkan" : "menonaktifkan"
        } produk "${statusDialog.product?.nama ?? ""}"?`}
        confirmLabel={statusDialog.nextStatus ? "Aktifkan" : "Nonaktifkan"}
        loading={Boolean(statusUpdatingId)}
        onConfirm={handleConfirmToggleStatus}
      />

      {/* Delete Dialog */}
      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Hapus Produk?"
        description={`Apakah Anda yakin ingin menghapus produk "${
          deletingProduct?.nama ?? ""
        }"? Data akan disembunyikan dari daftar, bukan sekadar dinonaktifkan.`}
        confirmLabel="Hapus"
        loadingLabel="Menghapus..."
        loading={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
