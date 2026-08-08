"use client";

import { useState, useEffect, useMemo, useRef } from "react";
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
import {
  TruckIcon,
  ArrowLeftIcon,
  SaveIcon,
  Loader2Icon,
  Package,
  Info,
} from "lucide-react";
import { useDeliveryPOOptions, usePOItemsForDelivery } from "../queries";
import { useCreateDelivery } from "../mutations";
import { formatCurrency, formatQuantity } from "../utils";
import type { PurchaseOrderItem } from "@/types/purchasing";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const GUIDELINES = [
  "Pilih purchase order yang sudah disetujui, dikirim, atau diterima sebagian.",
  "Purchase order yang pengirimannya sudah selesai tetap bisa menerima pengiriman tambahan.",
  "Purchase order yang masih memiliki pengiriman berjalan disembunyikan dari daftar ini.",
  "Nomor surat jalan, tanggal kirim, dan estimasi tanggal tiba wajib diisi.",
  "Status awal adalah menunggu penerimaan.",
];

const RESHIP_GUIDELINES = [
  "Pengiriman ini untuk sisa qty PO yang belum diterima (lolos QC).",
  "Kolom Sisa = qty yang diharapkan datang pada pengiriman ulang ini.",
  "Setelah barang tiba, buat GRN baru dari surat jalan pengiriman ulang.",
  "Nomor surat jalan, tanggal kirim, dan estimasi tanggal tiba wajib diisi.",
];

function getItemRemainingQty(item: PurchaseOrderItem) {
  return Math.max(0, Number(item.qty_ordered || 0) - Number(item.qty_received || 0));
}

