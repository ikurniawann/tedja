"use client";

import { useMemo, useState } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { matchRedeemBands } from "@/lib/ticketing/booking";
import { lookupBooking } from "../api";
import { useRedeemBooking } from "../queries";
import {
  BOOKING_STATUS_BADGES,
  BOOKING_STATUS_LABELS,
  type BookingLookup,
  type RedeemBand,
} from "../types";

interface RedeemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const formatRp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

/**
 * Redeem booking website di loket (D4): scan/ketik kode BK-XXXXXX →
 * rincian booking → tap gelang sesuai jumlah tiket → visit prepaid net-0.
 */
export function RedeemDialog({ open, onOpenChange }: RedeemDialogProps) {
  const [code, setCode] = useState("");
  const [booking, setBooking] = useState<BookingLookup | null>(null);
  const [bands, setBands] = useState<RedeemBand[]>([]);
  const [tapUid, setTapUid] = useState("");

  const reset = () => {
    setCode("");
    setBooking(null);
    setBands([]);
    setTapUid("");
  };

  const lookup = useMutation({
    mutationFn: lookupBooking,
    onSuccess: (data) => {
      setBooking(data);
      setBands([]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const redeem = useRedeemBooking(() => {
    reset();
    onOpenChange(false);
  });

  const items = useMemo(() => booking?.items ?? [], [booking]);

  // Kebutuhan vs gelang ter-tap per varian — progress + auto-assign
  const tappedByVariant = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of bands) {
      counts.set(b.variant_id, (counts.get(b.variant_id) ?? 0) + 1);
    }
    return counts;
  }, [bands]);

  const allMatched =
    booking !== null &&
    bands.length > 0 &&
    matchRedeemBands(
      items.map((i) => ({ variant_id: i.variant_id, qty: i.qty })),
      bands
    ).ok;

  const addBand = () => {
    const uid = tapUid.trim();
    if (!uid || !booking) return;
    if (bands.some((b) => b.nfc_uid.toUpperCase() === uid.toUpperCase())) {
      setTapUid("");
      return;
    }
    // Auto-assign ke varian pertama yang jatahnya belum penuh
    const target =
      items.find(
        (i) => (tappedByVariant.get(i.variant_id) ?? 0) < i.qty
      ) ?? items[0];
    if (!target) return;
    setBands((prev) => [...prev, { nfc_uid: uid, variant_id: target.variant_id }]);
    setTapUid("");
  };

  const setBandVariant = (index: number, variantId: string) => {
    setBands((prev) =>
      prev.map((b, i) => (i === index ? { ...b, variant_id: variantId } : b))
    );
  };

  const removeBand = (index: number) => {
    setBands((prev) => prev.filter((_, i) => i !== index));
  };

  const variantLabel = (variantId: string) => {
    const item = items.find((i) => i.variant_id === variantId);
    return item ? `${item.product_name} — ${item.variant_name}` : variantId;
  };

  const handleSubmit = () => {
    if (!booking || !allMatched || redeem.isPending) return;
    redeem.mutate({ id: booking.id, bands });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Redeem Booking Online</DialogTitle>
        </DialogHeader>

        {/* Langkah 1 — cari kode */}
        <div className="space-y-1.5">
          <Label htmlFor="booking_code">Kode Booking *</Label>
          <div className="flex gap-2">
            <Input
              id="booking_code"
              autoFocus
              placeholder="Scan QR pengunjung atau ketik BK-XXXXXX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (code.trim()) lookup.mutate(code.trim());
                }
              }}
              className="font-mono uppercase"
            />
            <Button
              onClick={() => code.trim() && lookup.mutate(code.trim())}
              disabled={lookup.isPending || !code.trim()}
            >
              {lookup.isPending ? "Mencari…" : "Cari"}
            </Button>
          </div>
        </div>

        {booking ? (
          <div className="space-y-4">
            {/* Ringkasan booking */}
            <div className="rounded-lg border border-gray-200/70 bg-gray-50/60 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-mono text-sm font-bold text-gray-900">
                    {booking.booking_code}
                  </p>
                  <p className="text-sm text-gray-700">
                    {booking.customer_name} · {booking.customer_phone}
                  </p>
                  <p className="text-xs text-gray-500">
                    Kunjungan {booking.visit_date} · Total {formatRp(booking.total)}
                  </p>
                </div>
                <Badge
                  className={`border-0 font-normal ${BOOKING_STATUS_BADGES[booking.status]}`}
                >
                  {BOOKING_STATUS_LABELS[booking.status]}
                </Badge>
              </div>
              {!booking.redeemable ? (
                <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {booking.status === "digunakan"
                    ? "Booking sudah dipakai — tidak bisa di-redeem dua kali."
                    : booking.status !== "terbayar"
                      ? "Hanya booking terbayar yang bisa di-redeem."
                      : `Booking untuk tanggal ${booking.visit_date} — redeem hanya di hari-H (hari ini ${booking.today}).`}
                </p>
              ) : null}
            </div>

            {booking.redeemable ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Kebutuhan tiket */}
                <div className="space-y-2">
                  <Label>Tiket dalam Booking</Label>
                  {items.map((item) => {
                    const tapped = tappedByVariant.get(item.variant_id) ?? 0;
                    const done = tapped === item.qty;
                    return (
                      <div
                        key={item.variant_id}
                        className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                          done
                            ? "border-emerald-200/70 bg-emerald-50/50"
                            : "border-gray-200/70"
                        }`}
                      >
                        <span className="min-w-0 truncate text-gray-800">
                          {item.product_name} — {item.variant_name}
                        </span>
                        <span
                          className={`ml-2 shrink-0 font-mono text-xs ${
                            done ? "text-emerald-700" : "text-gray-500"
                          }`}
                        >
                          {tapped}/{item.qty}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Tap gelang */}
                <div className="space-y-2">
                  <Label htmlFor="redeem_tap_uid">Tap Gelang Satu per Satu *</Label>
                  <Input
                    id="redeem_tap_uid"
                    placeholder="Fokuskan kursor lalu tap gelang di reader"
                    value={tapUid}
                    onChange={(e) => setTapUid(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addBand();
                      }
                    }}
                    className="font-mono"
                  />
                  <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                    {bands.map((band, index) => (
                      <div
                        key={band.nfc_uid}
                        className="flex items-center gap-2 rounded-lg border border-gray-200/70 px-3 py-2"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-700">
                          {band.nfc_uid}
                        </span>
                        <Select
                          value={band.variant_id}
                          onValueChange={(v) => setBandVariant(index, v)}
                        >
                          <SelectTrigger className="h-8 w-44">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {items.map((item) => (
                              <SelectItem
                                key={item.variant_id}
                                value={item.variant_id}
                              >
                                {variantLabel(item.variant_id)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => removeBand(index)}
                          className="h-8 w-8 p-0 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    {bands.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-xs text-gray-400">
                        Belum ada gelang di-tap
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={redeem.isPending}
          >
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={!allMatched || redeem.isPending}>
            {redeem.isPending ? "Memproses…" : "Redeem & Aktifkan Gelang"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
