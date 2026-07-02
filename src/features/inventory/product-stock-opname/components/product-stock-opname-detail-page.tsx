"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { useProductStockOpname } from "../queries";
import {
  PRODUCT_STOCK_OPNAME_STATUS_COLORS,
  PRODUCT_STOCK_OPNAME_STATUS_LABELS,
} from "../types";

function formatQty(value: number | null | undefined) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(
    Number(value) || 0
  );
}

interface ProductStockOpnameDetailPageProps {
  id: string;
}

export function ProductStockOpnameDetailPage({ id }: ProductStockOpnameDetailPageProps) {
  const detailQuery = useProductStockOpname(id);
  const [search, setSearch] = useState("");

  const detail = detailQuery.data;

  const filteredLines = useMemo(() => {
    const lines = detail?.lines ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (line) =>
        line.product_nama?.toLowerCase().includes(q) ||
        line.product_kode?.toLowerCase().includes(q)
    );
  }, [detail?.lines, search]);

  const progress = useMemo(() => {
    const lines = detail?.lines ?? [];
    const counted = lines.filter(
      (line) => line.qty_counted !== null && line.qty_counted !== undefined
    ).length;
    const variance = lines.filter(
      (line) =>
        line.qty_variance !== null &&
        line.qty_variance !== undefined &&
        line.qty_variance !== 0
    ).length;
    return { counted, variance, total: lines.length };
  }, [detail?.lines]);

  if (detailQuery.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-gray-400">
        Memuat riwayat stock opname produk...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-gray-500">Stock opname produk tidak ditemukan</p>
        <Link href={PRODUCT_ROUTES.inventoryOpname}>
          <Button variant="outline">Kembali</Button>
        </Link>
      </div>
    );
  }

  const canContinue =
    detail.status === "draft" || detail.status === "in_progress";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <Link href={PRODUCT_ROUTES.inventoryOpname}>
            <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
              <ArrowLeftIcon className="h-4 w-4" />
              Kembali
            </Button>
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{detail.opname_number}</h1>
            <Badge
              variant="outline"
              className={PRODUCT_STOCK_OPNAME_STATUS_COLORS[detail.status]}
            >
              {PRODUCT_STOCK_OPNAME_STATUS_LABELS[detail.status]}
            </Badge>
          </div>
          <p className="text-sm text-gray-500">
            Riwayat stock opname produk ·{" "}
            {format(new Date(detail.opname_date), "d MMMM yyyy", { locale: localeId })}
            {detail.notes ? ` · ${detail.notes}` : ""}
          </p>
        </div>

        {canContinue && (
          <Link href={PRODUCT_ROUTES.inventoryOpnameContinue(detail.id)}>
            <Button className="bg-pink-600 hover:bg-pink-700">
              Lanjutkan Hitung
            </Button>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Total Baris</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{progress.total}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Sudah Dihitung</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{progress.counted}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Ada Selisih</p>
            <p className="mt-1 text-2xl font-bold text-pink-600">{progress.variance}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Status</p>
            <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-gray-800">
              {detail.status === "completed" && (
                <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
              )}
              {PRODUCT_STOCK_OPNAME_STATUS_LABELS[detail.status]}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-gray-200/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Daftar Produk</h2>
              <p className="text-sm text-gray-500">
                Hasil penghitungan fisik stok (hanya baca)
              </p>
            </div>
            <div className="relative w-full sm:max-w-xs">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari produk..."
                className="h-10 border-gray-200/80 pl-9"
              />
            </div>
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
                {filteredLines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-gray-400">
                      Tidak ada baris
                    </td>
                  </tr>
                ) : (
                  filteredLines.map((line) => (
                    <tr
                      key={line.id}
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
                      <td className="px-3 py-3 text-right text-gray-900">
                        {line.qty_counted === null || line.qty_counted === undefined
                          ? "—"
                          : formatQty(line.qty_counted)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right font-medium ${
                          line.qty_variance === null || line.qty_variance === undefined
                            ? "text-gray-400"
                            : line.qty_variance === 0
                              ? "text-gray-600"
                              : line.qty_variance > 0
                                ? "text-emerald-600"
                                : "text-red-600"
                        }`}
                      >
                        {line.qty_variance === null || line.qty_variance === undefined
                          ? "—"
                          : formatQty(line.qty_variance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