export function CreateDeliveryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [formData, setFormData] = useState({
    po_id: "",
    supplier_id: "",
    no_surat_jalan: "",
    kurir: "",
    no_resi: "",
    tanggal_kirim: new Date().toISOString().split("T")[0],
    tanggal_estimasi_tiba: "",
    catatan: "",
  });

  const poOptionsQuery = useDeliveryPOOptions(false);
  const fetchingPOs = poOptionsQuery.isLoading;
  const poList = poOptionsQuery.data ?? [];

  const createMutation = useCreateDelivery();
  const loading = createMutation.isPending;

  const presetPoId = searchParams.get("po_id");
  const presetHandledRef = useRef(false);
  const [presetRejected, setPresetRejected] = useState(false);

  useEffect(() => {
    if (!presetPoId || presetHandledRef.current || !poOptionsQuery.isSuccess) return;
    presetHandledRef.current = true;

    const po = poList.find((p) => p.id === presetPoId);
    if (!po) {
      setPresetRejected(true);
      toast.error("Purchase order ini sudah memiliki pengiriman atau tidak memenuhi syarat.");
      return;
    }

    setFormData((prev) => ({ ...prev, po_id: po.id, supplier_id: po.supplier_id || "" }));
  }, [presetPoId, poList, poOptionsQuery.isSuccess]);

  // PO dikunci saat halaman dibuka dari detail PO — pengiriman harus tetap
  // melekat pada PO asal. Kalau preset gagal di-resolve, dropdown dibuka lagi
  // supaya pengguna tidak terjebak pada form yang mati.
  const poLocked = Boolean(presetPoId) && !presetRejected && formData.po_id === presetPoId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.po_id || !formData.no_surat_jalan) {
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
      router.push(data.id ? `/dashboard/purchasing/delivery/${data.id}` : "/dashboard/purchasing/delivery");
      router.refresh();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Gagal membuat pengiriman."));
    }
  }

  const selectedPO = poList.find((po) => po.id === formData.po_id);

  const poItemsQuery = usePOItemsForDelivery(formData.po_id);
  const poItems: PurchaseOrderItem[] = poItemsQuery.data ?? [];
  const fetchingPOItems = poItemsQuery.isLoading;

  const itemsSubtotal = useMemo(
    () => poItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0),
    [poItems]
  );

  const remainingSummary = useMemo(() => {
    const totalOrdered = poItems.reduce((sum, item) => sum + Number(item.qty_ordered || 0), 0);
    const totalReceived = poItems.reduce((sum, item) => sum + Number(item.qty_received || 0), 0);
    const totalRemaining = poItems.reduce((sum, item) => sum + getItemRemainingQty(item), 0);
    const itemsWithRemaining = poItems.filter((item) => getItemRemainingQty(item) > 0).length;
    return { totalOrdered, totalReceived, totalRemaining, itemsWithRemaining };
  }, [poItems]);

  const isReship =
    remainingSummary.totalReceived > 0 && remainingSummary.totalRemaining > 0;

  const canSubmit =
    Boolean(formData.po_id) &&
    Boolean(formData.no_surat_jalan.trim()) &&
    Boolean(formData.tanggal_kirim) &&
    Boolean(formData.tanggal_estimasi_tiba);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Link href="/dashboard/purchasing/delivery">
            <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
              <ArrowLeftIcon className="h-4 w-4" />
              Kembali
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {isReship ? "Kirim Ulang — Sisa PO" : "Tambah Pengiriman"}
            </h1>
            <p className="text-sm text-gray-500">
              {isReship
                ? "Catat pengiriman ulang supplier untuk qty yang belum diterima"
                : "Catat pengiriman dari supplier berdasarkan purchase order"}
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
                  <TruckIcon className="h-4 w-4" />
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
                        supplier_id: po?.supplier_id || "",
                      }));
                    }}
                    placeholder={fetchingPOs ? "Memuat purchase order..." : "Pilih purchase order"}
                    searchPlaceholder="Cari purchase order atau supplier..."
                    emptyMessage="Tidak ada purchase order yang memenuhi syarat"
                    allowClear={!poLocked}
                    disabled={fetchingPOs || poLocked}
                    className="w-full! h-9 text-sm"
                  />
                  {poLocked && (
                    <p className="text-xs text-muted-foreground">
                      Purchase order dikunci karena halaman ini dibuka dari detail PO.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="no_surat_jalan" className="text-xs">
                      Nomor Surat Jalan <span className="text-red-500">*</span>
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
                      Nomor Resi
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
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, kurir: e.target.value }))
                    }
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
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, catatan: e.target.value }))
                    }
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
                    {isReship ? "Item yang dikirim ulang (sisa)" : "Item Purchase Order"}
                  </CardTitle>
                  {isReship && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Qty di kolom Sisa adalah yang belum diterima — ini target pengiriman ulang.
                    </p>
                  )}
                </CardHeader>
                <CardContent className="p-0">
                  {fetchingPOItems ? (
                    <div className="flex items-center justify-center py-10 text-sm text-gray-500">
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                      Memuat item purchase order...
                    </div>
                  ) : poItemsQuery.isError ? (
                    <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-gray-500">
                      <span>
                        {getErrorMessage(poItemsQuery.error, "Gagal memuat item purchase order.")}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="purchasing-secondary-button"
                        disabled={poItemsQuery.isFetching}
                        onClick={() => poItemsQuery.refetch()}
                      >
                        {poItemsQuery.isFetching && (
                          <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Coba lagi
                      </Button>
                    </div>
                  ) : poItems.length === 0 ? (
                    <div className="py-10 text-center text-sm text-gray-500">
                      Tidak ada item untuk purchase order ini
                    </div>
                  ) : (
                    <div className="overflow-x-auto px-4 pb-4">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200/70 text-xs uppercase tracking-wide text-gray-500">
                            <th className="py-3 pr-4 text-left font-semibold">Bahan Baku</th>
                            <th className="px-3 py-3 text-right font-semibold">Dipesan</th>
                            <th className="px-3 py-3 text-right font-semibold">Diterima</th>
                            <th className="px-3 py-3 text-right font-semibold">Sisa</th>
                            <th className="px-3 py-3 text-left font-semibold">Satuan</th>
                            <th className="px-3 py-3 text-right font-semibold">Harga Satuan</th>
                            <th className="py-3 pl-3 text-right font-semibold">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200/70">
                          {poItems.map((item) => {
                            const remaining = getItemRemainingQty(item);
                            const isRemainingRow = remaining > 0;
                            return (
                              <tr
                                key={item.id}
                                className={
                                  isReship && !isRemainingRow
                                    ? "bg-gray-50/60 text-gray-400"
                                    : "hover:bg-gray-50/80"
                                }
                              >
                                <td className="py-3 pr-4">
                                  <div
                                    className={`font-medium ${
                                      isReship && !isRemainingRow ? "text-gray-400" : "text-gray-900"
                                    }`}
                                  >
                                    {item.raw_material?.nama}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {item.raw_material?.kode}
                                  </div>
                                </td>
                                <td className="px-3 py-3 text-right text-gray-700">
                                  {formatQuantity(item.qty_ordered)}
                                </td>
                                <td className="px-3 py-3 text-right text-gray-700">
                                  {formatQuantity(item.qty_received || 0)}
                                </td>
                                <td
                                  className={`px-3 py-3 text-right font-semibold ${
                                    isRemainingRow ? "text-primary" : "text-gray-400"
                                  }`}
                                >
                                  {formatQuantity(remaining)}
                                  {isReship && isRemainingRow && (
                                    <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wide text-primary/80">
                                      Kirim ulang
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-3 text-gray-700">
                                  {item.satuan?.nama ||
                                    item.raw_material?.satuan_besar?.nama ||
                                    item.raw_material?.satuan ||
                                    "-"}
                                </td>
                                <td className="px-3 py-3 text-right text-gray-700">
                                  {formatCurrency(item.harga_satuan)}
                                </td>
                                <td className="py-3 pl-3 text-right font-medium text-gray-900">
                                  {formatCurrency(item.subtotal)}
                                </td>
                              </tr>
                            );
                          })}
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
                      <dt className="text-gray-500">Supplier</dt>
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
                    {isReship && (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <dt className="text-gray-500">Sudah diterima</dt>
                          <dd className="text-right font-medium text-gray-900">
                            {formatQuantity(remainingSummary.totalReceived)}
                          </dd>
                        </div>
                        <div className="flex items-start justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                          <dt className="font-medium text-primary">Sisa dikirim ulang</dt>
                          <dd className="text-right font-semibold text-primary">
                            {formatQuantity(remainingSummary.totalRemaining)}
                            <span className="mt-0.5 block text-xs font-normal text-primary/80">
                              {remainingSummary.itemsWithRemaining} item
                            </span>
                          </dd>
                        </div>
                      </>
                    )}
                    {poItems.length > 0 && (
                      <div className="flex items-start justify-between gap-3 border-t border-gray-200/70 pt-3">
                        <dt className="font-medium text-gray-900">Estimasi Total</dt>
                        <dd className="text-right font-semibold text-gray-900">
                          {formatCurrency(itemsSubtotal)}
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
                    {(isReship ? RESHIP_GUIDELINES : GUIDELINES).map((line) => (
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
            onClick={() => router.push("/dashboard/purchasing/delivery")}
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
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                Menyimpan...
              </>
            ) : (
              <>
                <SaveIcon className="mr-2 h-4 w-4" />
                {isReship ? "Simpan Kirim Ulang" : "Simpan"}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
