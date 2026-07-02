"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useProduct, useProductBOM, useProductCategoryOptions } from "../queries";
import { useDeleteProduct } from "../mutations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Package, Calculator, Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BOMItem } from "@/types/purchasing";
import { ITEMS_PRODUCTS_PATH } from "@/modules/purchasing/constants/items-nav";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getProductUnitLabel } from "../product-unit";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getBomQty(item: BOMItem) {
  return item.qty_needed ?? item.qty_required ?? item.qty ?? 0;
}

function getBomWastePercent(item: BOMItem) {
  if (item.waste_persen !== undefined && item.waste_persen !== null) {
    return item.waste_persen;
  }
  return (item.waste_factor ?? 0) * 100;
}

function getBomUnitLabel(item: BOMItem) {
  return (
    item.satuan?.nama ||
    item.unit?.nama ||
    item.raw_material?.satuan_kecil?.kode ||
    item.raw_material?.satuan_kecil?.simbol ||
    item.raw_material?.satuan_kecil?.nama ||
    item.raw_material?.satuan_kecil_nama ||
    item.raw_material?.satuan ||
    item.raw_material?.satuan_besar?.kode ||
    item.raw_material?.satuan_besar?.simbol ||
    item.raw_material?.satuan_besar?.nama ||
    "-"
  );
}

function getBomSubtotal(item: BOMItem) {
  return item.subtotal ?? item.total_cost ?? 0;
}

