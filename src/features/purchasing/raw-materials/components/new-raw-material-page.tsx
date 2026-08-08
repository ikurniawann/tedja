"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumericInput } from "@/components/ui/numeric-input";
import { ITEMS_RAW_MATERIALS_PATH } from "@/modules/purchasing/constants/items-nav";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/modules/purchasing/components/page/purchasing-page-header";
import { Package, AlertCircle, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { MaterialCategory, RawMaterialFormData } from "@/types/purchasing";
import {
  useRawMaterialUnits,
  useRawMaterialCategoryOptions,
} from "../queries";
import { useCreateRawMaterial } from "../mutations";
import { Combobox } from "@/components/ui/combobox";
import { RawMaterialUnitConversionsEditor } from "@/modules/purchasing/components/raw-materials/RawMaterialUnitConversionsEditor";
import { toLookupOptions } from "../master-lookups";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatQuantity(value?: number | null) {
  return Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function NewRawMaterialPage() {
  const router = useRouter();
  const unitsQuery = useRawMaterialUnits();
  const categoriesQuery = useRawMaterialCategoryOptions();
  const units = unitsQuery.data ?? [];
  const categoryOptions = toLookupOptions(categoriesQuery.data);
  const createMutation = useCreateRawMaterial();
  const loading = createMutation.isPending;
  const masterLoading = categoriesQuery.isLoading;

  const [formData, setFormData] = useState<RawMaterialFormData & { coa_production: string; coa_rnd: string; coa_asset: string }>({
    kode: "",
    nama: "",
    kategori: "",
    deskripsi: "",
    satuan_besar_id: "",
    satuan_kecil_id: undefined,
    harga_beli: 0,
    konversi_factor: 1,
    stok_minimum: 0,
    stok_maximum: 0,
    shelf_life_days: undefined,
    coa_production: "",
    coa_rnd: "",
    coa_asset: "",
    unit_conversions: [],
  });

  const satuanBesar = units.filter((u) => u.tipe === "BESAR" || u.tipe === "KONVERSI");
  const satuanKecil = units.filter((u) => u.tipe === "KECIL" || u.tipe === "KONVERSI");
  const selectedSatuanBesar = satuanBesar.find((u) => u.id === formData.satuan_besar_id);
  const satuanBesarCode = selectedSatuanBesar?.kode || selectedSatuanBesar?.simbol || "-";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.nama || !formData.satuan_besar_id || !formData.kategori) {
      toast.error("Nama bahan, kategori, dan satuan besar wajib diisi");
      return;
    }

    try {
      await createMutation.mutateAsync({
        ...formData,
        coa_production: formData.coa_production || undefined,
        coa_rnd: formData.coa_rnd || undefined,
        coa_asset: formData.coa_asset || undefined,
        unit_conversions: (formData.unit_conversions || [])
          .filter((conversion) => conversion.satuan_id && conversion.qty_in_base_unit > 0)
          .map((conversion) => ({
            satuan_id: conversion.satuan_id,
            qty_in_base_unit: conversion.qty_in_base_unit,
            is_base: false,
          })),
      });
      toast.success("Bahan baku berhasil ditambahkan");
      router.push(ITEMS_RAW_MATERIALS_PATH);
    } catch (error: unknown) {
      console.error("Error creating raw material:", error);
      toast.error(getErrorMessage(error, "Gagal menambahkan bahan baku"));
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={ITEMS_RAW_MATERIALS_PATH}
        title="Tambah Bahan Baku"
        description="Isi detail untuk data bahan baku baru"
      />

      <form id="new-raw-material-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-4 w-4" />
                  Informasi Dasar
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="kode" className="text-xs">
                      Kode Bahan
                    </Label>
                    <Input
                      id="kode"
                      value={formData.kode}
                      onChange={(e) => setFormData({ ...formData, kode: e.target.value })}
                      placeholder="Dibuat otomatis jika kosong"
                      maxLength={20}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="kategori" className="text-xs">
                      Kategori <span className="text-red-500">*</span>
                    </Label>
                    <Combobox
                      options={categoryOptions}
                      value={formData.kategori || ""}
                      onChange={(v) => setFormData({ ...formData, kategori: v as MaterialCategory })}
                      placeholder={masterLoading ? "Memuat kategori..." : "Pilih kategori..."}
                      searchPlaceholder="Cari kategori..."
                      emptyMessage="Kategori tidak ditemukan"
                      allowClear
                      className="h-9 text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="nama" className="text-xs">
                    Nama Bahan <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="nama"
                    value={formData.nama}
                    onChange={(e) => setFormData({ ...formData, nama: e.target.value })}
                    placeholder="Contoh: Gula Pasir Premium"
                    maxLength={100}
                    required
                    className="h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="deskripsi" className="text-xs">
                    Deskripsi
                  </Label>
                  <Textarea
                    id="deskripsi"
                    value={formData.deskripsi}
                    onChange={(e) => setFormData({ ...formData, deskripsi: e.target.value })}
                    placeholder="Deskripsi tambahan..."
                    rows={2}
                    className="resize-none text-sm"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-4 w-4" />
                  Satuan
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="satuan_besar" className="text-xs">
                    Satuan Besar <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={satuanBesar.map((u) => ({ value: u.id, label: u.nama, description: u.kode }))}
                    value={formData.satuan_besar_id}
                    onChange={(v) => setFormData({ ...formData, satuan_besar_id: v })}
                    placeholder="Pilih satuan..."
                    searchPlaceholder="Cari..."
                    emptyMessage="Satuan tidak ditemukan"
                    allowClear
                    className="h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="satuan_kecil" className="text-xs">
                    Satuan Kecil
                  </Label>
                  <Combobox
                    options={[
                      { value: "", label: "Tidak ada", description: "Tanpa satuan kecil" },
                      ...satuanKecil.map((u) => ({ value: u.id, label: u.nama, description: u.kode })),
                    ]}
                    value={formData.satuan_kecil_id || ""}
                    onChange={(v) => setFormData({ ...formData, satuan_kecil_id: v || undefined })}
                    placeholder="Opsional..."
                    searchPlaceholder="Cari..."
                    emptyMessage="Satuan tidak ditemukan"
                    allowClear
                    className="h-9 text-sm"
                  />
                </div>

                {formData.satuan_kecil_id && (
                  <div className="space-y-1.5">
                    <Label htmlFor="konversi" className="text-xs">
                      Faktor Konversi
                    </Label>
                    <NumericInput
                      id="konversi"
                      min="0"
                      value={formData.konversi_factor}
                      onValueChange={(value) => setFormData({ ...formData, konversi_factor: value || 1 })}
                      decimalScale={4}
                      className="h-9 text-sm"
                    />
                    <p className="text-xs text-gray-500">
                      1 {satuanBesar.find((u) => u.id === formData.satuan_besar_id)?.nama} ={" "}
                      {formatQuantity(formData.konversi_factor)}{" "}
                      {satuanKecil.find((u) => u.id === formData.satuan_kecil_id)?.nama}
                    </p>
                  </div>
                )}

                <RawMaterialUnitConversionsEditor
                  units={units}
                  baseUnitId={formData.satuan_kecil_id || formData.satuan_besar_id}
                  bigUnitId={formData.satuan_besar_id}
                  bigUnitFactor={formData.satuan_kecil_id ? formData.konversi_factor : 1}
                  conversions={(formData.unit_conversions || []).filter(
                    (conversion) =>
                      conversion.satuan_id !== formData.satuan_besar_id &&
                      conversion.satuan_id !== formData.satuan_kecil_id
                  )}
                  onChange={(unit_conversions) => setFormData({ ...formData, unit_conversions })}
                />
              </CardContent>
            </Card>
          </div>

          <Card className="border-gray-200/70 shadow-xs lg:col-span-4">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertCircle className="h-4 w-4" />
                Pengaturan Stok
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="stok_minimum" className="text-xs">
                    Stok Minimum
                  </Label>
                  <div className="flex rounded-lg border border-gray-200/70 bg-white focus-within:border-pink-300 focus-within:ring-2 focus-within:ring-pink-100">
                    <NumericInput
                      id="stok_minimum"
                      value={formData.stok_minimum}
                      onValueChange={(value) => setFormData({ ...formData, stok_minimum: value })}
                      decimalScale={4}
                      className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    <div className="flex min-w-14 items-center justify-center rounded-r-lg border-l border-gray-200/70 bg-gray-50 px-3 text-xs font-semibold uppercase text-gray-500">
                      {satuanBesarCode}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">
                    Peringatan saat stok satuan besar berada di nilai ini atau kurang
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="stok_maximum" className="text-xs">
                    Stok Maksimum
                  </Label>
                  <div className="flex rounded-lg border border-gray-200/70 bg-white focus-within:border-pink-300 focus-within:ring-2 focus-within:ring-pink-100">
                    <NumericInput
                      id="stok_maximum"
                      value={formData.stok_maximum ?? 0}
                      onValueChange={(value) => setFormData({ ...formData, stok_maximum: value })}
                      decimalScale={4}
                      className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    <div className="flex min-w-14 items-center justify-center rounded-r-lg border-l border-gray-200/70 bg-gray-50 px-3 text-xs font-semibold uppercase text-gray-500">
                      {satuanBesarCode}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="harga_beli" className="text-xs">
                  Harga Beli
                </Label>
                <div className="flex rounded-lg border border-gray-200/70 bg-white focus-within:border-pink-300 focus-within:ring-2 focus-within:ring-pink-100">
                  <NumericInput
                    id="harga_beli"
                    value={formData.harga_beli}
                    onValueChange={(value) => setFormData({ ...formData, harga_beli: value })}
                    decimalScale={0}
                    className="h-9 rounded-none border-0 text-sm font-mono shadow-none focus-visible:ring-0"
                  />
                  <div className="flex min-w-16 items-center justify-center rounded-r-lg border-l border-gray-200/70 bg-gray-50 px-3 text-xs font-semibold uppercase text-gray-500">
                    /{satuanBesarCode}
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Harga beli acuan per satuan besar (dipakai sebelum ada penerimaan barang)
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="shelf_life" className="text-xs">
                  Masa Simpan (hari)
                </Label>
                <Input
                  id="shelf_life"
                  type="number"
                  min="0"
                  value={formData.shelf_life_days || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, shelf_life_days: parseInt(e.target.value, 10) || undefined })
                  }
                  placeholder="Opsional"
                  className="h-9 text-sm"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4" />
              Chart of Accounts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="coa_production" className="text-xs">
                  Produksi
                </Label>
                <Input
                  id="coa_production"
                  value={formData.coa_production}
                  onChange={(e) => setFormData({ ...formData, coa_production: e.target.value })}
                  placeholder="Contoh: 5-1001"
                  maxLength={50}
                  className="h-9 text-sm"
                />
                <p className="text-xs text-gray-500">Kode akun untuk pemakaian produksi</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coa_rnd" className="text-xs">
                  Riset &amp; Pengembangan
                </Label>
                <Input
                  id="coa_rnd"
                  value={formData.coa_rnd}
                  onChange={(e) => setFormData({ ...formData, coa_rnd: e.target.value })}
                  placeholder="Contoh: 5-2001"
                  maxLength={50}
                  className="h-9 text-sm"
                />
                <p className="text-xs text-gray-500">Kode akun untuk pemakaian riset &amp; pengembangan</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coa_asset" className="text-xs">
                  Aset
                </Label>
                <Input
                  id="coa_asset"
                  value={formData.coa_asset}
                  onChange={(e) => setFormData({ ...formData, coa_asset: e.target.value })}
                  placeholder="Contoh: 1-3001"
                  maxLength={50}
                  className="h-9 text-sm"
                />
                <p className="text-xs text-gray-500">Kode akun untuk pencatatan aset</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <PurchasingFormFooter
          formId="new-raw-material-form"
          onCancel={() => router.back()}
          submitLabel="Simpan Bahan Baku"
          loading={loading}
        />
      </form>
    </div>
  );
}
