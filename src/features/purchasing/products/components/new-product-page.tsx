"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Calculator, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { NumericInput } from "@/components/ui/numeric-input";
import { ProductFormData, RawMaterialWithStock, BOMItemFormData } from "@/types/purchasing";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/modules/purchasing/components/page/purchasing-page-header";
import { formatAmount } from "@/lib/purchasing/utils";
import { useProductFormData, useProductCategoryOptions, useProductWarehouses } from "../queries";
import { useCreateProduct, useCreateBOMItem } from "../mutations";
import { mapUnitComboboxOptions } from "../product-unit";
import { ProductOutputTypeField } from "./product-output-type-field";
import { STALL_LABELS } from "@/lib/configuration/stall-labels";
import type { ProductOutputType } from "@/types/purchasing";

interface BOMFormItem extends Partial<BOMItemFormData> {
  id: string;
  raw_material_name?: string;
  raw_material_unit?: string;
  subtotal: number;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
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

export function NewProductPage() {
  const router = useRouter();

  const formDataQuery = useProductFormData();
  const materials = formDataQuery.data?.materials ?? [];
  const units = formDataQuery.data?.units ?? [];
  const unitOptions = mapUnitComboboxOptions(units);
  const loading = formDataQuery.isLoading;

  const categoriesQuery = useProductCategoryOptions();
  const warehousesQuery = useProductWarehouses();
  const categoryOptions = (categoriesQuery.data ?? []).map((row) => ({
    value: row.code,
    label: row.nama,
    description: row.deskripsi || undefined,
  }));

  const createMutation = useCreateProduct();
  const createBomMutation = useCreateBOMItem();
  const isSubmitting = createMutation.isPending || createBomMutation.isPending;

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
  });
  const stallOptions = (warehousesQuery.data ?? []).map((w) => ({
    value: w.id,
    label: w.name,
    description: w.code,
  }));
  const [bomItems, setBomItems] = useState<BOMFormItem[]>([]);

  useEffect(() => {
    if (formDataQuery.isError) {
      console.error("Error loading data:", formDataQuery.error);
      toast.error(getErrorMessage(formDataQuery.error, "Gagal memuat data formulir"));
    }
  }, [formDataQuery.isError, formDataQuery.error]);

  useEffect(() => {
    const warehouses = warehousesQuery.data;
    if (!warehouses?.length || formData.warehouse_id) return;
    const defaultWarehouse = warehouses.find((w) => w.is_default) ?? warehouses[0];
    setFormData((prev) => ({ ...prev, warehouse_id: defaultWarehouse.id }));
  }, [warehousesQuery.data, formData.warehouse_id]);

  const addBOMItem = () => {
    setBomItems([
      ...bomItems,
      {
        id: crypto.randomUUID(),
        raw_material_id: "",
        qty_needed: 0,
        waste_persen: 0,
        subtotal: 0,
      },
    ]);
  };

  const removeBOMItem = (id: string) => {
    setBomItems(bomItems.filter((item) => item.id !== id));
  };

  const updateBOMItem = (id: string, updates: Partial<BOMFormItem>) => {
    setBomItems(
      bomItems.map((item) => {
        if (item.id === id) {
          const updated = { ...item, ...updates };
          const material = materials.find((m) => m.id === updated.raw_material_id);
          const qty = updated.qty_needed || 0;
          const waste = updated.waste_persen || 0;
          const price = getMaterialCost(material);
          updated.subtotal = price * qty * (1 + waste / 100);
          return updated;
        }
        return item;
      })
    );
  };

  const totalCost = bomItems.reduce((sum, item) => sum + (item.subtotal || 0), 0);

  useEffect(() => {
    setFormData((prev) => {
      const nextMarkup = calculateMarkupFromPrice(totalCost, prev.harga_jual || 0);
      return prev.markup_persen === nextMarkup ? prev : { ...prev, markup_persen: nextMarkup };
    });
  }, [totalCost]);

  const handlePriceChange = (value: number) => {
    setFormData((prev) => ({
      ...prev,
      harga_jual: value,
      markup_persen: calculateMarkupFromPrice(totalCost, value),
    }));
  };

  const getMaterialSmallUnitLabel = (material?: RawMaterialWithStock) => {
    return material?.satuan_kecil_nama || material?.satuan || "Satuan";
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
      toast.error(`${STALL_LABELS.singular} is required`);
      return;
    }

    try {
      const productData = {
        ...formData,
        harga_modal: totalCost,
      };
      const product = await createMutation.mutateAsync(productData);

      for (const item of bomItems) {
        if (item.raw_material_id) {
          await createBomMutation.mutateAsync({
            productId: product.id,
            payload: {
              raw_material_id: item.raw_material_id,
              qty_needed: item.qty_needed || 0,
              waste_persen: item.waste_persen || 0,
            },
          });
        }
      }

      toast.success("Produk berhasil ditambahkan");
      router.push(PRODUCT_ROUTES.products);
    } catch (error: unknown) {
      console.error("Error creating product:", error);
      toast.error(getErrorMessage(error, "Gagal menambahkan produk"));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
        Memuat data formulir...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.products}
        title="Tambah Produk"
        description="Isi detail produk dan resep (BOM)"
      />

      <form id="new-product-form" onSubmit={handleSubmit} className="space-y-6">
        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4 text-pink-600" />
              Informasi Produk
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="nama" className="text-xs">
                  Nama Produk <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="nama"
                  value={formData.nama}
                  onChange={(e) => setFormData({ ...formData, nama: e.target.value })}
                  placeholder="Contoh: Roti Lava Cokelat"
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
                  disabled={warehousesQuery.isLoading}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kategori" className="text-xs">
                  Kategori <span className="text-red-500">*</span>
                </Label>
                <Combobox
                  options={categoryOptions}
                  value={formData.kategori}
                  onChange={(v) => setFormData({ ...formData, kategori: v })}
                  placeholder={categoriesQuery.isLoading ? "Memuat kategori..." : "Pilih kategori..."}
                  searchPlaceholder="Cari kategori..."
                  emptyMessage="Kategori tidak ditemukan"
                  disabled={categoriesQuery.isLoading}
                  allowClear
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="satuan_id" className="text-xs">
                  Satuan <span className="text-red-500">*</span>
                </Label>
                <Combobox
                  options={unitOptions}
                  value={formData.satuan_id || ""}
                  onChange={(v) => setFormData({ ...formData, satuan_id: v })}
                  placeholder={loading ? "Memuat satuan..." : "Pilih satuan..."}
                  searchPlaceholder="Cari satuan..."
                  emptyMessage="Satuan tidak ditemukan"
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
                Deskripsi
              </Label>
              <Textarea
                id="deskripsi"
                value={formData.deskripsi}
                onChange={(e) => setFormData({ ...formData, deskripsi: e.target.value })}
                placeholder="Deskripsi produk..."
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
              Harga & Estimasi HPP
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="harga_modal" className="text-xs">
                  Estimasi HPP
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
                <p className="text-xs text-gray-500">Dihitung dari resep (BOM)</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="markup" className="text-xs">
                  Markup (%)
                </Label>
                <div className="flex rounded-lg border border-gray-200/70 bg-gray-50">
                  <NumericInput
                    id="markup"
                    value={formData.markup_persen}
                    onValueChange={() => undefined}
                    decimalScale={2}
                    disabled
                    className="h-9 rounded-r-none border-0 bg-gray-50 text-sm shadow-none focus-visible:ring-0"
                  />
                  <div className="flex min-w-12 items-center justify-center rounded-r-lg border-l border-gray-200/70 bg-gray-50 px-3 text-xs font-semibold text-gray-500">
                    %
                  </div>
                </div>
                <p className="text-xs text-gray-500">Dihitung dari harga jual vs HPP. 100% = 2× HPP</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="harga_jual" className="text-xs">
                  Harga Jual
                </Label>
                <div className="flex rounded-lg border border-gray-200/70 bg-white focus-within:border-pink-300 focus-within:ring-2 focus-within:ring-pink-100">
                  <NumericInput
                    id="harga_jual"
                    value={formData.harga_jual}
                    onValueChange={handlePriceChange}
                    decimalScale={0}
                    placeholder="Harga jual ke pelanggan"
                    className="h-9 border-0 text-sm font-mono shadow-none focus-visible:ring-0"
                  />
                </div>
                <p className="text-xs text-gray-500">Harga ke pelanggan. Bisa diisi manual</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4 text-pink-600" />
              Resep (BOM)
            </CardTitle>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addBOMItem}
              className="h-8 border-pink-200 text-xs text-pink-700 hover:bg-pink-50"
            >
              <Plus className="mr-1 h-3 w-3" />
              Tambah Bahan
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {bomItems.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-500">
                Belum ada bahan baku. Klik &quot;Tambah Bahan&quot; untuk memulai.
              </div>
            ) : (
              <div className="space-y-3">
                {bomItems.map((item) => {
                  const selectedMaterial = materials.find(
                    (material) => material.id === item.raw_material_id
                  );
                  const smallUnitLabel = getMaterialSmallUnitLabel(selectedMaterial);

                  return (
                    <div
                      key={item.id}
                      className="grid grid-cols-12 items-end gap-3 rounded-lg border border-gray-200/70 bg-white p-3"
                    >
                      <div className="col-span-4 space-y-1.5">
                        <Label className="text-xs">Bahan Baku</Label>
                        <Combobox
                          options={materials.map((m) => ({
                            value: m.id,
                            label: m.nama,
                            description: m.kode,
                          }))}
                          value={item.raw_material_id}
                          onChange={(v) => updateBOMItem(item.id, { raw_material_id: v })}
                          placeholder="Pilih bahan..."
                          searchPlaceholder="Cari..."
                          emptyMessage="Bahan tidak ditemukan"
                          allowClear
                          className="h-9 text-sm"
                        />
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label className="text-xs">Qty</Label>
                        <div className="flex rounded-lg border border-gray-200/70 bg-white focus-within:border-pink-300 focus-within:ring-2 focus-within:ring-pink-100">
                          <NumericInput
                            step="0.01"
                            min="0"
                            value={item.qty_needed}
                            onValueChange={(value) => updateBOMItem(item.id, { qty_needed: value })}
                            decimalScale={4}
                            className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                          />
                          <div className="flex min-w-14 items-center justify-center rounded-r-lg border-l border-gray-200/70 bg-gray-50 px-3 text-xs font-semibold uppercase text-gray-500">
                            {smallUnitLabel}
                          </div>
                        </div>
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label className="text-xs">Susut (%)</Label>
                        <div className="flex rounded-lg border border-gray-200/70 bg-white focus-within:border-pink-300 focus-within:ring-2 focus-within:ring-pink-100">
                          <NumericInput
                            min="0"
                            max="100"
                            value={item.waste_persen}
                            onValueChange={(value) => updateBOMItem(item.id, { waste_persen: value })}
                            decimalScale={2}
                            className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                          />
                          <div className="flex min-w-10 items-center justify-center rounded-r-lg border-l border-gray-200/70 bg-gray-50 px-3 text-xs font-semibold text-gray-500">
                            %
                          </div>
                        </div>
                      </div>
                      <div className="col-span-3 space-y-1.5">
                        <Label className="text-xs">Subtotal</Label>
                        <div className="flex h-9 items-center rounded-lg border border-gray-200/70 bg-gray-50 px-3 font-mono text-sm text-gray-900">
                          {formatAmount(item.subtotal)}
                        </div>
                      </div>
                      <div className="col-span-1 space-y-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeBOMItem(item.id)}
                          title="Hapus bahan"
                          className="h-9 w-9 text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}

                <div className="flex justify-end border-t border-gray-200/70 pt-3">
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Total Estimasi HPP</p>
                    <p className="text-lg font-bold text-gray-900">{formatAmount(totalCost)}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <PurchasingFormFooter
          formId="new-product-form"
          onCancel={() => router.back()}
          submitLabel="Simpan Produk"
          loading={isSubmitting}
        />
      </form>
    </div>
  );
}
