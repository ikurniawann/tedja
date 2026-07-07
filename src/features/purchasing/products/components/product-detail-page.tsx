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
import { Calculator, Edit, Trash2, Package, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BOMItem } from "@/types/purchasing";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatAmount } from "@/lib/purchasing/utils";
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

function formatQuantity(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
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
    const match = (categoriesQuery.data ?? []).find((row) => row.code === product.kategori);
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
      toast.error("Failed to load product data");
    }
  }, [productQuery.isError, bomQuery.isError, productQuery.error, bomQuery.error]);

  const handleDelete = async () => {
    if (!product || deleteMutation.isPending) return;
    try {
      await deleteMutation.mutateAsync(product.id);
      toast.success("Product deleted successfully");
      setIsDeleteDialogOpen(false);
      router.push(PRODUCT_ROUTES.products);
    } catch (error: unknown) {
      console.error("Error deleting product:", error);
      toast.error(getErrorMessage(error, "Failed to delete product"));
    }
  };

  const calculateMargin = () => {
    if (!product) return { amount: 0, percentage: 0 };
    const hpp = product.hpp_estimasi || 0;
    const amount = product.harga_jual - hpp;
    const percentage = hpp > 0 ? (amount / hpp) * 100 : 0;
    return { amount, percentage };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
        Loading product...
      </div>
    );
  }

  if (!product) {
    return <div className="py-16 text-center text-red-500">Product not found</div>;
  }

  const margin = calculateMargin();
  const totalBomCost = bomItems.reduce((sum, item) => sum + getBomSubtotal(item), 0);

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title={product.nama || product.nama_produk || "Product"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700">
              {product.kode_produk || product.kode}
            </span>
            <span className="text-gray-300">•</span>
            <span>{categoryLabel}</span>
            <span className="text-gray-300">•</span>
            <span>{product.warehouse_name || product.warehouse_code || "-"}</span>
            <span className="text-gray-300">•</span>
            <span>{getProductUnitLabel(product)}</span>
            <span className="ml-1">
              {product.is_active ? (
                <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Active</Badge>
              ) : (
                <Badge variant="secondary">Inactive</Badge>
              )}
            </span>
          </span>
        }
        actions={
          <>
            <Link href={PRODUCT_ROUTES.productsEdit(product.id)}>
              <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Button>
            </Link>
            <Link href={PRODUCT_ROUTES.productsBom(product.id)}>
              <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
                <Calculator className="mr-2 h-4 w-4" />
                Edit Bill of Materials
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(true)}
              className="h-10 w-full rounded-lg border-red-200/80 bg-white px-3 text-sm font-medium text-red-600 shadow-sm hover:!border-red-200 hover:!bg-red-50 hover:!text-red-700 sm:w-auto"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="border-gray-200/70 shadow-xs lg:col-span-2">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4 text-pink-600" />
              Product Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 p-4 sm:grid-cols-2 md:grid-cols-4">
            <div>
              <p className="text-xs font-medium text-gray-500">Stall</p>
              <p className="font-medium text-gray-900">
                {product.warehouse_name || product.warehouse_code || "-"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Category</p>
              <p className="font-medium text-gray-900">{categoryLabel}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Unit</p>
              <p className="font-medium text-gray-900">{getProductUnitLabel(product)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">Status</p>
              <p className="font-medium text-gray-900">{product.is_active ? "Active" : "Inactive"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500">BOM Components</p>
              <p className="font-medium text-gray-900">
                {bomItems.length} material{bomItems.length === 1 ? "" : "s"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-4 w-4 text-pink-600" />
              Pricing
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Estimated COGS</span>
              <span className="font-medium text-gray-900">{formatAmount(product.hpp_estimasi)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Selling Price</span>
              <span className="font-medium text-gray-900">{formatAmount(product.harga_jual)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-200/70 pt-2 text-sm">
              <span className="text-gray-500">Margin</span>
              <span
                className={`font-medium ${margin.amount >= 0 ? "text-emerald-600" : "text-red-600"}`}
              >
                {formatAmount(margin.amount)} ({margin.percentage.toFixed(1)}%)
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="info" className="flex-col space-y-4">
        <TabsList
          variant="line"
          className="flex h-auto w-full justify-start gap-6 rounded-none border-b border-gray-200/70 bg-transparent p-0"
        >
          <TabsTrigger
            value="info"
            className="h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 text-sm font-semibold text-gray-500 shadow-none data-active:border-pink-600 data-active:!bg-transparent data-active:text-pink-700 data-active:shadow-none"
          >
            Information
          </TabsTrigger>
          <TabsTrigger
            value="bom"
            className="h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 text-sm font-semibold text-gray-500 shadow-none data-active:border-pink-600 data-active:!bg-transparent data-active:text-pink-700 data-active:shadow-none"
          >
            Bill of Materials ({bomItems.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="text-base">Product Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-gray-500">Code</p>
                  <p className="font-medium text-gray-900">{product.kode_produk || product.kode}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500">Category</p>
                  <p className="font-medium text-gray-900">{categoryLabel}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500">Unit</p>
                  <p className="font-medium text-gray-900">{getProductUnitLabel(product)}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Description</p>
                <p className="text-gray-900">{product.deskripsi || "-"}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bom">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="text-base">Bill of Materials</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {bomItems.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-500">
                  No bill of materials components yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold">Raw Material</th>
                        <th className="px-4 py-3 text-right font-semibold">Qty</th>
                        <th className="px-4 py-3 text-left font-semibold">Unit</th>
                        <th className="px-4 py-3 text-right font-semibold">Waste</th>
                        <th className="px-4 py-3 text-right font-semibold">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {bomItems.map((item) => (
                        <tr key={item.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{item.raw_material?.nama}</div>
                            <div className="text-xs text-gray-500">{item.raw_material?.kode}</div>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {formatQuantity(getBomQty(item))}
                          </td>
                          <td className="px-4 py-3 text-gray-700">{getBomUnitLabel(item)}</td>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {getBomWastePercent(item).toFixed(2)}%
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-gray-900">
                            {formatAmount(getBomSubtotal(item))}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50/80">
                        <td colSpan={4} className="px-4 py-3 text-right text-sm font-semibold text-gray-600">
                          Total Estimated COGS
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                          {formatAmount(totalBomCost)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Delete Product?"
        description={`Are you sure you want to delete product "${product.nama}"? The record will be hidden from the list.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loadingLabel="Deleting..."
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
