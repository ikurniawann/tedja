"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { DsDateTimePicker } from "@/components/design-system";
import { toast } from "sonner";
import { formatAmount } from "@/lib/purchasing/utils";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { useProductDeliveryPOOptions, useProductPOItemsForDelivery } from "../queries";
import { useCreateProductDelivery } from "../mutations";
import { ArrowLeft, Info, Loader2, Package, Save, Truck } from "lucide-react";

const DELIVERY_LIST = PRODUCT_ROUTES.purchasingDelivery;

interface ProductPOItemRow {
  id: string;
  qty_ordered?: number | string | null;
  harga_satuan?: number | string | null;
  subtotal?: number | string | null;
  product?: { id: string; nama: string; kode?: string | null } | null;
  satuan?: { nama?: string; nama_satuan?: string } | null;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatQuantity(value?: number | string | null) {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 }).format(
    Number.isFinite(num) ? num : 0
  );
}

const GUIDELINES = [
  "Pilih purchase order yang sudah disetujui, dikirim, atau diterima sebagian.",
  "Purchase order yang pengirimannya sudah selesai tetap bisa menerima pengiriman tambahan.",
  "Purchase order yang masih memiliki pengiriman berjalan disembunyikan dari daftar ini.",
  "Nomor surat jalan, tanggal kirim, dan estimasi tanggal tiba wajib diisi.",
  "Status awal adalah menunggu penerimaan.",
];

