"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useBookingDetail,
  useCancelBooking,
  useResendBookingWa,
  useSaveRefundNote,
} from "../queries";
import {
  BOOKING_STATUS_BADGES,
  BOOKING_STATUS_LABELS,
  type BookingDetail,
} from "../types";

interface BookingDetailDialogProps {
  bookingId: string | null;
  onOpenChange: (open: boolean) => void;
}

const formatRp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;
const formatDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/**
 * Rincian booking + aksi D5: batalkan (wajib catatan bila sudah terbayar),
 * tandai refund manual, kirim ulang WA. Uang refund bergerak di luar
 * sistem — di sini hanya jejak catatannya.
 */
export function BookingDetailDialog({
  bookingId,
  onOpenChange,
}: BookingDetailDialogProps) {
  const detailQuery = useBookingDetail(bookingId);
  const booking = detailQuery.data;

  return (
    <Dialog open={bookingId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="font-mono">{booking?.booking_code ?? "…"}</span>
            {booking ? (
              <Badge
                className={`border-0 font-normal ${BOOKING_STATUS_BADGES[booking.status]}`}
              >
                {BOOKING_STATUS_LABELS[booking.status]}
              </Badge>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {detailQuery.isLoading || !booking ? (
          <p className="py-8 text-center text-sm text-gray-500">
            Memuat rincian…
          </p>
        ) : (
          // key = remount per booking → state panel aksi mulai bersih
          <BookingDetailBody key={booking.id} booking={booking} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BookingDetailBody({ booking }: { booking: BookingDetail }) {
  const [cancelMode, setCancelMode] = useState(false);
  const [refundNote, setRefundNote] = useState(booking.refund_note ?? "");

  const cancelMutation = useCancelBooking(() => setCancelMode(false));
  const refundNoteMutation = useSaveRefundNote();
  const resendMutation = useResendBookingWa();

  const canCancel =
    booking.status === "menunggu-bayar" || booking.status === "terbayar";
  const cancelNeedsNote = booking.status === "terbayar";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div>
          <p className="text-xs text-gray-500">Pemesan</p>
          <p className="font-medium text-gray-900">{booking.customer_name}</p>
          <p className="text-xs text-gray-500">{booking.customer_phone}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Tanggal Kunjungan</p>
          <p className="font-medium text-gray-900">{booking.visit_date}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Dibuat</p>
          <p className="text-gray-700">{formatDateTime(booking.created_at)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Dibayar</p>
          <p className="text-gray-700">{formatDateTime(booking.paid_at)}</p>
        </div>
        {booking.used_at ? (
          <div>
            <p className="text-xs text-gray-500">Dipakai (redeem loket)</p>
            <p className="text-gray-700">{formatDateTime(booking.used_at)}</p>
          </div>
        ) : null}
        {booking.status === "menunggu-bayar" && booking.xendit_invoice_url ? (
          <div>
            <p className="text-xs text-gray-500">Invoice Xendit</p>
            <a
              href={booking.xendit_invoice_url}
              target="_blank"
              rel="noreferrer"
              className="text-pink-600 underline underline-offset-2"
            >
              Buka link bayar
            </a>
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200/70">
        <table className="w-full text-sm">
          <thead className="bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Tiket</th>
              <th className="px-3 py-2 text-center font-semibold">Qty</th>
              <th className="px-3 py-2 text-right font-semibold">Harga</th>
              <th className="px-3 py-2 text-right font-semibold">Subtotal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200/50">
            {booking.items.map((item, i) => (
              <tr key={i}>
                <td className="px-3 py-2 text-gray-800">
                  {item.product_name} — {item.variant_name}
                  <span className="ml-1 text-xs text-gray-400">
                    ({item.season_kind})
                  </span>
                </td>
                <td className="px-3 py-2 text-center">{item.qty}</td>
                <td className="px-3 py-2 text-right">
                  {formatRp(item.unit_price)}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatRp(item.subtotal)}
                </td>
              </tr>
            ))}
            <tr className="bg-gray-50/60 font-semibold text-gray-900">
              <td className="px-3 py-2" colSpan={3}>
                Total
              </td>
              <td className="px-3 py-2 text-right">
                {formatRp(booking.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Catatan refund manual */}
      <div className="space-y-1.5">
        <Label htmlFor="refund_note">
          Catatan Refund Manual{" "}
          <span className="font-normal text-gray-400">
            (uang dikembalikan di luar sistem)
          </span>
        </Label>
        <Textarea
          id="refund_note"
          rows={2}
          placeholder="mis. Refund transfer BCA 22 Jul, potong biaya admin 5rb"
          value={refundNote}
          onChange={(e) => setRefundNote(e.target.value)}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            disabled={
              refundNote.trim() === "" ||
              refundNote.trim() === (booking.refund_note ?? "") ||
              refundNoteMutation.isPending
            }
            onClick={() =>
              refundNoteMutation.mutate({
                id: booking.id,
                refundNote: refundNote.trim(),
              })
            }
          >
            {refundNoteMutation.isPending ? "Menyimpan…" : "Simpan Catatan"}
          </Button>
        </div>
      </div>

      {/* Aksi */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200/70 pt-4">
        {booking.status === "terbayar" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={resendMutation.isPending}
            onClick={() => resendMutation.mutate({ id: booking.id })}
          >
            {resendMutation.isPending ? "Mengirim…" : "Kirim Ulang WA"}
          </Button>
        ) : null}
        {canCancel && !cancelMode ? (
          <Button
            size="sm"
            variant="outline"
            className="border-red-200 text-red-600 hover:bg-red-50"
            onClick={() => setCancelMode(true)}
          >
            Batalkan Booking…
          </Button>
        ) : null}
      </div>

      {cancelMode && canCancel ? (
        <div className="space-y-2 rounded-lg border border-red-200/70 bg-red-50/50 px-4 py-3">
          <p className="text-sm font-medium text-red-700">
            Batalkan booking {booking.booking_code}?
          </p>
          {cancelNeedsNote ? (
            <p className="text-xs text-red-600">
              Booking sudah terbayar — isi catatan refund di atas dulu; catatan
              itu ikut tersimpan saat pembatalan.
            </p>
          ) : (
            <p className="text-xs text-red-600">
              Pemesan tidak akan bisa membayar invoice ini lagi.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCancelMode(false)}
              disabled={cancelMutation.isPending}
            >
              Jangan
            </Button>
            <Button
              size="sm"
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={
                cancelMutation.isPending ||
                (cancelNeedsNote && refundNote.trim() === "")
              }
              onClick={() =>
                cancelMutation.mutate({
                  id: booking.id,
                  refundNote: refundNote.trim() || null,
                })
              }
            >
              {cancelMutation.isPending ? "Membatalkan…" : "Ya, Batalkan"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
