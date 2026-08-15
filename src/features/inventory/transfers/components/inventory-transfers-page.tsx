"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { PurchasingFormHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingTablePagination } from "@/modules/purchasing/components/pagination/PurchasingTablePagination";
import { RM_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { sortWarehouses } from "@/lib/configuration/sort-warehouses";
import { isMainStorageCode, isStallCode } from "@/lib/configuration/stall-labels";
import { createStockTransfer } from "../api";
import {
  useStockTransferList,
  useTransferSourceStock,
  useTransferWarehouses,
} from "../queries";
import {
  STOCK_TRANSFER_KIND_LABELS,
  type StockTransferKind,
  type WarehouseOption,
} from "../types";
import { toast } from "sonner";

const TRANSFER_KIND_OPTIONS: { value: StockTransferKind; label: string }[] = [
  { value: "main_to_stall", label: STOCK_TRANSFER_KIND_LABELS.main_to_stall },
  { value: "stall_to_stall", label: STOCK_TRANSFER_KIND_LABELS.stall_to_stall },
  { value: "stall_to_main", label: STOCK_TRANSFER_KIND_LABELS.stall_to_main },
];

type TransferLine = {
  key: string;
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  satuan: string | null;
  qty_available: number;
  qty_transfer_input: string;
};

function formatQty(value: number | null | undefined) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatDateTime(dateStr?: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function partitionWarehouses(warehouses: WarehouseOption[]) {
  const sorted = sortWarehouses(warehouses);
  const main =
    sorted.find((w) => isMainStorageCode(w.code) || w.is_default) ?? null;
  const stalls = sorted.filter((w) => isStallCode(w.code));
  return { main, stalls, sorted };
}

function toComboboxOptions(items: WarehouseOption[]) {
  return items.map((w) => ({
    value: w.id,
    label: w.name,
    description: w.code,
  }));
}

export function InventoryTransfersPage() {
  const [page, setPage] = useState(1);
  const [transferKind, setTransferKind] = useState<StockTransferKind>("main_to_stall");
  const [sourceWarehouseId, setSourceWarehouseId] = useState("");
  const [destWarehouseId, setDestWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const limit = 20;
  const warehousesQuery = useTransferWarehouses();
  const listQuery = useStockTransferList({ page, limit });
  const sourceStockQuery = useTransferSourceStock(sourceWarehouseId);
  const loading = !!sourceWarehouseId && sourceStockQuery.isLoading;

  const { main, stalls } = useMemo(
    () => partitionWarehouses(warehousesQuery.data || []),
    [warehousesQuery.data]
  );

  useEffect(() => {
    if (!main) return;

    if (transferKind === "main_to_stall") {
      setSourceWarehouseId(main.id);
      setDestWarehouseId("");
    } else if (transferKind === "stall_to_main") {
      setSourceWarehouseId("");
      setDestWarehouseId(main.id);
    } else {
      setSourceWarehouseId("");
      setDestWarehouseId("");
    }
    setQtyInputs({});
    setItemSearch("");
  }, [transferKind, main?.id]);

  useEffect(() => {
    setQtyInputs({});
    setItemSearch("");
  }, [sourceWarehouseId]);

  useEffect(() => {
    if (!sourceStockQuery.isError || !sourceWarehouseId) return;
    toast.error(
      sourceStockQuery.error instanceof Error
        ? sourceStockQuery.error.message
        : "Gagal memuat bahan baku"
    );
  }, [sourceStockQuery.isError, sourceStockQuery.error, sourceWarehouseId]);

  const sourceOptions = useMemo(() => {
    if (transferKind === "main_to_stall" && main) {
      return toComboboxOptions([main]);
    }
    if (transferKind === "stall_to_stall" || transferKind === "stall_to_main") {
      return toComboboxOptions(stalls);
    }
    return [];
  }, [transferKind, main, stalls]);

  const destOptions = useMemo(() => {
    if (transferKind === "stall_to_main" && main) {
      return toComboboxOptions([main]);
    }
    if (transferKind === "main_to_stall" || transferKind === "stall_to_stall") {
      const available = stalls.filter((stall) => stall.id !== sourceWarehouseId);
      return toComboboxOptions(available);
    }
    return [];
  }, [transferKind, main, stalls, sourceWarehouseId]);

  const selectedSource = sourceOptions.find((w) => w.value === sourceWarehouseId);

  const lines = useMemo<TransferLine[]>(() => {
    if (!sourceWarehouseId || !sourceStockQuery.data) return [];
    return sourceStockQuery.data.map((item) => ({
      key: item.raw_material_id,
      raw_material_id: item.raw_material_id,
      material_kode: item.material_kode,
      material_nama: item.material_nama,
      satuan: item.satuan_besar_nama ?? item.satuan ?? null,
      qty_available: item.qty_system,
      qty_transfer_input: qtyInputs[item.raw_material_id] ?? "",
    }));
  }, [sourceWarehouseId, sourceStockQuery.data, qtyInputs]);

  const filteredLines = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (line) =>
        line.material_nama.toLowerCase().includes(q) ||
        line.material_kode.toLowerCase().includes(q)
    );
  }, [lines, itemSearch]);

  const progress = useMemo(() => {
    const filled = lines.filter((line) => line.qty_transfer_input !== "").length;
    const toTransfer = lines.filter((line) => {
      if (line.qty_transfer_input === "") return false;
      const n = Number(line.qty_transfer_input);
      return Number.isFinite(n) && n > 0;
    }).length;
    return { filled, toTransfer, total: lines.length };
  }, [lines]);

  const hasItems = lines.length > 0;
  const canSubmit = hasItems && progress.toTransfer > 0;

  const historyItems = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = listQuery.data?.pagination.total_pages ?? 1;

  const handleKindChange = (kind: StockTransferKind) => {
    setTransferKind(kind);
  };

  const handleSourceChange = (value: string) => {
    setSourceWarehouseId(value);
    if (transferKind === "stall_to_stall" && value === destWarehouseId) {
      setDestWarehouseId("");
    }
  };

  const handleDestChange = (value: string) => {
    setDestWarehouseId(value);
  };

  const handleLineChange = (key: string, value: string) => {
    setQtyInputs((prev) => ({ ...prev, [key]: value }));
  };

  const resolveQty = (line: TransferLine): number | null => {
    if (line.qty_transfer_input === "") return null;
    const n = Number(line.qty_transfer_input);
    return Number.isFinite(n) ? n : null;
  };

  const validateInputs = () => {
    if (!sourceWarehouseId) {
      toast.error("Silakan pilih stall asal");
      return false;
    }
    if (!destWarehouseId) {
      toast.error("Silakan pilih stall tujuan");
      return false;
    }
    if (sourceWarehouseId === destWarehouseId) {
      toast.error("Stall asal dan stall tujuan harus berbeda");
      return false;
    }

    const toTransfer = lines.filter((line) => {
      const qty = resolveQty(line);
      return qty !== null && qty > 0;
    });

    if (toTransfer.length === 0) {
      toast.error("Isi qty transfer lebih dari nol untuk minimal satu bahan baku");
      return false;
    }

    const invalid = lines.find((line) => {
      if (line.qty_transfer_input === "") return false;
      const n = Number(line.qty_transfer_input);
      if (!Number.isFinite(n) || n < 0) return true;
      if (n > 0 && n > line.qty_available) return true;
      return false;
    });

    if (invalid) {
      if (Number(invalid.qty_transfer_input) > invalid.qty_available) {
        toast.error(
          `${invalid.material_kode}: qty melebihi stok tersedia (${formatQty(invalid.qty_available)})`
        );
      } else {
        toast.error("Qty transfer harus berupa angka valid yang lebih besar atau sama dengan nol");
      }
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateInputs()) return;

    const toTransfer = lines.filter((line) => {
      const qty = resolveQty(line);
      return qty !== null && qty > 0;
    });

    setSubmitting(true);
    const note = notes.trim() || undefined;
    let saved = 0;
    let failed = 0;
    const savedIds: string[] = [];

    try {
      for (const line of toTransfer) {
        const qty = resolveQty(line)!;
        try {
          await createStockTransfer({
            transfer_kind: transferKind,
            source_warehouse_id: sourceWarehouseId,
            dest_warehouse_id: destWarehouseId,
            raw_material_id: line.raw_material_id,
            qty,
            notes: note,
          });
          saved += 1;
          savedIds.push(line.raw_material_id);
        } catch {
          failed += 1;
        }
      }

      if (saved > 0) {
        setQtyInputs((prev) => {
          const next = { ...prev };
          for (const id of savedIds) {
            delete next[id];
          }
          return next;
        });
        await Promise.all([sourceStockQuery.refetch(), listQuery.refetch()]);
      }

      if (saved > 0 && failed === 0) {
        toast.success(`${saved} bahan baku berhasil ditransfer`);
      } else if (saved > 0) {
        toast.warning(`${saved} baris berhasil ditransfer, ${failed} gagal`);
      } else {
        toast.error("Gagal melakukan transfer stok");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const sourceDisabled =
    transferKind === "main_to_stall" || submitting || warehousesQuery.isLoading;
  const destDisabled =
    transferKind === "stall_to_main" || submitting || warehousesQuery.isLoading;

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={RM_ROUTES.inventoryStock}
        title="Transfer Stok"
        description="Pindahkan stok bahan baku antara Main Storage dan stall"
        actions={
          canSubmit ? (
            <Button
              type="button"
              className="purchasing-main-button"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? "Menyimpan..." : "Transfer Stok"}
            </Button>
          ) : undefined
        }
      />

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Informasi Transfer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Jenis Transfer</Label>
            <div className="flex flex-wrap gap-2">
              {TRANSFER_KIND_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={transferKind === option.value ? "default" : "outline"}
                  className={
                    transferKind === option.value
                      ? "purchasing-main-button"
                      : "purchasing-secondary-button"
                  }
                  onClick={() => handleKindChange(option.value)}
                  disabled={submitting}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="min-w-0 space-y-1.5 md:col-span-4">
              <Label className="text-xs">
                Stall Asal <span className="text-red-500">*</span>
              </Label>
              <Combobox
                value={sourceWarehouseId}
                onChange={handleSourceChange}
                options={sourceOptions}
                placeholder={
                  warehousesQuery.isLoading ? "Memuat stall..." : "Pilih stall asal"
                }
                disabled={sourceDisabled}
                className="w-full! h-9 border-gray-200/80 text-sm"
              />
            </div>

            <div className="min-w-0 space-y-1.5 md:col-span-4">
              <Label className="text-xs">
                Stall Tujuan <span className="text-red-500">*</span>
              </Label>
              <Combobox
                value={destWarehouseId}
                onChange={handleDestChange}
                options={destOptions}
                placeholder={
                  warehousesQuery.isLoading ? "Memuat stall..." : "Pilih stall tujuan"
                }
                disabled={destDisabled}
                className="w-full! h-9 border-gray-200/80 text-sm"
              />
            </div>

            <div className="min-w-0 space-y-1.5 md:col-span-4">
              <Label htmlFor="transfer-notes" className="text-xs">
                Catatan
              </Label>
              <Input
                id="transfer-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan transfer (opsional)..."
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
                <p className="text-xs font-medium text-gray-500">Terisi</p>
                <p className="text-lg font-bold text-amber-600">{progress.filled}</p>
              </div>
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-3 py-2">
                <p className="text-xs font-medium text-gray-500">Akan Ditransfer</p>
                <p className="text-lg font-bold text-pink-600">{progress.toTransfer}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-gray-200/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Item Transfer</h2>
              <p className="text-sm text-gray-500">
                {!sourceWarehouseId
                  ? "Pilih stall asal untuk memuat bahan baku"
                  : loading
                    ? "Memuat bahan baku..."
                    : hasItems
                      ? `Isi qty transfer (kosongkan untuk melewati)${
                          selectedSource ? ` — ${selectedSource.label}` : ""
                        }`
                      : "Tidak ada bahan baku aktif di stall ini"}
              </p>
            </div>
            {hasItems && (
              <div className="relative w-full sm:max-w-xs">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="Cari bahan baku..."
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
                  <th className="px-3 py-3">Nama Bahan Baku</th>
                  <th className="px-3 py-3">Satuan</th>
                  <th className="px-3 py-3 text-right">Stok Tersedia</th>
                  <th className="px-3 py-3 text-right">Qty Transfer</th>
                </tr>
              </thead>
              <tbody>
                {!sourceWarehouseId ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-gray-400">
                      Silakan pilih stall asal terlebih dahulu
                    </td>
                  </tr>
                ) : loading ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-gray-400">
                      Memuat item...
                    </td>
                  </tr>
                ) : sourceStockQuery.isError ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-red-500">
                      Gagal memuat bahan baku
                    </td>
                  </tr>
                ) : filteredLines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-gray-400">
                      {hasItems
                        ? "Tidak ada item yang cocok dengan pencarian"
                        : "Bahan baku aktif tidak ditemukan"}
                    </td>
                  </tr>
                ) : (
                  filteredLines.map((line) => {
                    const canTransfer = line.qty_available > 0;

                    return (
                      <tr
                        key={line.key}
                        className="border-b border-gray-200/70 hover:bg-gray-50/80"
                      >
                        <td className="px-3 py-3 font-mono text-xs text-gray-600">
                          {line.material_kode}
                        </td>
                        <td className="px-3 py-3 font-medium text-gray-900">
                          {line.material_nama}
                        </td>
                        <td className="px-3 py-3 text-gray-600">{line.satuan || "—"}</td>
                        <td
                          className={`px-3 py-3 text-right ${
                            canTransfer ? "text-gray-700" : "text-gray-400"
                          }`}
                        >
                          {formatQty(line.qty_available)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Input
                            type="number"
                            min={0}
                            max={line.qty_available}
                            step="any"
                            value={line.qty_transfer_input}
                            onChange={(e) => handleLineChange(line.key, e.target.value)}
                            placeholder="—"
                            disabled={submitting || !canTransfer}
                            className="ml-auto h-9 w-28 border-gray-200/80 text-right text-sm disabled:bg-gray-50/80"
                          />
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

      <PurchasingListSection
        icon={ArrowsRightLeftIcon}
        title="Riwayat Transfer"
        description={`${total} data transfer`}
        toolbar={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="purchasing-secondary-button"
            onClick={() => listQuery.refetch()}
            disabled={listQuery.isFetching}
          >
            <ArrowPathIcon
              className={`mr-2 h-4 w-4 ${listQuery.isFetching ? "animate-spin" : ""}`}
            />
            Muat Ulang
          </Button>
        }
      >
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-3 py-3">No. Transfer</th>
                <th className="px-3 py-3">Tanggal</th>
                <th className="px-3 py-3">Jenis</th>
                <th className="px-3 py-3">Bahan Baku</th>
                <th className="px-3 py-3 text-right">Qty</th>
                      <th className="px-3 py-3">Stall Asal</th>
                      <th className="px-3 py-3">Stall Tujuan</th>
                <th className="px-3 py-3">Dibuat Oleh</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-gray-400">
                    Memuat riwayat transfer...
                  </td>
                </tr>
              ) : historyItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-gray-400">
                    Belum ada transfer yang tercatat
                  </td>
                </tr>
              ) : (
                historyItems.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-gray-200/70 transition-colors hover:bg-gray-50/60"
                  >
                    <td className="px-3 py-3 font-mono text-xs text-gray-700">
                      {item.transfer_number}
                    </td>
                    <td className="px-3 py-3 text-gray-600">{formatDateTime(item.created_at)}</td>
                    <td className="px-3 py-3 text-gray-600">
                      {item.transfer_kind
                        ? STOCK_TRANSFER_KIND_LABELS[item.transfer_kind]
                        : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-gray-900">{item.material_nama}</p>
                      <p className="text-xs text-gray-500">{item.material_kode}</p>
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-gray-900">
                      {formatQty(item.qty)}
                    </td>
                    <td className="px-3 py-3 text-gray-600">{item.source_warehouse_name}</td>
                    <td className="px-3 py-3 text-gray-600">{item.dest_warehouse_name}</td>
                    <td className="px-3 py-3 text-gray-600">{item.created_by_name || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="border-t border-gray-200/70 px-4 py-4">
            <PurchasingTablePagination
              page={page}
              totalPages={totalPages}
              total={total}
              onPageChange={setPage}
            />
          </div>
        )}
      </PurchasingListSection>
    </div>
  );
}
