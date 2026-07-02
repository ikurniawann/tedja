"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Save, Plus, Trash2, Package, Calculator } from "lucide-react";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { NumericInput } from "@/components/ui/numeric-input";
import { ProductFormData, RawMaterialWithStock, BOMItemFormData } from "@/types/purchasing";
import { ITEMS_PRODUCTS_PATH } from "@/modules/purchasing/constants/items-nav";
import { useProductFormData, useProductCategoryOptions } from "../queries";
import { useCreateProduct, useCreateBOMItem } from "../mutations";
import { mapUnitComboboxOptions } from "../product-unit";

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

export function NewProductPage() {
  const router = useRouter();

  const formDataQuery = useProductFormData();
  const materials = formDataQuery.data?.materials ?? [];
  const units = formDataQuery.data?.units ?? [];
  const unitOptions = mapUnitComboboxOptions(units);
  const loading = formDataQuery.isLoading;

  const categoriesQuery = useProductCategoryOptions();
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
    deskripsi: "",
    harga_jual: 0,
    markup_persen: 30,
    is_active: true,
  });
  const [pricingSource, setPricingSource] = useState<"markup" | "price">("markup");

  const [bomItems, setBomItems] = useState<BOMFormItem[]>([]);

  useEffect(() => {
    if (formDataQuery.isError) {
      console.error("Error loading data:", formDataQuery.error);
      toast.error("Gagal memuat data");
    }
  }, [formDataQuery.isError, formDataQuery.error]);

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

  const calculateTotalCost = () => {
    return bomItems.reduce((sum, item) => sum + (item.subtotal || 0), 0);
  };

  const totalCost = calculateTotalCost();

  useEffect(() => {
    setFormData((prev) => {
      if (pricingSource === "markup") {
        const nextPrice = calculatePriceFromMarkup(totalCost, prev.markup_persen || 0);
        return prev.harga_jual === nextPrice ? prev : { ...prev, harga_jual: nextPrice };
      }

      const nextMarkup = calculateMarkupFromPrice(totalCost, prev.harga_jual || 0);
      return prev.markup_persen === nextMarkup ? prev : { ...prev, markup_persen: nextMarkup };
    });
  }, [pricingSource, totalCost]);

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

  const getMaterialSmallUnitLabel = (material?: RawMaterialWithStock) => {
    return material?.satuan_kecil_nama || material?.satuan || "Unit";
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
      router.push(ITEMS_PRODUCTS_PATH);
    } catch (error: unknown) {
      console.error("Error creating product:", error);
      toast.error(getErrorMessage(error, "Gagal menambahkan produk"));
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
        <Link href={ITEMS_PRODUCTS_PATH}>
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tambah Produk Baru</h1>
          <p className="text-sm text-gray-500">Isi detail produk dan BOM</p>
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
                    placeholder="Contoh: Roti Coklat Lumer"
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
                  placeholder="Deskripsi produk..."
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
                      placeholder="Harga jual ke customer"
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
              <Button type="button" size="sm" variant="outline" onClick={addBOMItem} className="h-8 text-xs">
                <Plus className="w-3 h-3 mr-1" />
                Tambah Bahan
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {bomItems.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  Belum ada bahan baku. Klik &quot;Tambah Bahan&quot; untuk menambahkan.
                </div>
              ) : (
                <div className="space-y-3">
                  {bomItems.map((item) => {
                    const selectedMaterial = materials.find((material) => material.id === item.raw_material_id);
                    const smallUnitLabel = getMaterialSmallUnitLabel(selectedMaterial);

                    return (
                    <div key={item.id} className="grid grid-cols-12 gap-3 items-end rounded-lg border border-gray-200/70 bg-white p-3 shadow-sm">
                      <div className="col-span-4 space-y-1.5">
                        <Label className="text-xs">Bahan Baku</Label>
                        <Combobox
                          options={materials.map((m) => ({ value: m.id, label: m.nama, description: m.kode }))}
                          value={item.raw_material_id}
                          onChange={(v) => updateBOMItem(item.id, { raw_material_id: v })}
                          placeholder="Pilih bahan..."
                          searchPlaceholder="Cari..."
                          emptyMessage="Tidak ada bahan"
                          allowClear
                          className="h-9 text-sm"
                        />
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label className="text-xs">Qty</Label>
                        <div className="flex rounded-lg border border-gray-300 bg-white focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100">
                          <NumericInput
                            step="0.01"
                            min="0"
                            value={item.qty_needed}
                            onValueChange={(value) => updateBOMItem(item.id, { qty_needed: value })}
                            decimalScale={4}
                            className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                          />
                          <div className="flex min-w-14 items-center justify-center rounded-r-lg border-l border-gray-200 bg-gray-50 px-3 text-xs font-semibold uppercase text-gray-500">
                            {smallUnitLabel}
                          </div>
                        </div>
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label className="text-xs">Waste (%)</Label>
                        <div className="flex rounded-lg border border-gray-300 bg-white focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100">
                          <NumericInput
                            min="0"
                            max="100"
                            value={item.waste_persen}
                            onValueChange={(value) => updateBOMItem(item.id, { waste_persen: value })}
                            decimalScale={2}
                            className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                          />
                          <div className="flex min-w-10 items-center justify-center rounded-r-lg border-l border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-500">
                            %
                          </div>
                        </div>
                      </div>
                      <div className="col-span-3 space-y-1.5">
                        <Label className="text-xs">Subtotal</Label>
                        <div className="flex rounded-lg border border-gray-300 bg-gray-50 focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100">
                          <div className="flex min-w-12 items-center justify-center rounded-l-lg border-r border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-500">
                            Rp
                          </div>
                          <NumericInput
                            value={item.subtotal}
                            onValueChange={() => undefined}
                            decimalScale={0}
                            disabled
                            className="h-9 rounded-l-none border-0 bg-gray-50 text-sm font-mono shadow-none focus-visible:ring-0"
                          />
                        </div>
                      </div>
                      <div className="col-span-1 space-y-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeBOMItem(item.id)}
                          className="h-9 w-9 text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    );
                  })}
                  
                  <div className="flex justify-end border-t border-gray-200/70 pt-3">
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Total HPP</p>
                      <p className="text-lg font-bold text-gray-900">Rp {totalCost.toLocaleString('id-ID')}</p>
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
            {isSubmitting ? "Menyimpan..." : "Simpan Produk"}
          </Button>
        </div>
      </form>
    </div>
  );
}
