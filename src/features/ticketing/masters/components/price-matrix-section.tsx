"use client";

import { useEffect, useMemo, useState } from "react";
import { CurrencyDollarIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import {
  useChannels,
  usePriceMatrix,
  useSavePriceMatrix,
  useTicketTypes,
} from "../queries";
import type { PriceEntry, SeasonKind } from "../types";

const SEASON_LABELS: Record<SeasonKind, string> = {
  regular: "Regular",
  high: "High Season",
};

const cellKey = (typeId: string, seasonKind: SeasonKind, channelId: string) =>
  `${typeId}|${seasonKind}|${channelId}`;

export function PriceMatrixSection() {
  const typesQuery = useTicketTypes();
  const channelsQuery = useChannels();
  const matrixQuery = usePriceMatrix();
  const saveMutation = useSavePriceMatrix();

  const activeTypes = (typesQuery.data ?? []).filter((t) => t.is_active);
  const activeChannels = (channelsQuery.data ?? []).filter((c) => c.is_active);
  const gapCount = matrixQuery.data?.gaps.length ?? 0;

  // Draft grid: key "type|season|channel" → string input (kosong = lubang)
  const [draft, setDraft] = useState<Record<string, string>>({});

  const serverValues = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of matrixQuery.data?.prices ?? []) {
      map[cellKey(p.ticket_type_id, p.season_kind, p.channel_id)] = String(p.price);
    }
    return map;
  }, [matrixQuery.data]);

  useEffect(() => {
    setDraft(serverValues);
  }, [serverValues]);

  const isDirty = useMemo(() => {
    const keys = new Set([...Object.keys(draft), ...Object.keys(serverValues)]);
    for (const key of keys) {
      if ((draft[key] ?? "") !== (serverValues[key] ?? "")) return true;
    }
    return false;
  }, [draft, serverValues]);

  const handleSave = () => {
    const entries: PriceEntry[] = [];
    for (const [key, raw] of Object.entries(draft)) {
      if (raw === "" || raw === serverValues[key]) continue;
      const price = Number(raw);
      if (!Number.isFinite(price) || price < 0) {
        toast.error("Ada harga tidak valid — periksa kembali angka di grid");
        return;
      }
      const [ticket_type_id, season_kind, channel_id] = key.split("|");
      entries.push({
        ticket_type_id,
        season_kind: season_kind as SeasonKind,
        channel_id,
        price,
      });
    }
    if (entries.length === 0) return;
    saveMutation.mutate(entries);
  };

  const isLoading =
    typesQuery.isLoading || channelsQuery.isLoading || matrixQuery.isLoading;

  return (
    <PurchasingListSection
      icon={CurrencyDollarIcon}
      title="Matriks Harga"
      description="Harga per jenis tiket × musim × kanal. Kombinasi kosong = transaksi ditolak, bukan gratis."
      toolbar={
        <div className="flex items-center gap-3">
          {gapCount > 0 ? (
            <Badge className="border-0 bg-amber-100 font-normal text-amber-700">
              {gapCount} kombinasi belum berharga
            </Badge>
          ) : (
            <Badge className="border-0 bg-emerald-100 font-normal text-emerald-700">
              Matriks lengkap
            </Badge>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!isDirty || saveMutation.isPending}
          >
            {saveMutation.isPending ? "Menyimpan…" : "Simpan Harga"}
          </Button>
        </div>
      }
    >
      {isLoading ? (
        <div className="py-14 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
          <p className="mt-2 text-sm text-gray-500">Memuat matriks harga...</p>
        </div>
      ) : activeTypes.length === 0 || activeChannels.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-gray-500">
          Aktifkan minimal satu jenis tiket dan satu kanal untuk mengisi harga.
        </div>
      ) : (
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full text-sm">
            <thead>
              <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                <th className="px-4 py-3 text-left font-semibold">Jenis Tiket</th>
                {activeChannels.map((channel) =>
                  (["regular", "high"] as const).map((seasonKind) => (
                    <th
                      key={`${channel.id}-${seasonKind}`}
                      className="px-3 py-3 text-left font-semibold"
                    >
                      {channel.name}
                      <span className="block text-[10px] font-normal normal-case text-gray-400">
                        {SEASON_LABELS[seasonKind]}
                      </span>
                    </th>
                  ))
                )}
              </TableRow>
            </thead>
            <tbody className="divide-y divide-gray-200/50">
              {activeTypes.map((type) => (
                <TableRow key={type.id} className="hover:bg-gray-50/80">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {type.name}
                  </td>
                  {activeChannels.map((channel) =>
                    (["regular", "high"] as const).map((seasonKind) => {
                      const key = cellKey(type.id, seasonKind, channel.id);
                      const value = draft[key] ?? "";
                      const isGap = value === "";
                      return (
                        <td key={key} className="px-3 py-2">
                          <Input
                            type="number"
                            min={0}
                            step={1000}
                            placeholder="—"
                            value={value}
                            onChange={(e) =>
                              setDraft((p) => ({ ...p, [key]: e.target.value }))
                            }
                            className={`h-9 w-32 text-right ${
                              isGap
                                ? "border-amber-300 bg-amber-50/60"
                                : ""
                            }`}
                          />
                        </td>
                      );
                    })
                  )}
                </TableRow>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-gray-500">
            Harga yang sudah ter-charge di kunjungan berjalan tidak ikut berubah
            — sistem menyimpan snapshot harga saat tap.
          </p>
        </div>
      )}
    </PurchasingListSection>
  );
}
