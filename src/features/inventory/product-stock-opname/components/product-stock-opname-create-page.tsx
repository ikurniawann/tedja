"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import {
  useProductStockOpname,
  useProductStockOpnamePreview,
} from "../queries";
import {
  useCompleteProductStockOpname,
  useCreateProductStockOpname,
  useUpdateProductStockOpname,
} from "../mutations";
import { toast } from "sonner";

function formatQty(value: number | null | undefined) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(
    Number(value) || 0
  );
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
};

interface ProductStockOpnameCreatePageProps {
  opnameId?: string;
}

export function ProductStockOpnameCreatePage({ opnameId }: ProductStockOpnameCreatePageProps) {
  const router = useRouter();
  const isContinue = Boolean(opnameId);

  const detailQuery = useProductStockOpname(opnameId || "");
  const createMutation = useCreateProductStockOpname();
  const updateMutation = useUpdateProductStockOpname();
  const completeMutation = useCompleteProductStockOpname();

  const [opnameDate, setOpnameDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [lines, setLines] = useState<CountLine[]>([]);
  const [initialized, setInitialized] = useState(false);

  const previewQuery = useProductStockOpnamePreview(!isContinue);

  const detail = detailQuery.data;
  const isEditableContinue =
    isContinue &&
    (detail?.status === "draft" || detail?.status === "in_progress");

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
      }))
    );
    setInitialized(true);
  }, [isContinue, detail, initialized, router, opnameDate]);

  useEffect(() => {
    if (isContinue || previewQuery.isLoading) return;

    const items = previewQuery.data ?? [];
    setLines(
      items.map((item) => ({
        key: item.product_id,
        product_id: item.product_id,
        product_kode: item.product_kode,
        product_nama: item.product_nama,
        satuan: item.satuan,
        qty_system: item.qty_system,
        qty_counted_input: "",
      }))
    );
  }, [isContinue, previewQuery.data, previewQuery.isLoading]);

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
      prev.map((line) =>
        line.key === key ? { ...line, qty_counted_input: value } : line
      )
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
        toast.error(`Masih ada ${uncounted.length} baris yang belum dihitung`);
        return false;
      }
    }

    const invalid = lines.find((line) => {
      if (line.qty_counted_input === "") return false;
      const n = Number(line.qty_counted_input);
      return !Number.isFinite(n) || n < 0;
    });
    if (invalid) {
      toast.error("Qty fisik harus berupa angka ≥ 0");
      return false;
    }
    return true;
  };

  const buildLineUpdates = (lineRecords: { id: string; product_id: string }[]) => {
    const byProduct = new Map(lineRecords.map((l) => [l.product_id, l.id]));
    return lines
      .filter((line) => line.qty_counted_input !== "")
      .map((line) => ({
        id: line.lineId || byProduct.get(line.product_id)!,
        qty_counted: resolveQty(line) ?? 0,
      }))
      .filter((line) => line.id);
  };

  const handleSaveDraft = async () => {
    if (!hasItems) {
      toast.error("Tidak ada produk untuk diopname");
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
        toast.success("Draft stock opname produk disimpan");
        return;
      }

      const created = await createMutation.mutateAsync({
        opname_date: opnameDate,
        notes: notes.trim() || undefined,
        reason: "stock_opname",
      });

      const updates = buildLineUpdates(
        (created.lines || []).map((l) => ({
          id: l.id,
          product_id: l.product_id,
        }))
      );

      if (updates.length > 0) {
        await updateMutation.mutateAsync({
          id: created.id,
          input: { lines: updates },
        });
      }

      toast.success("Draft stock opname produk disimpan");
      router.replace(PRODUCT_ROUTES.inventoryOpnameContinue(created.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan draft");
    }
  };

  const handleComplete = async () => {
    if (!hasItems) {
      toast.error("Tidak ada produk untuk diopname");
      return;
    }
    if (!validateQtyInputs(true)) return;

    try {
      let sessionId = opnameId;

      if (!sessionId) {
        const created = await createMutation.mutateAsync({
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
                (l) => l.product_id === line.product_id
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
      toast.success("Stock opname produk selesai dan stok telah disesuaikan");
      router.push(PRODUCT_ROUTES.inventoryOpnameDetail(sessionId!));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Gagal menyelesaikan stock opname"
      );
    }
  };

  const handleCancel = async () => {
    if (!opnameId || !window.confirm("Batalkan sesi stock opname ini?")) return;
    try {
      await updateMutation.mutateAsync({
        id: opnameId,
        input: { status: "cancelled" },
      });
      toast.success("Stock opname produk dibatalkan");
      router.push(PRODUCT_ROUTES.inventoryOpname);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membatalkan");
    }
  };

  if (isContinue && detailQuery.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-gray-400">
        Memuat sesi stock opname produk...
      </div>
    );
  }

  if (isContinue && !isEditableContinue && detail) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Link href={PRODUCT_ROUTES.inventoryOpname}>
            <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
              <ArrowLeftIcon className="h-4 w-4" />
              Kembali
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {isContinue ? "Lanjutkan Stock Opname Produk" : "Buat Stock Opname Produk"}
            </h1>
            <p className="text-sm text-gray-500">
              Hitung qty fisik produk jadi, lalu simpan draft atau selesaikan opname
            </p>
          </div>
        </div>

        {hasItems && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="border-gray-200/80"
              onClick={handleFillSystem}
              disabled={isBusy}
            >
              Isi = Stok Sistem
            </Button>
            {isContinue && (
              <Button
                type="button"
                variant="outline"
                className="border-red-200/80 text-red-700"
                onClick={handleCancel}
                disabled={isBusy}
              >
                Batalkan
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="border-gray-200/80"
              onClick={handleSaveDraft}
              disabled={isBusy}
            >
              {updateMutation.isPending && !completeMutation.isPending
                ? "Menyimpan..."
                : "Simpan Draft"}
            </Button>
            <Button
              type="button"
              className="bg-pink-600 hover:bg-pink-700"
              onClick={handleComplete}
              disabled={isBusy}
            >
              {completeMutation.isPending ? "Memproses..." : "Selesaikan Opname"}
            </Button>
          </div>
        )}
      </div>

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Informasi Opname</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="min-w-0 space-y-1.5 md:col-span-4">
              <Label htmlFor="opname_date" className="text-xs">
                Tanggal Opname
              </Label>
              <Input
                id="opname_date"
                type="date"
                value={opnameDate}
                onChange={(e) => setOpnameDate(e.target.value)}
                disabled={isBusy}
                className="h-9 border-gray-200/80 text-sm"
              />
            </div>

            <div className="min-w-0 space-y-1.5 md:col-span-8">
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
                <p className="text-xs font-medium text-gray-500">Sudah Dihitung</p>
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
              <h2 className="text-base font-semibold text-gray-900">Hitung Stok Fisik</h2>
              <p className="text-sm text-gray-500">
                {isPreviewLoading
                  ? "Memuat daftar produk..."
                  : hasItems
                    ? "Masukkan qty fisik hasil penghitungan"
                    : "Tidak ada produk aktif dalam scope ini"}
              </p>
            </div>
            {hasItems && (
              <div className="relative w-full sm:max-w-xs">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="Cari produk..."
                  className="h-10 border-gray-200/80 pl-9"
                  disabled={isBusy}
                />
              </div>
            )}
          </div>

          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-3">Kode</th>
                  <th className="px-3 py-3">Nama Produk</th>
                  <th className="px-3 py-3">Satuan</th>
                  <th className="px-3 py-3 text-right">Stok Sistem</th>
                  <th className="px-3 py-3 text-right">Qty Fisik</th>
                  <th className="px-3 py-3 text-right">Selisih</th>
                </tr>
              </thead>
              <tbody>
                {isPreviewLoading ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-gray-400">
                      Memuat item...
                    </td>
                  </tr>
                ) : filteredLines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-gray-400">
                      {hasItems
                        ? "Tidak ada item yang cocok dengan pencarian"
                        : "Tidak ada produk aktif"}
                    </td>
                  </tr>
                ) : (
                  filteredLines.map((line) => {
                    const counted =
                      line.qty_counted_input === ""
                        ? null
                        : Number(line.qty_counted_input);
                    const variance =
                      counted === null || !Number.isFinite(counted)
                        ? null
                        : counted - line.qty_system;

                    return (
                      <tr
                        key={line.key}
                        className="border-b border-gray-200/70 hover:bg-gray-50/80"
                      >
                        <td className="px-3 py-3 font-mono text-xs text-gray-600">
                          {line.product_kode}
                        </td>
                        <td className="px-3 py-3 font-medium text-gray-900">
                          {line.product_nama}
                        </td>
                        <td className="px-3 py-3 text-gray-600">
                          {line.satuan || "—"}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-700">
                          {formatQty(line.qty_system)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={line.qty_counted_input}
                            onChange={(e) => handleLineChange(line.key, e.target.value)}
                            placeholder="0"
                            disabled={isBusy}
                            className="ml-auto h-9 w-28 border-gray-200/80 text-right text-sm"
                          />
                        </td>
                        <td
                          className={`px-3 py-3 text-right font-medium ${
                            variance === null
                              ? "text-gray-400"
                              : variance === 0
                                ? "text-gray-600"
                                : variance > 0
                                  ? "text-emerald-600"
                                  : "text-red-600"
                          }`}
                        >
                          {variance === null ? "—" : formatQty(variance)}
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
