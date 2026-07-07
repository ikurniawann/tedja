"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Calculator, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { NumericInput } from "@/components/ui/numeric-input";
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
import { ProductOutputTypeField } from "./product-output-type-field";
import { STALL_LABELS } from "@/lib/configuration/stall-labels";
import type { ProductOutputType } from "@/types/purchasing";

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
  return material?.satuan_kecil_nama || material?.satuan || "Unit";
}

function formatQuantity(value: number | string | null | undefined, maxFractionDigits = 4) {
  return new Intl.NumberFormat("en-US", {
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

function calculatePriceFromMarkup(hpp: number, markup: number) {
  return Math.round(hpp * (1 + markup / 100));
}

function calculateMarkupFromPrice(hpp: number, price: number) {
  if (hpp <= 0) return 0;
  return Number((((price - hpp) / hpp) * 100).toFixed(2));
}

export function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;

  const [pricingSource, setPricingSource] = useState<"markup" | "price">("price");

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
    markup_persen: 30,
    is_active: true,
    production_output_type: "FINISHED_GOOD",
  });
  const stallOptions = (warehousesQuery.data ?? []).map((w) => ({
    value: w.id,
    label: w.name,
    description: w.code,
  }));

  useEffect(() => {
    if (editQuery.isError) {
      console.error("Error loading data:", editQuery.error);
      toast.error("Failed to load product data");
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
      harga_jual: productData.harga_jual || 0,
      markup_persen: productData.markup_persen ?? 30,
      is_active: productData.is_active ?? true,
      production_output_type:
        productData.production_output_type === "WIP" ? "WIP" : "FINISHED_GOOD",
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
      if (pricingSource === "markup") {
        const nextPrice = calculatePriceFromMarkup(totalCost, prev.markup_persen || 0);
        return prev.harga_jual === nextPrice ? prev : { ...prev, harga_jual: nextPrice };
      }

      const nextMarkup = calculateMarkupFromPrice(totalCost, prev.harga_jual || 0);
      return prev.markup_persen === nextMarkup ? prev : { ...prev, markup_persen: nextMarkup };
    });
  }, [loading, pricingSource, totalCost]);

  const handleMarkupChange = (value: number) => {
    setPricingSource("markup");
    setFormData((prev) => ({
      ...prev,
      markup_persen: value,
      harga_jual: calculatePriceFromMarkup(totalCost, value),
    }));
  };

  const handlePriceChange = (value: number) => {
    setPricingSource("price");
    setFormData((prev) => ({
      ...prev,
      harga_jual: value,
      markup_persen: calculateMarkupFromPrice(totalCost, value),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.nama) {
      toast.error("Product name is required");
      return;
    }
    if (!formData.satuan_id) {
      toast.error("Unit is required");
      return;
    }
    if (!formData.warehouse_id) {
      toast.error(`${STALL_LABELS.singular} is required`);
      return;
    }

    try {
      await updateMutation.mutateAsync({
        id: productId,
        payload: {
          ...formData,
          harga_modal: totalCost,
        },
      });
      toast.success("Product updated successfully");
      router.push(PRODUCT_ROUTES.productsDetail(productId));
    } catch (error: unknown) {
      console.error("Error updating product:", error);
      toast.error(error instanceof Error ? error.message : "Failed to update product");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
        Loading product...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.productsDetail(productId)}
        title="Edit Product"
        description={product?.nama ? `Update details for ${product.nama}` : "Update product details"}
        actions={
          <Link href={PRODUCT_ROUTES.productsBom(productId)}>
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              <Calculator className="mr-2 h-4 w-4" />
              Edit Bill of Materials
            </Button>
          </Link>
        }
      />

      <form id="edit-product-form" onSubmit={handleSubmit} className="space-y-6">
        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4 text-pink-600" />
              Product Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="nama" className="text-xs">
                  Product Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="nama"
                  value={formData.nama}
                  onChange={(e) => setFormData({ ...formData, nama: e.target.value })}
                  required
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="warehouse_id" className="text-xs">
                  Stall <span className="text-red-500">*</span>
                </Label>
                <Combobox
                  options={stallOptions}
                  value={formData.warehouse_id || ""}
                  onChange={(v) => setFormData({ ...formData, warehouse_id: v })}
                  placeholder={
                    warehousesQuery.isLoading ? STALL_LABELS.loading : STALL_LABELS.selectPlaceholder
                  }
                  searchPlaceholder={STALL_LABELS.search}
                  emptyMessage={STALL_LABELS.empty}
                  disabled={warehousesQuery.isLoading || loading}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kategori" className="text-xs">
                  Category <span className="text-red-500">*</span>
                </Label>
                <Combobox
                  options={categoryOptions}
                  value={formData.kategori}
                  onChange={(v) => setFormData({ ...formData, kategori: v })}
                  placeholder={categoriesQuery.isLoading ? "Loading categories..." : "Select category..."}
                  searchPlaceholder="Search category..."
                  emptyMessage="No category found"
                  disabled={categoriesQuery.isLoading}
                  allowClear
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="satuan_id" className="text-xs">
                  Unit <span className="text-red-500">*</span>
                </Label>
                <Combobox
                  options={unitOptions}
                  value={formData.satuan_id || ""}
                  onChange={(v) => setFormData({ ...formData, satuan_id: v })}
                  placeholder={loading ? "Loading units..." : "Select unit..."}
                  searchPlaceholder="Search unit..."
                  emptyMessage="No unit found"
                  disabled={loading}
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <ProductOutputTypeField
              value={(formData.production_output_type as ProductOutputType) || "FINISHED_GOOD"}
              onChange={(production_output_type) =>
                setFormData({ ...formData, production_output_type })
              }
            />

            <div className="space-y-1.5">
              <Label htmlFor="deskripsi" className="text-xs">
                Description
              </Label>
              <Textarea
                id="deskripsi"
                value={formData.deskripsi}
                onChange={(e) => setFormData({ ...formData, deskripsi: e.target.value })}
                rows={2}
                className="resize-none text-sm"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-4 w-4 text-pink-600" />
              Pricing & Estimated COGS
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="harga_modal" className="text-xs">
                  Estimated COGS
                </Label>
                <div className="flex rounded-lg border border-gray-200/70 bg-gray-50">
                  <NumericInput
                    id="harga_modal"
                    value={totalCost}
                    onValueChange={() => undefined}
                    decimalScale={0}
                    disabled
                    className="h-9 border-0 bg-gray-50 text-sm font-mono shadow-none focus-visible:ring-0"
                  />
                </div>
                <p className="text-xs text-gray-500">Calculated from bill of materials</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="markup" className="text-xs">
                  Markup (%)
                </Label>
                <div className="flex rounded-lg border border-gray-200/70 bg-white focus-within:border-pink-300 focus-within:ring-2 focus-within:ring-pink-100">
                  <NumericInput
                    id="markup"
                    min="0"
                    max="1000"
                    value={formData.markup_persen}
                    onValueChange={handleMarkupChange}
                    decimalScale={2}
                    className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                  />
                  <div className="flex min-w-12 items-center justify-center rounded-r-lg border-l border-gray-200/70 bg-gray-50 px-3 text-xs font-semibold text-gray-500">
                    %
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="harga_jual" className="text-xs">
                  Selling Price
                </Label>
                <div className="flex rounded-lg border border-gray-200/70 bg-white focus-within:border-pink-300 focus-within:ring-2 focus-within:ring-pink-100">
                  <NumericInput
                    id="harga_jual"
                    value={formData.harga_jual}
                    onValueChange={handlePriceChange}
                    decimalScale={0}
                    className="h-9 border-0 text-sm font-mono shadow-none focus-visible:ring-0"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4 text-pink-600" />
              Bill of Materials
            </CardTitle>
            <Badge variant="secondary" className="text-xs">
              {bomItems.length} material{bomItems.length === 1 ? "" : "s"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {bomItems.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-500">
                No bill of materials yet.{" "}
                <Link
                  href={PRODUCT_ROUTES.productsBom(productId)}
                  className="font-medium text-pink-700 hover:underline"
                >
                  Edit bill of materials
                </Link>{" "}
                to add components.
              </div>
            ) : (
              <div className="space-y-2">
                {bomItems.map((item) => {
                  const material = materials.find((m) => m.id === item.raw_material_id);
                  const qty = getBomQty(item);
                  const wastePercent = getBomWastePercent(item);
                  const smallUnitLabel = getMaterialSmallUnitLabel(material);
                  const subtotal = getMaterialCost(material) * qty * (1 + wastePercent / 100);

                  return (
                    <div
                      key={item.id}
                      className="grid grid-cols-12 gap-4 rounded-lg border border-gray-200/70 bg-white p-3"
                    >
                      <div className="col-span-12 min-w-0 md:col-span-5">
                        <p className="text-sm font-medium">{material?.nama || "Unknown"}</p>
                        <p className="text-xs text-gray-500">{material?.kode}</p>
                      </div>
                      <div className="col-span-12 space-y-1 md:col-span-2">
                        <p className="text-xs font-medium text-gray-500">Qty</p>
                        <div className="flex rounded-lg border border-gray-200/70 bg-gray-50">
                          <div className="flex h-9 flex-1 items-center justify-end px-3 text-sm text-gray-900">
                            {formatQuantity(qty)}
                          </div>
                          <div className="flex min-w-14 items-center justify-center rounded-r-lg border-l border-gray-200/70 bg-gray-50 px-3 text-xs font-semibold uppercase text-gray-500">
                            {smallUnitLabel}
                          </div>
                        </div>
                      </div>
                      <div className="col-span-12 space-y-1 md:col-span-2">
                        <p className="text-xs font-medium text-gray-500">Waste</p>
                        <div className="flex rounded-lg border border-gray-200/70 bg-gray-50">
                          <div className="flex h-9 flex-1 items-center justify-end px-3 text-sm text-gray-900">
                            {formatQuantity(wastePercent, 2)}
                          </div>
                          <div className="flex min-w-9 items-center justify-center rounded-r-lg border-l border-gray-200/70 bg-gray-50 px-2 text-xs font-semibold text-gray-500">
                            %
                          </div>
                        </div>
                      </div>
                      <div className="col-span-12 space-y-1 md:col-span-3">
                        <p className="text-xs font-medium text-gray-500">Subtotal</p>
                        <div className="flex h-9 items-center justify-end rounded-lg border border-gray-200/70 bg-gray-50 px-3 font-mono text-sm text-gray-900">
                          {formatAmount(subtotal)}
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="flex justify-end border-t border-gray-200/70 pt-3">
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Total Estimated COGS</p>
                    <p className="text-lg font-bold text-gray-900">{formatAmount(totalCost)}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <PurchasingFormFooter
          formId="edit-product-form"
          onCancel={() => router.back()}
          submitLabel="Save Changes"
          loading={isSubmitting}
        />
      </form>
    </div>
  );
}