export function NewProductDeliveryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [formData, setFormData] = useState({
    po_id: "",
    vendor_id: "",
    no_surat_jalan: "",
    kurir: "",
    no_resi: "",
    tanggal_kirim: new Date().toISOString().split("T")[0],
    tanggal_estimasi_tiba: "",
    catatan: "",
  });

  const poOptionsQuery = useProductDeliveryPOOptions(false);
  const poList = poOptionsQuery.data ?? [];
  const fetchingPOs = poOptionsQuery.isLoading;

  const createMutation = useCreateProductDelivery();
  const loading = createMutation.isPending;

  useEffect(() => {
    const poId = searchParams.get("po_id");
    if (!poId || fetchingPOs) return;

    const po = poList.find((p) => p.id === poId);
    if (po) {
      setFormData((prev) =>
        prev.po_id ? prev : { ...prev, po_id: poId, vendor_id: po.vendor_id || "" }
      );
      return;
    }

    if (poList.length > 0 || !poOptionsQuery.isLoading) {
      toast.error("Purchase order ini sudah memiliki pengiriman atau tidak memenuhi syarat.");
    }
  }, [searchParams, poList, fetchingPOs, poOptionsQuery.isLoading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.po_id || !formData.no_surat_jalan.trim()) {
      toast.error("Purchase order dan nomor surat jalan wajib diisi.");
      return;
    }

    if (!formData.tanggal_kirim) {
      toast.error("Tanggal kirim wajib diisi.");
      return;
    }

    if (!formData.tanggal_estimasi_tiba) {
      toast.error("Estimasi tanggal tiba wajib diisi.");
      return;
    }

    try {
      const data = await createMutation.mutateAsync(formData);
      toast.success(`Pengiriman ${data.nomor_resi || ""} berhasil dibuat.`);
      router.push(data.id ? `${DELIVERY_LIST}/${data.id}` : DELIVERY_LIST);
      router.refresh();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Gagal membuat pengiriman."));
    }
  }

  const selectedPO = poList.find((po) => po.id === formData.po_id);

  const poItemsQuery = useProductPOItemsForDelivery(formData.po_id);
  const poItems = (poItemsQuery.data ?? []) as ProductPOItemRow[];
  const fetchingPOItems = poItemsQuery.isLoading;

  const itemsSubtotal = useMemo(
    () => poItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0),
    [poItems]
  );

  const canSubmit =
    Boolean(formData.po_id) &&
    Boolean(formData.no_surat_jalan.trim()) &&
    Boolean(formData.tanggal_kirim) &&
    Boolean(formData.tanggal_estimasi_tiba);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Link href={DELIVERY_LIST}>
            <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
              <ArrowLeft className="h-4 w-4" />
              Kembali
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tambah Pengiriman</h1>
            <p className="text-sm text-gray-500">
              Catat pengiriman dari vendor berdasarkan purchase order
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Truck className="h-4 w-4" />
                  Informasi Pengiriman
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs">
                    Purchase Order <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={poList.map((po) => ({
                      value: po.id,
                      label: po.nomor_po,
                      description: po.nama_supplier ?? undefined,
                    }))}
                    value={formData.po_id}
                    onChange={(value) => {
                      const po = poList.find((p) => p.id === value);
                      setFormData((prev) => ({
                        ...prev,
                        po_id: value,
                        vendor_id: po?.vendor_id || "",
                      }));
                    }}
                    placeholder={fetchingPOs ? "Memuat purchase order..." : "Pilih purchase order"}
                    searchPlaceholder="Cari purchase order atau vendor..."
                    emptyMessage="Tidak ada purchase order yang memenuhi syarat"
                    allowClear
                    disabled={fetchingPOs}
                    className="w-full! h-9 text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="no_surat_jalan" className="text-xs">
                      No. Surat Jalan <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="no_surat_jalan"
                      placeholder="Contoh: DN-2025-0001"
                      value={formData.no_surat_jalan}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, no_surat_jalan: e.target.value }))
                      }
                      className="h-9 text-sm"
                    />
                  </div>

                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="no_resi" className="text-xs">
                      No. Resi
                    </Label>
                    <Input
                      id="no_resi"
                      placeholder="Contoh: JNE123456789"
                      value={formData.no_resi}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, no_resi: e.target.value }))
                      }
                      className="h-9 text-sm"
                    />
                  </div>
                </div>

                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="kurir" className="text-xs">
                    Ekspedisi / Perusahaan Pengiriman
                  </Label>
                  <Input
                    id="kurir"
                    placeholder="Contoh: JNE, J&T, SiCepat"
                    value={formData.kurir}
                    onChange={(e) => setFormData((prev) => ({ ...prev, kurir: e.target.value }))}
                    className="h-9 text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <DsDateTimePicker
                    label="Tanggal Kirim"
                    value={formData.tanggal_kirim}
                    onChange={(v) => setFormData((prev) => ({ ...prev, tanggal_kirim: v }))}
                    placeholder="Pilih tanggal kirim..."
                    dateOnly
                    required
                  />
                  <DsDateTimePicker
                    label="Estimasi Tanggal Tiba"
                    value={formData.tanggal_estimasi_tiba}
                    onChange={(v) => setFormData((prev) => ({ ...prev, tanggal_estimasi_tiba: v }))}
                    placeholder="Pilih estimasi tanggal tiba..."
                    dateOnly
                    required
                  />
                </div>

                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="catatan" className="text-xs">
                    Catatan
                  </Label>
                  <Textarea
                    id="catatan"
                    placeholder="Tambahkan catatan bila diperlukan..."
                    value={formData.catatan}
                    onChange={(e) => setFormData((prev) => ({ ...prev, catatan: e.target.value }))}
                    rows={3}
                    className="resize-none text-sm"
                  />
                </div>
              </CardContent>
            </Card>

            {formData.po_id && (
              <Card className="border-gray-200/70 shadow-xs">
                <CardHeader className="border-b border-gray-200/70 pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Package className="h-4 w-4" />
                    Item Purchase Order
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {fetchingPOItems ? (
                    <div className="flex items-center justify-center py-10 text-sm text-gray-500">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Memuat item purchase order...
                    </div>
                  ) : poItems.length === 0 ? (
                    <div className="py-10 text-center text-sm text-gray-500">
                      Tidak ada item untuk purchase order ini
                    </div>
                  ) : (
                    <div className="overflow-x-auto px-4">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200/70 text-xs uppercase tracking-wide text-gray-500">
                            <th className="py-3 pr-4 text-left font-semibold">Produk</th>
                            <th className="px-4 py-3 text-right font-semibold">Qty</th>
                            <th className="px-4 py-3 text-left font-semibold">Satuan</th>
                            <th className="px-4 py-3 text-right font-semibold">Harga Satuan</th>
                            <th className="py-3 pl-4 text-right font-semibold">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200/70">
                          {poItems.map((item) => (
                            <tr key={item.id} className="hover:bg-gray-50/80">
                              <td className="py-3 pr-4">
                                <div className="font-medium text-gray-900">
                                  {item.product?.nama || "-"}
                                </div>
                                <div className="text-xs text-gray-500">{item.product?.kode || ""}</div>
                              </td>
                              <td className="px-4 py-3 text-right text-gray-700">
                                {formatQuantity(item.qty_ordered)}
                              </td>
                              <td className="px-4 py-3 text-gray-700">
                                {item.satuan?.nama || item.satuan?.nama_satuan || "-"}
                              </td>
                              <td className="px-4 py-3 text-right text-gray-700">
                                {formatAmount(item.harga_satuan)}
                              </td>
                              <td className="py-3 pl-4 text-right font-medium text-gray-900">
                                {formatAmount(item.subtotal)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="xl:col-span-4">
            <Card className="border-gray-200/70 shadow-xs xl:sticky xl:top-6">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="text-base">Ringkasan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                {selectedPO ? (
                  <dl className="space-y-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-gray-500">Purchase Order</dt>
                      <dd className="text-right font-medium text-gray-900">{selectedPO.nomor_po}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-gray-500">Vendor</dt>
                      <dd className="text-right font-medium text-gray-900">
                        {selectedPO.nama_supplier || "-"}
                      </dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-gray-500">Item</dt>
                      <dd className="text-right font-medium text-gray-900">
                        {fetchingPOItems ? "..." : poItems.length}
                      </dd>
                    </div>
                    {poItems.length > 0 && (
                      <div className="flex items-start justify-between gap-3 border-t border-gray-200/70 pt-3">
                        <dt className="font-medium text-gray-900">Estimasi Total</dt>
                        <dd className="text-right font-semibold text-gray-900">
                          {formatAmount(itemsSubtotal)}
                        </dd>
                      </div>
                    )}
                  </dl>
                ) : (
                  <p className="text-sm text-gray-500">
                    Pilih purchase order untuk melihat pratinjau detail pengiriman.
                  </p>
                )}

                <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
                    <Info className="h-4 w-4 text-pink-600" />
                    Panduan
                  </div>
                  <ul className="space-y-2 text-xs leading-5 text-gray-600">
                    {GUIDELINES.map((line) => (
                      <li key={line} className="flex gap-2">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-gray-200/70 pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="purchasing-secondary-button w-full sm:w-auto"
            onClick={() => router.push(DELIVERY_LIST)}
            disabled={loading}
          >
            Batal
          </Button>
          <Button
            type="submit"
            disabled={loading || !canSubmit}
            className="purchasing-main-button w-full sm:w-auto"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Menyimpan...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Simpan
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
