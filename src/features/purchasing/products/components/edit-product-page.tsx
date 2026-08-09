"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Calculator, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ProductFormData, BOMItem, RawMaterialWithStock } from "@/types/purchasing";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/modules/purchasing/components/page/purchasing-page-header";
import { formatAmount } from "@/lib/purchasing/utils";
import { useProductEditData, useProductCategoryOptions, useProductWarehouses } from "../queries";
import { useUpdateProduct } from "../mutations";
import { mapUnitComboboxOptions } from "../product-unit";
import { ProductInfoFields } from "./product-info-fields";
import { ProductPriceFields } from "./product-price-fields";
import { STALL_LABELS } from "@/lib/configuration/stall-labels";
import { resolvePosStation } from "@/lib/pos/kitchen-station";

function getBomQty(item: Partial<BOMItem>) {
  return item.qty_needed ?? item.qty_required ?? item.qty ?? 0;
}

function getBomWastePercent(item: Partial<BOMItem>) {
  if (item.waste_persen !== undefined && item.waste_persen !== null) {
    return item.waste_persen;
  }
  return (item.waste_factor ?? 0) * 100;
}

function getMaterialSmallUnitLabel(material?: RawMaterialWithStock) {
  return material?.satuan_kecil_nama || material?.satuan || "Satuan";
}

function formatQuantity(value: number | string | null | undefined, maxFractionDigits = 4) {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: maxFractionDigits,
  }).format(Number(value) || 0);
}

function getMaterialCost(material?: RawMaterialWithStock) {
  const baseCost = Number(material?.avg_cost ?? material?.harga_avg ?? material?.harga_terakhir ?? 0);
  const hasSmallUnit = Boolean(material?.satuan_kecil_nama || material?.satuan_kecil_id);
  const factor = Number(material?.konversi_factor ?? 0);
  if (hasSmallUnit && factor > 0) return baseCost / factor;
  return baseCost;
}

function calculateMarkupFromPrice(hpp: number, price: number) {
  if (hpp <= 0) return 0;
  return Number((((price - hpp) / hpp) * 100).toFixed(2));
}

