"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Save, Plus, Trash2, Package, Calculator, Edit } from "lucide-react";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { NumericInput } from "@/components/ui/numeric-input";
import { ProductFormData, BOMItem, RawMaterialWithStock } from "@/types/purchasing";
import { ITEMS_PRODUCTS_PATH } from "@/modules/purchasing/constants/items-nav";
import { useProductEditData, useProductCategoryOptions } from "../queries";
import { useUpdateProduct } from "../mutations";
import { mapUnitComboboxOptions } from "../product-unit";

interface BOMFormItem extends Partial<BOMItem> {
  id: string;
  raw_material_name?: string;
  raw_material_unit?: string;
  subtotal: number;
}

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

function formatNumber(value: number | string | null | undefined, maxFractionDigits = 4) {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: maxFractionDigits,
  }).format(Number(value) || 0);
}

function getMaterialCost(material?: RawMaterialWithStock) {
  const baseCost = Number(material?.avg_cost ?? material?.harga_avg ?? material?.harga_terakhir ?? 0);
  // Harga acuan disimpan per satuan BESAR; BOM memakai qty satuan KECIL,
  // jadi cost dinormalisasi ke satuan kecil (÷ konversi_factor) bila ada satuan kecil.
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
    deskripsi: "",
    harga_jual: 0,
    markup_persen: 30,
    is_active: true,
  });

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
      deskripsi: productData.deskripsi || "",
      harga_jual: productData.harga_jual || 0,
      markup_persen: productData.markup_persen ?? 30,
      is_active: productData.is_active ?? true,
    });
  }, [editQuery.data]);

  const calculateTotalCost = () => {
    return bomItems.reduce((sum, item) => {
      const material = materials.find(m => m.id === item.raw_material_id);
      const qty = getBomQty(item);
      const waste = getBomWastePercent(item);
      const price = getMaterialCost(material);
      return sum + (price * qty * (1 + waste / 100));
    }, 0);
  };

  const totalCost = calculateTotalCost();

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
      toast.error("Nama produk wajib diisi");
      return;
    }
    if (!formData.satuan_id) {
      toast.error("Satuan wajib dipilih");
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
      toast.success("Produk berhasil diupdate");
      router.push(`${ITEMS_PRODUCTS_PATH}/${productId}`);
    } catch (error: unknown) {
      console.error("Error updating product:", error);
      toast.error(error instanceof Error ? error.message : "Gagal mengupdate produk");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center text-gray-500">Memuat data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`${ITEMS_PRODUCTS_PATH}/${productId}`}>
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Edit Produk</h1>
          <p className="text-sm text-gray-500">Update detail produk dan BOM</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Full Column Layout */}
        <div className="space-y-6">
          
          {/* Card 1: Informasi Produk */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="w-4 h-4" />
                Informasi Produk
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="nama" className="text-xs">Nama Produk <span className="text-red-500">*</span></Label>
                  <Input
                    id="nama"
                    value={formData.nama}
                    onChange={(e) => setFormData({ ...formData, nama: e.target.value })}
                    required
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="kategori" className="text-xs">Kategori <span className="text-red-500">*</span></Label>
                  <Combobox
                    options={categoryOptions}
                    value={formData.kategori}
                    onChange={(v) => setFormData({ ...formData, kategori: v })}
                    placeholder={categoriesQuery.isLoading ? "Memuat kategori..." : "Pilih kategori..."}
                    searchPlaceholder="Cari..."
                    emptyMessage="Tidak ada kategori"
                    disabled={categoriesQuery.isLoading}
                    allowClear
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="satuan_id" className="text-xs">Satuan <span className="text-red-500">*</span></Label>
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

              <div className="space-y-1.5">
                <Label htmlFor="deskripsi" className="text-xs">Deskripsi</Label>
                <Textarea
                  id="deskripsi"
                  value={formData.deskripsi}
                  onChange={(e) => setFormData({ ...formData, deskripsi: e.target.value })}
                  rows={2}
                  className="text-sm resize-none"
                />
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Pricing */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Calculator className="w-4 h-4" />
                Pricing & HPP
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="harga_modal" className="text-xs">Harga Modal (HPP)</Label>
                  <div className="flex rounded-lg border border-gray-300 bg-gray-50 focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100">
                    <div className="flex min-w-12 items-center justify-center rounded-l-lg border-r border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-500">
                      Rp
                    </div>
                    <NumericInput
                      id="harga_modal"
                      value={totalCost}
                      onValueChange={() => undefined}
                      decimalScale={0}
                      disabled
                      className="h-9 rounded-l-none border-0 bg-gray-50 text-sm font-mono shadow-none focus-visible:ring-0"
                    />
                  </div>
                  <p className="text-xs text-gray-500">Dari BOM</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="markup" className="text-xs">Markup (%)</Label>
                  <div className="flex rounded-lg border border-gray-300 bg-white focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100">
                    <NumericInput
                      id="markup"
                      min="0"
                      max="1000"
                      value={formData.markup_persen}
                      onValueChange={handleMarkupChange}
                      decimalScale={2}
                      className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    <div className="flex min-w-12 items-center justify-center rounded-r-lg border-l border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-500">
                      %
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="harga_jual" className="text-xs">Harga Jual</Label>
                  <div className="flex rounded-lg border border-gray-300 bg-white focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100">
                    <div className="flex min-w-12 items-center justify-center rounded-l-lg border-r border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-500">
                      Rp
                    </div>
                    <NumericInput
                      id="harga_jual"
                      value={formData.harga_jual}
                      onValueChange={handlePriceChange}
                      decimalScale={0}
                      className="h-9 rounded-l-none border-0 text-sm font-mono shadow-none focus-visible:ring-0"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card 3: Bill of Materials (BOM) */}
          <Card>
            <CardHeader className="pb-3 flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="w-4 h-4" />
                Bill of Materials (BOM)
              </CardTitle>
              <Badge variant="secondary" className="text-xs">
                {bomItems.length} bahan
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {bomItems.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  Belum ada bahan baku dalam BOM
                </div>
              ) : (
                <div className="space-y-2">
                  {bomItems.map((item) => {
                    const material = materials.find(m => m.id === item.raw_material_id);
                    const qty = getBomQty(item);
                    const wastePercent = getBomWastePercent(item);
                    const smallUnitLabel = getMaterialSmallUnitLabel(material);
                    const subtotal = getMaterialCost(material) * qty * (1 + wastePercent / 100);
                    return (
                      <div key={item.id} className="grid grid-cols-12 gap-4 rounded-lg border border-gray-200/70 bg-white p-3 shadow-sm">
                        <div className="col-span-12 min-w-0 md:col-span-5">
                          <p className="text-sm font-medium">{material?.nama || "Unknown"}</p>
                          <p className="text-xs text-gray-500">{material?.kode}</p>
                        </div>
                        <div className="col-span-12 space-y-1 md:col-span-2">
                          <p className="text-xs font-medium text-gray-500">Qty</p>
                          <div className="flex rounded-lg border border-gray-200/70 bg-gray-50">
                            <div className="flex h-9 flex-1 items-center justify-end px-3 text-sm text-gray-900">{formatNumber(qty)}</div>
                            <div className="flex min-w-14 items-center justify-center rounded-r-lg border-l border-gray-200 bg-gray-50 px-3 text-xs font-semibold uppercase text-gray-500">
                              {smallUnitLabel}
                            </div>
                          </div>
                        </div>
                        <div className="col-span-12 space-y-1 md:col-span-2">
                          <p className="text-xs font-medium text-gray-500">Waste</p>
                          <div className="flex rounded-lg border border-gray-200/70 bg-gray-50">
                            <div className="flex h-9 flex-1 items-center justify-end px-3 text-sm text-gray-900">{formatNumber(wastePercent, 2)}</div>
                            <div className="flex min-w-9 items-center justify-center rounded-r-lg border-l border-gray-200 bg-gray-50 px-2 text-xs font-semibold text-gray-500">
                              %
                            </div>
                          </div>
                        </div>
                        <div className="col-span-12 space-y-1 md:col-span-3">
                          <p className="text-xs font-medium text-gray-500">Subtotal</p>
                          <div className="flex rounded-lg border border-gray-200/70 bg-gray-50">
                            <div className="flex min-w-12 items-center justify-center rounded-l-lg border-r border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-500">
                              Rp
                            </div>
                            <div className="flex h-9 flex-1 items-center justify-end px-3 font-mono text-sm text-gray-900">
                              {formatNumber(subtotal, 0)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  
                  <div className="flex justify-end border-t border-gray-200/70 pt-3">
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Total HPP</p>
                      <p className="text-lg font-bold text-gray-900">Rp {formatNumber(totalCost, 0)}</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-200/70 pt-4">
          <Button type="button" variant="outline" onClick={() => router.back()} className="purchasing-secondary-button px-6">
            Batal
          </Button>
          <Button type="submit" disabled={isSubmitting} className="purchasing-main-button px-6">
            <Save className="w-4 h-4 mr-2" />
            {isSubmitting ? "Menyimpan..." : "Simpan Perubahan"}
          </Button>
        </div>
      </form>
    </div>
  );
}
