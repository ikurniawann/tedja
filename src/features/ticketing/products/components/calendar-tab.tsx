"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateProductDate, useDeleteProductDate } from "../queries";
import type { ProductDateKind, TicketProductDetail } from "../types";

const KIND_META: Record<
  ProductDateKind,
  { label: string; badgeClass: string; hint: string }
> = {
  "high-season": {
    label: "High Season",
    badgeClass: "bg-amber-100 text-amber-700",
    hint: "Harga High Season berlaku di rentang ini",
  },
  "blok-online": {
    label: "Blok Online",
    badgeClass: "bg-red-100 text-red-700",
    hint: "Tanggal tidak dijual di website booking — walk-in tetap jalan",
  },
};

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function CalendarTab({ detail }: { detail: TicketProductDetail }) {
  const [kind, setKind] = useState<ProductDateKind>("high-season");
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const createMutation = useCreateProductDate(() => {
    setLabel("");
    setStartDate("");
    setEndDate("");
  });
  const deleteMutation = useDeleteProductDate();

  const canAdd =
    label.trim() !== "" &&
    startDate !== "" &&
    endDate !== "" &&
    endDate >= startDate;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-gray-200/70 p-4">
        <Label className="text-sm font-semibold">Tambah Rentang Tanggal</Label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select value={kind} onValueChange={(v) => setKind(v as ProductDateKind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="high-season">High Season</SelectItem>
              <SelectItem value="blok-online">Blok Penjualan Online</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Label, mis. Libur Lebaran 2027"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="lg:col-span-2"
          />
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <div className="flex gap-2">
            <Input
              type="date"
              min={startDate || undefined}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <Button
              disabled={!canAdd || createMutation.isPending}
              onClick={() =>
                createMutation.mutate({
                  id: detail.product.id,
                  values: {
                    date_kind: kind,
                    label: label.trim(),
                    start_date: startDate,
                    end_date: endDate,
                  },
                })
              }
            >
              {createMutation.isPending ? "…" : "Tambah"}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">{KIND_META[kind].hint}</p>
      </div>

      <div className="space-y-2">
        {detail.dates.map((range) => {
          const meta = KIND_META[range.date_kind];
          return (
            <div
              key={range.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200/70 px-3 py-2 text-sm"
            >
              <Badge className={`border-0 font-normal ${meta.badgeClass}`}>
                {meta.label}
              </Badge>
              <span className="font-medium text-gray-900">{range.label}</span>
              <span className="text-gray-500">
                {formatDate(range.start_date)} – {formatDate(range.end_date)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-7 px-2 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600"
                disabled={deleteMutation.isPending}
                onClick={() =>
                  deleteMutation.mutate({
                    id: detail.product.id,
                    dateId: range.id,
                  })
                }
              >
                Hapus
              </Button>
            </div>
          );
        })}
        {detail.dates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 px-3 py-8 text-center text-sm text-gray-400">
            Belum ada rentang — semua tanggal dihitung Regular & bisa dijual
            online.
          </p>
        ) : null}
      </div>
    </div>
  );
}
