"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { toast } from "sonner";

function formatQty(value: number | null | undefined) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(
    Number(value) || 0
  );
}

type AdjustLine = {
  key: string;
  product_id: string;
  product_kode: string;
  product_nama: string;
  satuan: string | null;
  qty_system: number;
  qty_actual_input: string;
};

export function ProductManualAdjustmentPage() {
  const [adjustDate, setAdjustDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [lines, setLines] = useState<AdjustLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch("/api/inventory/finished-goods?limit=500")
      .then((res) => res.json())
      .then((json) => {
        const rows = Array.isArray(json.data) ? json.data : [];
        setLines(
          rows.map((row: Record<string, unknown>) => ({
            key: String(row.product_id || row.id),
            product_id: String(row.product_id || row.id),
            product_kode: String(row.product_kode || ""),
            product_nama: String(row.product_nama || ""),
            satuan: (row.satuan_nama as string) || null,
            qty_system: Number(row.qty_available) || 0,
            qty_actual_input: "",
          }))
        );
      })
      .catch(() => toast.error("Gagal memuat daftar produk"))
      .finally(() => setLoading(false));
  }, []);

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
    const filled = lines.filter((line) => line.qty_actual_input !== "").length;
    const variance = lines.filter((line) => {
      if (line.qty_actual_input === "") return false;
      const n = Number(line.qty_actual_input);
      return Number.isFinite(n) && n !== line.qty_system;
    }).length;
    return { filled, variance, total: lines.length };
  }, [lines]);

  const hasItems = lines.length > 0;

  const handleLineChange = (key: string, value: string) => {
    setLines((prev) =>
      prev.map((line) =>
        line.key === key ? { ...line, qty_actual_input: value } : line
      )
    );
  };

  const handleFillSystem = () => {
    setLines((prev) =>
      prev.map((line) => ({
        ...line,
        qty_actual_input: String(line.qty_system),
      }))
    );
  };

  const resolveQty = (line: AdjustLine): number | null => {
    if (line.qty_actual_input === "") return null;
    const n = Number(line.qty_actual_input);
    return Number.isFinite(n) ? n : null;
  };

  const validateInputs = () => {
    const toSave = lines.filter((line) => line.qty_actual_input !== "");
    if (toSave.length === 0) {
      toast.error("Isi stok baru minimal pada satu produk");
      return false;
    }

    const invalid = lines.find((line) => {
      if (line.qty_actual_input === "") return false;
      const n = Number(line.qty_actual_input);
      return !Number.isFinite(n) || n < 0;
    });
    if (invalid) {
      toast.error("Stok baru harus berupa angka ≥ 0");
      return false;
    }

    const withVariance = toSave.filter((line) => resolveQty(line) !== line.qty_system);
    if (withVariance.length === 0) {
      toast.error("Tidak ada selisih stok untuk disimpan");
      return false;
    }

    return true;
  };

  const buildNote = () => {
    const base = notes.trim();
    const dateLabel = adjustDate
      ? `Penyesuaian ${adjustDate}`
      : "Penyesuaian stok";
    return base ? `${dateLabel}: ${base}` : dateLabel;
  };

  const handleSubmit = async () => {
    if (!validateInputs()) return;

    const toSave = lines.filter((line) => {
      const qty = resolveQty(line);
      return qty !== null && qty !== line.qty_system;
    });

    setSubmitting(true);
    const note = buildNote();
    let saved = 0;
    let failed = 0;

    try {
      for (const line of toSave) {
        const qty = resolveQty(line)!;
        try {
          const res = await fetch("/api/inventory/finished-goods/adjustment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              product_id: line.product_id,
              qty_actual: qty,
              notes: note,
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            throw new Error(json.message || "Gagal menyesuaikan stok");
          }
          saved += 1;
          setLines((prev) =>
            prev.map((row) =>
              row.key === line.key
                ? { ...row, qty_system: qty, qty_actual_input: "" }
                : row
            )
          );
        } catch {
          failed += 1;
        }
      }

      if (saved > 0 && failed === 0) {
        toast.success(`${saved} produk berhasil disesuaikan`);
      } else if (saved > 0) {
        toast.warning(`${saved} produk tersimpan, ${failed} gagal`);
      } else {
        toast.error("Gagal menyimpan penyesuaian stok");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Link href={PRODUCT_ROUTES.inventoryStock}>
            <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
              <ArrowLeftIcon className="h-4 w-4" />
              Kembali
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Stock Adjustment Produk</h1>
            <p className="text-sm text-gray-500">
              Koreksi stok manual per produk jadi
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
              disabled={submitting}
            >
              Isi = Stok Sistem
            </Button>
            <Button
              type="button"
              className="bg-pink-600 hover:bg-pink-700"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? "Menyimpan..." : "Simpan Penyesuaian"}
            </Button>
          </div>
        )}
      </div>

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Informasi Penyesuaian</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="min-w-0 space-y-1.5 md:col-span-4">
              <Label htmlFor="adjust_date" className="text-xs">
                Tanggal Penyesuaian
              </Label>
              <Input
                id="adjust_date"
                type="date"
                value={adjustDate}
                onChange={(e) => setAdjustDate(e.target.value)}
                disabled={submitting}
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
                placeholder="Alasan penyesuaian (opsional)..."
                disabled={submitting}
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
                <p className="text-xs font-medium text-gray-500">Sudah Diisi</p>
                <p className="text-lg font-bold text-amber-600">{progress.filled}</p>
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
              <h2 className="text-base font-semibold text-gray-900">Koreksi Stok</h2>
              <p className="text-sm text-gray-500">
                {loading
                  ? "Memuat daftar produk..."
                  : hasItems
                    ? "Masukkan stok baru untuk produk yang perlu dikoreksi"
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
                  disabled={submitting}
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
                  <th className="px-3 py-3 text-right">Stok Baru</th>
                  <th className="px-3 py-3 text-right">Selisih</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
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
                    const actual =
                      line.qty_actual_input === ""
                        ? null
                        : Number(line.qty_actual_input);
                    const variance =
                      actual === null || !Number.isFinite(actual)
                        ? null
                        : actual - line.qty_system;

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
                        <td className="px-3 py-3 text-gray-600">{line.satuan || "—"}</td>
                        <td className="px-3 py-3 text-right text-gray-700">
                          {formatQty(line.qty_system)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={line.qty_actual_input}
                            onChange={(e) => handleLineChange(line.key, e.target.value)}
                            placeholder="0"
                            disabled={submitting}
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