export function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;

  const editQuery = useProductEditData(productId);
  const product = editQuery.data?.product ?? null;
  const materials = editQuery.data?.materials ?? [];
  const units = editQuery.data?.units ?? [];
  const unitOptions = mapUnitComboboxOptions(units);
  const bomItems = editQuery.data?.bom ?? [];
  const loading = editQuery.isLoading;

  const categoriesQuery = useProductCategoryOptions();
  const warehousesQuery = useProductWarehouses();
  const categoryOptions = (categoriesQuery.data ?? []).map((row) => ({
    value: row.code,
    label: row.nama,
    description: row.deskripsi || undefined,
  }));

  const updateMutation = useUpdateProduct();
  const isSubmitting = updateMutation.isPending;

  const [formData, setFormData] = useState<ProductFormData>({
    nama: "",
    kategori: "",
    satuan_id: "",
    warehouse_id: "",
    deskripsi: "",
    harga_jual: 0,
    markup_persen: 0,
    is_active: true,
    production_output_type: "FINISHED_GOOD",
    station: "kitchen",
  });
  const stallOptions = (warehousesQuery.data ?? []).map((w) => ({
    value: w.id,
    label: w.name,
    description: w.code,
  }));

  useEffect(() => {
    if (editQuery.isError) {
      console.error("Error loading data:", editQuery.error);
      toast.error("Gagal memuat data produk");
    }
  }, [editQuery.isError, editQuery.error]);

  useEffect(() => {
    const productData = editQuery.data?.product;
    if (!productData) return;
    setFormData({
      nama: productData.nama || "",
      kategori: productData.kategori || "",
      satuan_id: productData.satuan_id || productData.unit_id || "",
      warehouse_id: productData.warehouse_id || "",
      deskripsi: productData.deskripsi || "",
      // pg numeric often arrives as string — coerce before submit/Zod
      harga_jual: Number(productData.harga_jual) || 0,
      markup_persen:
        productData.markup_persen == null || productData.markup_persen === ""
          ? 0
          : Number(productData.markup_persen),
      is_active: productData.is_active ?? true,
      production_output_type:
        productData.production_output_type === "WIP" ? "WIP" : "FINISHED_GOOD",
      station: resolvePosStation(productData.station, productData.kategori),
    });
  }, [editQuery.data]);

  const totalCost = bomItems.reduce((sum, item) => {
    const material = materials.find((m) => m.id === item.raw_material_id);
    const qty = getBomQty(item);
    const waste = getBomWastePercent(item);
    const price = getMaterialCost(material);
    return sum + price * qty * (1 + waste / 100);
  }, 0);

  useEffect(() => {
    if (loading) return;

    setFormData((prev) => {
      const nextMarkup = calculateMarkupFromPrice(totalCost, prev.harga_jual || 0);
      return prev.markup_persen === nextMarkup ? prev : { ...prev, markup_persen: nextMarkup };
    });
  }, [loading, totalCost, formData.harga_jual]);

  const handlePriceChange = (value: number) => {
    setFormData((prev) => ({
      ...prev,
      harga_jual: value,
      markup_persen: calculateMarkupFromPrice(totalCost, value),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.nama) {
      toast.error("Nama produk wajib diisi");
      return;
    }
    if (!formData.satuan_id) {
      toast.error("Satuan wajib diisi");
      return;
    }
    if (!formData.warehouse_id) {
      toast.error(`${STALL_LABELS.singular} wajib dipilih`);
      return;
    }
    if (!formData.station) {
      toast.error("Station wajib dipilih");
      return;
    }

    try {
      await updateMutation.mutateAsync({
        id: productId,
        payload: {
          ...formData,
          harga_jual: Number(formData.harga_jual) || 0,
          markup_persen: Number(formData.markup_persen) || 0,
          harga_modal: Number(totalCost) || 0,
        },
      });
      toast.success("Produk berhasil diperbarui");
      router.push(PRODUCT_ROUTES.productsDetail(productId));
    } catch (error: unknown) {
      console.error("Error updating product:", error);
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui produk");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" />
        Memuat produk...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.productsDetail(productId)}
        title="Ubah Produk"
        description={product?.nama ? `Perbarui detail untuk ${product.nama}` : "Perbarui detail produk"}
        actions={
          <Link href={PRODUCT_ROUTES.productsBom(productId)}>
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              <Calculator className="mr-2 h-4 w-4" />
              Ubah Resep (BOM)
            </Button>
          </Link>
        }
      />

      <form id="edit-product-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-4 w-4" />
                  Informasi Produk
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ProductInfoFields
                  formData={formData}
                  onChange={(patch) => setFormData((prev) => ({ ...prev, ...patch }))}
                  stallOptions={stallOptions}
                  categoryOptions={categoryOptions}
                  unitOptions={unitOptions}
                  warehousesLoading={warehousesQuery.isLoading}
                  categoriesLoading={categoriesQuery.isLoading}
                  unitsLoading={loading}
                />
              </CardContent>
            </Card>

            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-4 w-4" />
                  Resep (BOM)
                </CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {bomItems.length} bahan
                </Badge>
              </CardHeader>
              {bomItems.length === 0 ? (
                <CardContent>
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    Belum ada resep (BOM).{" "}
                    <Link
                      href={PRODUCT_ROUTES.productsBom(productId)}
                      className="font-medium text-primary hover:underline"
                    >
                      Ubah resep (BOM)
                    </Link>{" "}
                    untuk menambah komponen.
                  </div>
                </CardContent>
              ) : (
                <CardContent className="p-0">
                  <div className="overflow-x-auto px-4">
                    <table className="w-full min-w-160 text-sm">
                      <thead>
                        <tr className="border-b border-gray-200/70 text-left text-xs text-muted-foreground">
                          <th className="py-2.5 pr-3 font-medium">Bahan Baku</th>
                          <th className="w-36 py-2.5 pr-3 text-right font-medium">Qty</th>
                          <th className="w-28 py-2.5 pr-3 text-right font-medium">Susut</th>
                          <th className="w-36 py-2.5 text-right font-medium">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bomItems.map((item) => {
                          const material = materials.find((m) => m.id === item.raw_material_id);
                          const qty = getBomQty(item);
                          const wastePercent = getBomWastePercent(item);
                          const smallUnitLabel = getMaterialSmallUnitLabel(material);
                          const subtotal =
                            getMaterialCost(material) * qty * (1 + wastePercent / 100);

                          return (
                            <tr key={item.id} className="border-b border-gray-200/70 last:border-0">
                              <td className="py-2.5 pr-3 align-middle">
                                <p className="font-medium text-foreground">
                                  {material?.nama || "Tidak diketahui"}
                                </p>
                                <p className="text-xs text-muted-foreground">{material?.kode}</p>
                              </td>
                              <td className="py-2.5 pr-3 text-right align-middle tabular-nums text-foreground">
                                {formatQuantity(qty)}{" "}
                                <span className="text-xs uppercase text-muted-foreground">
                                  {smallUnitLabel}
                                </span>
                              </td>
                              <td className="py-2.5 pr-3 text-right align-middle tabular-nums text-foreground">
                                {formatQuantity(wastePercent, 2)}%
                              </td>
                              <td className="py-2.5 text-right align-middle font-mono text-foreground">
                                {formatAmount(subtotal)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex justify-end border-t border-gray-200/70 px-4 py-3">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Total Estimasi HPP</p>
                      <p className="text-lg font-semibold text-foreground">{formatAmount(totalCost)}</p>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          </div>

          <Card className="h-fit border-gray-200/70 shadow-xs lg:col-span-4">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="h-4 w-4" />
                Harga &amp; HPP
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ProductPriceFields
                totalCost={totalCost}
                markupPersen={formData.markup_persen}
                hargaJual={formData.harga_jual}
                onHargaJualChange={handlePriceChange}
              />
            </CardContent>
          </Card>
        </div>

        <PurchasingFormFooter
          formId="edit-product-form"
          onCancel={() => router.back()}
          submitLabel="Simpan Perubahan"
          loading={isSubmitting}
        />
      </form>
    </div>
  );
}
