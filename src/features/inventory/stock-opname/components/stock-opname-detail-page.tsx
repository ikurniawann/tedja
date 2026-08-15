"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircleIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PurchasingFormHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import {
  toDisplayQty,
  type RawMaterialUnitInfo,
  type RawMaterialUnitMode,
} from "@/lib/inventory/raw-material-units";
import { RM_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { useStockOpname } from "../queries";
import {
  STOCK_OPNAME_STATUS_COLORS,
  STOCK_OPNAME_STATUS_LABELS,
  type StockOpnameLine,
} from "../types";
import { RawMaterialUnitSelect } from "./raw-material-unit-select";

function formatQty(value: number | null | undefined) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(dateStr?: string | null) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function lineUnitInfo(line: StockOpnameLine): RawMaterialUnitInfo {
  return {
    satuan: line.satuan,
    satuan_besar_nama: line.satuan_besar_nama ?? line.satuan,
    satuan_kecil_nama: line.satuan_kecil_nama,
    konversi_factor: line.konversi_factor,
  };
}

interface StockOpnameDetailPageProps {
  id: string;
}

export function StockOpnameDetailPage({ id }: StockOpnameDetailPageProps) {
  const detailQuery = useStockOpname(id);
  const [search, setSearch] = useState("");
  const [viewUnitByLine, setViewUnitByLine] = useState<
    Record<string, RawMaterialUnitMode>
  >({});

  const detail = detailQuery.data;

  useEffect(() => {
    if (!detail?.lines?.length) return;
    setViewUnitByLine((prev) => {
      const next = { ...prev };
      for (const line of detail.lines) {
        if (!next[line.id]) next[line.id] = "besar";
      }
      return next;
    });
  }, [detail?.lines]);

  const filteredLines = useMemo(() => {
    const lines = detail?.lines ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (line) =>
        line.material_nama?.toLowerCase().includes(q) ||
        line.material_kode?.toLowerCase().includes(q)
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
        Memuat riwayat stok opname...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-gray-500">Stok opname tidak ditemukan</p>
        <Link href={RM_ROUTES.inventoryOpname}>
          <Button variant="outline">Kembali</Button>
        </Link>
      </div>
    );
  }

  const canContinue =
    detail.status === "draft" || detail.status === "in_progress";

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={RM_ROUTES.inventoryOpname}
        title={detail.opname_number}
        description={`Riwayat stok opname · ${detail.warehouse?.name || "—"} · ${formatDate(detail.opname_date)}`}
        actions={
          canContinue ? (
            <Link href={RM_ROUTES.inventoryOpnameContinue(detail.id)}>
              <Button className="purchasing-main-button w-full sm:w-auto">
                Lanjutkan Perhitungan
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={STOCK_OPNAME_STATUS_COLORS[detail.status]}
        >
          {STOCK_OPNAME_STATUS_LABELS[detail.status]}
        </Badge>
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
            <p className="text-xs font-medium text-gray-500">Terhitung</p>
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
              {STOCK_OPNAME_STATUS_LABELS[detail.status]}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-gray-200/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Baris Bahan Baku</h2>
              <p className="text-sm text-gray-500">
                Hasil perhitungan stok fisik (hanya baca)
              </p>
            </div>
            <div className="relative w-full sm:max-w-xs">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari bahan baku..."
                className="h-10 border-gray-200/80 pl-9"
              />
            </div>
          </div>

          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-3">Kode</th>
                  <th className="px-3 py-3">Nama Bahan Baku</th>
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
                      Data tidak ditemukan
                    </td>
                  </tr>
                ) : (
                  filteredLines.map((line) => {
                    const unit = lineUnitInfo(line);
                    const viewMode = viewUnitByLine[line.id] ?? "besar";
                    const displaySystem = toDisplayQty(line.qty_system, viewMode, unit);
                    const displayCounted =
                      line.qty_counted === null || line.qty_counted === undefined
                        ? null
                        : toDisplayQty(line.qty_counted, viewMode, unit);
                    const variance =
                      displayCounted === null
                        ? null
                        : line.qty_variance !== null && line.qty_variance !== undefined
                          ? toDisplayQty(line.qty_variance, viewMode, unit)
                          : displayCounted - displaySystem;

                    return (
                      <tr
                        key={line.id}
                        className="border-b border-gray-200/70 hover:bg-gray-50/80"
                      >
                        <td className="px-3 py-3 font-mono text-xs text-gray-600">
                          {line.material_kode}
                        </td>
                        <td className="px-3 py-3 font-medium text-gray-900">
                          {line.material_nama}
                        </td>
                        <td className="px-3 py-3">
                          <RawMaterialUnitSelect
                            info={unit}
                            value={viewMode}
                            onChange={(mode) =>
                              setViewUnitByLine((prev) => ({
                                ...prev,
                                [line.id]: mode,
                              }))
                            }
                          />
                        </td>
                        <td className="px-3 py-3 text-right text-gray-700">
                          {formatQty(displaySystem)}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-700">
                          {displayCounted === null ? "—" : formatQty(displayCounted)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {variance === null ? (
                            <span className="text-gray-400">—</span>
                          ) : variance === 0 ? (
                            <span className="text-emerald-600">0</span>
                          ) : variance > 0 ? (
                            <span className="font-medium text-emerald-600">
                              +{formatQty(variance)}
                            </span>
                          ) : (
                            <span className="font-medium text-red-600">
                              {formatQty(variance)}
                            </span>
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

      {detail.notes && (
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Catatan</p>
            <p className="mt-1 text-sm text-gray-700">{detail.notes}</p>
          </CardContent>
        </Card>
      )}

      {detail.status === "completed" && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircleIcon className="h-5 w-5 shrink-0" />
          Stok opname selesai
          {detail.completed_at
            ? ` pada ${formatDateTime(detail.completed_at)}`
            : ""}
          . Selisih stok telah diposting ke persediaan.
        </div>
      )}

      {detail.status === "cancelled" && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-800">
          <XMarkIcon className="h-5 w-5 shrink-0" />
          Sesi stok opname ini telah dibatalkan.
        </div>
      )}

      {canContinue && (
        <div className="rounded-lg border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Sesi ini masih berstatus draf. Gunakan tombol{" "}
          <span className="font-medium">Lanjutkan Perhitungan</span> untuk melanjutkan
          perhitungan di halaman opname.
        </div>
      )}
    </div>
  );
}
