"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { DsDateTimePicker } from "@/components/design-system";
import { STALL_LABELS } from "@/lib/configuration/stall-labels";
import { PurchasingFormHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import {
  useProductStockOpname,
  useProductStockOpnamePreview,
  useProductStockOpnameWarehouses,
} from "../queries";
import {
  useCompleteProductStockOpname,
  useCreateProductStockOpname,
  useUpdateProductStockOpname,
} from "../mutations";
import { toast } from "sonner";

function formatQty(value: number | null | undefined) {
  return Number(value || 0).toLocaleString("id-ID", { maximumFractionDigits: 4 });
}

type CountLine = {
  key: string;
  lineId?: string;
  product_id: string;
  product_kode: string;
  product_nama: string;
  satuan: string | null;
  qty_system: number;
  qty_counted_input: string;
  // EPIC-047 Fase 3 — terisi saat baris ini mewakili satu SKU (produk
  // merchandise POS ber-varian); null/undefined = baris level produk lama.
  pos_sku_id?: string | null;
  pos_sku_code?: string | null;
  pos_sku_name?: string | null;
};

function buildLineKey(productId: string, posSkuId?: string | null) {
  return `${productId}::${posSkuId ?? ""}`;
}

interface ProductStockOpnameCreatePageProps {
  opnameId?: string;
}

export function ProductStockOpnameCreatePage({ opnameId }: ProductStockOpnameCreatePageProps) {
  const router = useRouter();
  const isContinue = Boolean(opnameId);

  const warehousesQuery = useProductStockOpnameWarehouses();
  const detailQuery = useProductStockOpname(opnameId || "");
  const createMutation = useCreateProductStockOpname();
  const updateMutation = useUpdateProductStockOpname();
  const completeMutation = useCompleteProductStockOpname();

  const [warehouseId, setWarehouseId] = useState("");
  const [opnameDate, setOpnameDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [lines, setLines] = useState<CountLine[]>([]);
  const [initialized, setInitialized] = useState(false);

  const previewQuery = useProductStockOpnamePreview(
    !isContinue && warehouseId ? warehouseId : ""
  );

  const detail = detailQuery.data;
  const warehouseOptions = (warehousesQuery.data || []).map((w) => ({
    value: w.id,
    label: w.name,
    description: w.code,
  }));
  const selectedWarehouse = warehouseOptions.find((w) => w.value === warehouseId);
  const isEditableContinue =
    isContinue && (detail?.status === "draft" || detail?.status === "in_progress");

  const isBusy =
    createMutation.isPending || updateMutation.isPending || completeMutation.isPending;

  useEffect(() => {
    if (!isContinue || !detail || initialized) return;

    if (detail.status === "completed" || detail.status === "cancelled") {
      router.replace(PRODUCT_ROUTES.inventoryOpnameDetail(detail.id));
      return;
    }

    setOpnameDate(detail.opname_date?.slice(0, 10) || opnameDate);
    setNotes(detail.notes || "");
    setWarehouseId(detail.warehouse_id || detail.warehouse?.id || "");
    setLines(
      (detail.lines || []).map((line) => ({
        key: line.id,
        lineId: line.id,
        product_id: line.product_id,
        product_kode: line.product_kode || "",
        product_nama: line.product_nama || "",
        satuan: line.satuan ?? null,
        qty_system: line.qty_system,
        qty_counted_input:
          line.qty_counted === null || line.qty_counted === undefined
            ? ""
            : String(line.qty_counted),
        pos_sku_id: line.pos_sku_id ?? null,
        pos_sku_code: line.pos_sku_code ?? null,
        pos_sku_name: line.pos_sku_name ?? null,
      }))
    );
    setInitialized(true);
  }, [isContinue, detail, initialized, router, opnameDate]);

  useEffect(() => {
    if (isContinue || previewQuery.isLoading) return;
    if (!warehouseId) {
      setLines([]);
      return;
    }

    const items = previewQuery.data ?? [];
    setLines(
      items.map((item) => ({
        key: buildLineKey(item.product_id, item.pos_sku_id),
        product_id: item.product_id,
        product_kode: item.product_kode,
        product_nama: item.product_nama,
        satuan: item.satuan,
        qty_system: item.qty_system,
        qty_counted_input: "",
        pos_sku_id: item.pos_sku_id ?? null,
        pos_sku_code: item.pos_sku_code ?? null,
        pos_sku_name: item.pos_sku_name ?? null,
      }))
    );
  }, [isContinue, warehouseId, previewQuery.data, previewQuery.isLoading]);

  const filteredLines = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (line) =>
        line.product_nama.toLowerCase().includes(q) ||
        line.product_kode.toLowerCase().includes(q)
    );
  }, [lines, itemSearch]);

  const progress = useMemo(() => {
    const counted = lines.filter((line) => line.qty_counted_input !== "").length;
    const variance = lines.filter((line) => {
      if (line.qty_counted_input === "") return false;
      const n = Number(line.qty_counted_input);
      return Number.isFinite(n) && n !== line.qty_system;
    }).length;
    return { counted, variance, total: lines.length };
  }, [lines]);

  const hasItems = lines.length > 0;
  const isPreviewLoading = !isContinue && previewQuery.isLoading;

  const handleLineChange = (key: string, value: string) => {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, qty_counted_input: value } : line))
    );
  };

  const handleFillSystem = () => {
    setLines((prev) =>
      prev.map((line) => ({
        ...line,
        qty_counted_input: String(line.qty_system),
      }))
    );
  };

  const resolveQty = (line: CountLine): number | null => {
    if (line.qty_counted_input === "") return null;
    const n = Number(line.qty_counted_input);
    return Number.isFinite(n) ? n : null;
  };

  const validateQtyInputs = (requireAll: boolean) => {
    if (requireAll) {
      const uncounted = lines.filter((line) => line.qty_counted_input === "");
      if (uncounted.length > 0) {
        toast.error(`${uncounted.length} baris belum dihitung`);
        return false;
      }
    }

    const invalid = lines.find((line) => {
      if (line.qty_counted_input === "") return false;
      const n = Number(line.qty_counted_input);
      return !Number.isFinite(n) || n < 0;
    });
    if (invalid) {
      toast.error("Qty fisik harus angka ≥ 0");
      return false;
    }
    return true;
  };

  const buildLineUpdates = (
    lineRecords: { id: string; product_id: string; pos_sku_id?: string | null }[]
  ) => {
    const byKey = new Map(
      lineRecords.map((l) => [buildLineKey(l.product_id, l.pos_sku_id), l.id])
    );
    return lines
      .filter((line) => line.qty_counted_input !== "")
      .map((line) => ({
        id: line.lineId || byKey.get(buildLineKey(line.product_id, line.pos_sku_id))!,
        qty_counted: resolveQty(line) ?? 0,
      }))
      .filter((line) => line.id);
  };

  const handleSaveDraft = async () => {
    if (!warehouseId) {
      toast.error("Pilih stall terlebih dahulu");
      return;
    }
    if (!hasItems) {
      toast.error("Tidak ada produk yang tersedia untuk stok opname");
      return;
    }
    if (!validateQtyInputs(false)) return;

    try {
      if (isContinue && opnameId) {
        await updateMutation.mutateAsync({
          id: opnameId,
          input: {
            notes: notes.trim() || undefined,
            lines: lines.map((line) => ({
              id: line.lineId!,
              qty_counted: resolveQty(line),
            })),
          },
        });
        toast.success("Draf stok opname produk berhasil disimpan");
        return;
      }

      const created = await createMutation.mutateAsync({
        warehouse_id: warehouseId,
        opname_date: opnameDate,
        notes: notes.trim() || undefined,
        reason: "stock_opname",
      });

      const updates = buildLineUpdates(
        (created.lines || []).map((l) => ({
          id: l.id,
          product_id: l.product_id,
          pos_sku_id: l.pos_sku_id,
        }))
      );

      if (updates.length > 0) {
        await updateMutation.mutateAsync({
          id: created.id,
          input: { lines: updates },
        });
      }

      toast.success("Draf stok opname produk berhasil disimpan");
      router.replace(PRODUCT_ROUTES.inventoryOpnameContinue(created.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan draf");
    }
  };

  const handleComplete = async () => {
    if (!warehouseId) {
      toast.error("Pilih stall terlebih dahulu");
      return;
    }
    if (!hasItems) {
      toast.error("Tidak ada produk yang tersedia untuk stok opname");
      return;
    }
    if (!validateQtyInputs(true)) return;

    try {
      let sessionId = opnameId;

      if (!sessionId) {
        const created = await createMutation.mutateAsync({
          warehouse_id: warehouseId,
          opname_date: opnameDate,
          notes: notes.trim() || undefined,
          reason: "stock_opname",
        });
        sessionId = created.id;

        await updateMutation.mutateAsync({
          id: sessionId,
          input: {
            lines: lines.map((line) => {
              const createdLine = created.lines?.find(
                (l) =>
                  l.product_id === line.product_id && (l.pos_sku_id ?? null) === (line.pos_sku_id ?? null)
              );
              if (!createdLine) {
                throw new Error(`Baris tidak ditemukan untuk ${line.product_kode}`);
              }
              return {
                id: createdLine.id,
                qty_counted: resolveQty(line) ?? 0,
              };
            }),
          },
        });
      } else {
        await updateMutation.mutateAsync({
          id: sessionId,
          input: {
            notes: notes.trim() || undefined,
            lines: lines.map((line) => ({
              id: line.lineId!,
              qty_counted: resolveQty(line) ?? 0,
            })),
          },
        });
      }

      await completeMutation.mutateAsync(sessionId);
      toast.success("Stok opname produk berhasil diselesaikan dan persediaan telah disesuaikan");
      router.push(PRODUCT_ROUTES.inventoryOpnameDetail(sessionId!));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal menyelesaikan stok opname"
      );
    }
  };

  const handleCancel = async () => {
    if (!opnameId || !window.confirm("Batalkan sesi stok opname ini?")) return;
    try {
      await updateMutation.mutateAsync({
        id: opnameId,
        input: { status: "cancelled" },
      });
      toast.success("Stok opname produk berhasil dibatalkan");
      router.push(PRODUCT_ROUTES.inventoryOpname);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membatalkan sesi");
    }
  };

  if (isContinue && detailQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
        Memuat sesi stok opname produk...
      </div>
    );
  }

  if (isContinue && !isEditableContinue && detail) {
    return null;
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.inventoryOpname}
        title={isContinue ? "Lanjutkan Stok Opname Produk" : "Buat Stok Opname Produk"}
        description="Masukkan qty fisik produk jadi, lalu simpan sebagai draf atau selesaikan opname"
        actions={
          hasItems ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="purchasing-secondary-button w-full sm:w-auto"
                onClick={handleFillSystem}
                disabled={isBusy}
              >
                Isi dengan Stok Sistem
              </Button>
              {isContinue && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-red-200/80 text-red-700 sm:w-auto"
                  onClick={handleCancel}
                  disabled={isBusy}
                >
                  Batalkan Sesi
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="purchasing-secondary-button w-full sm:w-auto"
                onClick={handleSaveDraft}
                disabled={isBusy}
              >
                {updateMutation.isPending && !completeMutation.isPending
                  ? "Menyimpan..."
                  : "Simpan Draf"}
              </Button>
              <Button
                type="button"
                className="purchasing-main-button w-full sm:w-auto"
                onClick={handleComplete}
                disabled={isBusy}
              >
                {completeMutation.isPending ? "Memproses..." : "Selesaikan Opname"}
              </Button>
            </>
          ) : undefined
        }
      />

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="border-b border-gray-200/70 pb-3">
          <CardTitle className="text-base">Informasi Opname</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="min-w-0 md:col-span-4">
              <Label className="text-xs">
                Stall <span className="text-red-500">*</span>
              </Label>
              <Combobox
                options={warehouseOptions}
                value={warehouseId}
                onChange={setWarehouseId}
                placeholder={
                  warehousesQuery.isLoading ? STALL_LABELS.loading : STALL_LABELS.selectPlaceholder
                }
                searchPlaceholder={STALL_LABELS.search}
                emptyMessage={STALL_LABELS.empty}
                disabled={isBusy || isContinue || warehousesQuery.isLoading}
                className="mt-1.5 h-9 text-sm"
              />
              {selectedWarehouse && (
                <p className="mt-1 text-xs text-gray-500">{selectedWarehouse.description}</p>
              )}
            </div>
            <div className="min-w-0 md:col-span-4">
              <DsDateTimePicker
                label="Tanggal Opname"
                value={opnameDate}
                onChange={setOpnameDate}
                placeholder="Pilih tanggal opname..."
                dateOnly
                disabled={isBusy}
              />
            </div>

            <div className="min-w-0 space-y-1.5 md:col-span-4">
              <Label htmlFor="notes" className="text-xs">
                Catatan
              </Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan tambahan (opsional)..."
                disabled={isBusy}
                className="h-9 border-gray-200/80 text-sm"
              />
            </div>
          </div>

          {hasItems && (
            <div className="grid grid-cols-3 gap-3 border-t border-gray-200/70 pt-4">
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-3 py-2">
                <p className="text-xs font-medium text-gray-500">Total Baris</p>
                <p className="text-lg font-bold text-gray-900">{progress.total}</p>
              </div>
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-3 py-2">
                <p className="text-xs font-medium text-gray-500">Terhitung</p>
                <p className="text-lg font-bold text-amber-600">{progress.counted}</p>
              </div>
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-3 py-2">
                <p className="text-xs font-medium text-gray-500">Ada Selisih</p>
                <p className="text-lg font-bold text-pink-600">{progress.variance}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-gray-200/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Perhitungan Stok Fisik</h2>
              <p className="text-sm text-gray-500">
                {isPreviewLoading
                  ? "Memuat produk..."
                  : hasItems
                    ? "Masukkan qty fisik dari hasil perhitungan produk"
                    : "Tidak ada produk aktif di stall ini"}
              </p>
            </div>
            {hasItems && (
              <div className="relative w-full sm:max-w-xs">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="Cari produk..."
                  className="h-10 border-gray-200/80 pl-9 text-sm"
                  disabled={isBusy}
                />
              </div>
            )}
          </div>

          <div className="overflow-x-auto px-4 pb-4">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Kode</th>
                  <th className="px-4 py-3 text-left font-semibold">Nama Produk</th>
                  <th className="px-4 py-3 text-left font-semibold">Satuan</th>
                  <th className="px-4 py-3 text-right font-semibold">Stok Sistem</th>
                  <th className="px-4 py-3 text-right font-semibold">Qty Fisik</th>
                  <th className="px-4 py-3 text-right font-semibold">Selisih</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isPreviewLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-pink-600" />
                      Memuat item...
                    </td>
                  </tr>
                ) : filteredLines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                      {hasItems ? "Data tidak ditemukan" : "Tidak ada produk aktif"}
                    </td>
                  </tr>
                ) : (
                  filteredLines.map((line) => {
                    const counted =
                      line.qty_counted_input === "" ? null : Number(line.qty_counted_input);
                    const variance =
                      counted === null || !Number.isFinite(counted)
                        ? null
                        : counted - line.qty_system;

                    return (
                      <tr key={line.key} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">
                          {line.product_kode}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {line.product_nama}
                          {line.pos_sku_id && (
                            <p className="mt-0.5 text-xs font-normal text-gray-400">
                              Varian: {line.pos_sku_code || "—"} — {line.pos_sku_name || "—"}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{line.satuan || "—"}</td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          {formatQty(line.qty_system)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={line.qty_counted_input}
                            onChange={(e) => handleLineChange(line.key, e.target.value)}
                            placeholder="—"
                            disabled={isBusy}
                            className="ml-auto h-9 w-28 border-gray-200/80 text-right text-sm"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {variance === null ? (
                            <span className="text-gray-400">—</span>
                          ) : variance === 0 ? (
                            <span className="text-emerald-600">0</span>
                          ) : variance > 0 ? (
                            <span className="font-medium text-emerald-600">
                              +{formatQty(variance)}
                            </span>
                          ) : (
                            <span className="font-medium text-red-600">{formatQty(variance)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