export function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const productQuery = useProduct(productId);
  const bomQuery = useProductBOM(productId);
  const categoriesQuery = useProductCategoryOptions();
  const product = productQuery.data ?? null;
  const loading = productQuery.isLoading || bomQuery.isLoading;

  const categoryLabel = useMemo(() => {
    if (!product?.kategori) return "-";
    const match = (categoriesQuery.data ?? []).find(
      (row) => row.code === product.kategori
    );
    return match?.nama ?? product.kategori;
  }, [categoriesQuery.data, product?.kategori]);

  const bomItems = useMemo<BOMItem[]>(
    () =>
      (bomQuery.data ?? []).map((item) => ({
        ...item,
        qty_needed: getBomQty(item),
        waste_persen: getBomWastePercent(item),
        subtotal: getBomSubtotal(item),
      })),
    [bomQuery.data]
  );

  const deleteMutation = useDeleteProduct();

  useEffect(() => {
    if (productQuery.isError || bomQuery.isError) {
      console.error("Error loading data:", productQuery.error || bomQuery.error);
      toast.error("Gagal memuat data produk");
    }
  }, [productQuery.isError, bomQuery.isError, productQuery.error, bomQuery.error]);

  const handleDelete = async () => {
    if (!product) return;
    try {
      await deleteMutation.mutateAsync(product.id);
      toast.success("Produk berhasil dinonaktifkan");
      setIsDeleteDialogOpen(false);
      router.push(ITEMS_PRODUCTS_PATH);
    } catch (error: unknown) {
      console.error("Error deleting product:", error);
      toast.error(getErrorMessage(error, "Gagal menghapus produk"));
    }
  };

  const formatCurrency = (num: number | undefined | null) => {
    if (num === undefined || num === null) return "Rp 0";
    return `Rp ${num.toLocaleString("id-ID")}`;
  };

  const calculateMargin = () => {
    if (!product) return { amount: 0, percentage: 0 };
    const hpp = product.hpp_estimasi || 0;
    const amount = product.harga_jual - hpp;
    const percentage = hpp > 0 
      ? (amount / hpp) * 100 
      : 0;
    return { amount, percentage };
  };

  if (loading) {
    return (
      <div className="container mx-auto py-6">
        <div className="text-center py-12">Memuat data...</div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container mx-auto py-6">
        <div className="text-center py-12 text-red-500">Produk tidak ditemukan</div>
      </div>
    );
  }

  const margin = calculateMargin();

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{product.nama}</h1>
            {product.is_active ? (
              <Badge className="bg-green-100 text-green-800">Aktif</Badge>
            ) : (
              <Badge variant="secondary">Nonaktif</Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700">{product.kode_produk}</span>
            <span className="text-gray-300">•</span>
            <span>{categoryLabel}</span>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Link href={ITEMS_PRODUCTS_PATH}>
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Kembali
            </Button>
          </Link>
          <Link href={`${ITEMS_PRODUCTS_PATH}/edit/${product.id}`}>
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </Button>
          </Link>
          <Link href={`${ITEMS_PRODUCTS_PATH}/bom/${product.id}`}>
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              <Calculator className="w-4 h-4 mr-2" />
              Edit BOM
            </Button>
          </Link>
          <Button variant="outline" onClick={() => setIsDeleteDialogOpen(true)} className="h-10 w-full rounded-lg border-red-200 bg-white px-3 text-sm font-medium text-red-600 shadow-sm hover:!border-red-200 hover:!bg-red-50 hover:!text-red-700 sm:w-auto">
            <Trash2 className="w-4 h-4 mr-2" />
            Hapus
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              Ringkasan Produk
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <div>
              <p className="text-sm text-muted-foreground">Kategori</p>
              <p className="font-medium">{categoryLabel}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Satuan</p>
              <p className="font-medium">{getProductUnitLabel(product)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <p className="font-medium">{product.is_active ? "Aktif" : "Nonaktif"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Komponen BOM</p>
              <p className="font-medium">{bomItems.length} bahan</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="w-5 h-5" />
              Harga
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">HPP Estimasi</span>
              <span className="font-medium">{formatCurrency(product.hpp_estimasi)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Harga Jual</span>
              <span className="font-medium">{formatCurrency(product.harga_jual)}</span>
            </div>
            <div className="border-t pt-2 flex justify-between">
              <span className="text-muted-foreground">Margin</span>
              <span className={`font-medium ${margin.amount >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatCurrency(margin.amount)} ({margin.percentage.toFixed(1)}%)
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="info" className="flex-col space-y-4">
        <TabsList
          variant="line"
          className="flex h-auto w-full justify-start gap-6 rounded-none border-b border-gray-200 bg-transparent p-0"
        >
          <TabsTrigger
            value="info"
            className="h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 text-sm font-semibold text-gray-500 shadow-none data-active:border-pink-600 data-active:!bg-transparent data-active:text-pink-700 data-active:shadow-none"
          >
            Informasi
          </TabsTrigger>
          <TabsTrigger
            value="bom"
            className="h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 text-sm font-semibold text-gray-500 shadow-none data-active:border-pink-600 data-active:!bg-transparent data-active:text-pink-700 data-active:shadow-none"
          >
            BOM ({bomItems.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info">
          <Card>
            <CardHeader>
              <CardTitle>Informasi Produk</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-muted-foreground">Kode</p>
                  <p className="font-medium">{product.kode_produk}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Kategori</p>
                  <p className="font-medium">{categoryLabel}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Satuan</p>
                  <p className="font-medium">{getProductUnitLabel(product)}</p>
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Deskripsi</p>
                <p>{product.deskripsi || "-"}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* BOM Tab */}
        <TabsContent value="bom">
          <Card>
            <CardHeader>
              <CardTitle>Bill of Materials</CardTitle>
            </CardHeader>
            <CardContent>
              {bomItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Tidak ada komposisi BOM
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bahan Baku</TableHead>
                      <TableHead className="text-right">Jumlah</TableHead>
                      <TableHead>Satuan</TableHead>
                      <TableHead className="text-right">Waste</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bomItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium">{item.raw_material?.nama}</div>
                          <div className="text-sm text-muted-foreground">{item.raw_material?.kode}</div>
                        </TableCell>
                        <TableCell className="text-right">{getBomQty(item)}</TableCell>
                        <TableCell>{getBomUnitLabel(item)}</TableCell>
                        <TableCell className="text-right">{getBomWastePercent(item)}%</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(getBomSubtotal(item))}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={4} className="text-right font-semibold">
                        Total HPP
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(bomItems.reduce((sum, item) => sum + getBomSubtotal(item), 0))}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Dialog */}
      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Nonaktifkan Produk?"
        description={`Apakah Anda yakin ingin menonaktifkan produk "${product.nama}"?`}
        confirmLabel="Nonaktifkan"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
