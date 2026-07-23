"use client";

// Fase D3 — halaman status booking publik via capability token.
// menunggu-bayar: countdown + tombol bayar; terbayar: QR booking_code
// (dipindai loket saat redeem D4); digunakan/kedaluwarsa/dibatalkan:
// keterangan. Poll 10 dtk selama masih menunggu-bayar supaya halaman
// yang dibuka dari redirect Xendit berpindah sendiri ke "terbayar".

import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  BadgeCheck,
  CircleSlash,
  Clock3,
  Loader2,
  TicketCheck,
  TimerOff,
} from "lucide-react";

const formatRp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

const formatDateLong = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

interface BookingItem {
  product_name: string;
  variant_name: string;
  qty: number;
  unit_price: number;
  season_kind: string;
  subtotal: number;
}

interface BookingStatusData {
  booking_code: string;
  visit_date: string;
  customer_name: string;
  status: string;
  total: number;
  invoice_url: string | null;
  expires_at: string | null;
  paid_at: string | null;
  used_at: string | null;
  items: BookingItem[];
  guests: { guest_name: string; variant_name: string }[];
}

const POLL_MS = 10_000;

interface BookingStatusPageProps {
  token: string;
}

export function BookingStatusPage({ token }: BookingStatusPageProps) {
  const [booking, setBooking] = useState<BookingStatusData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/booking/status/${token}`, {
        cache: "no-store",
      });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const body = await res.json();
      if (res.ok && body.success) setBooking(body.data);
    } catch {
      // jaringan — biarkan poll berikutnya mencoba lagi
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (booking?.status !== "menunggu-bayar") return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [booking?.status, load]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-50">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (notFound || !booking) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-6">
        <div className="max-w-sm text-center">
          <CircleSlash className="mx-auto h-10 w-10 text-gray-300" />
          <h1 className="mt-3 font-semibold text-gray-900">
            Booking tidak ditemukan
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Tautan tidak valid atau sudah tidak berlaku. Periksa kembali link
            dari WhatsApp Anda.
          </p>
        </div>
      </div>
    );
  }

  const statusView: Record<
    string,
    { label: string; badge: string; icon: React.ReactNode }
  > = {
    "menunggu-bayar": {
      label: "Menunggu Pembayaran",
      badge: "bg-amber-100 text-amber-800",
      icon: <Clock3 className="h-4 w-4" />,
    },
    terbayar: {
      label: "Terbayar",
      badge: "bg-emerald-100 text-emerald-800",
      icon: <BadgeCheck className="h-4 w-4" />,
    },
    digunakan: {
      label: "Sudah Digunakan",
      badge: "bg-blue-100 text-blue-800",
      icon: <TicketCheck className="h-4 w-4" />,
    },
    kedaluwarsa: {
      label: "Kedaluwarsa",
      badge: "bg-gray-200 text-gray-600",
      icon: <TimerOff className="h-4 w-4" />,
    },
    dibatalkan: {
      label: "Dibatalkan",
      badge: "bg-red-100 text-red-700",
      icon: <CircleSlash className="h-4 w-4" />,
    },
    hangus: {
      label: "Hangus",
      badge: "bg-orange-100 text-orange-700",
      icon: <TimerOff className="h-4 w-4" />,
    },
  };
  const view = statusView[booking.status] ?? statusView["menunggu-bayar"];

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg bg-gray-50 px-4 py-6">
      <header className="text-center">
        <h1 className="text-lg font-semibold text-gray-900">Status Booking</h1>
        <span
          className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${view.badge}`}
        >
          {view.icon}
          {view.label}
        </span>
      </header>

      {booking.status === "terbayar" && (
        <section className="mt-5 rounded-2xl bg-white p-6 text-center shadow-sm">
          <div className="mx-auto w-fit rounded-xl border-4 border-emerald-100 p-3">
            <QRCodeSVG value={booking.booking_code} size={192} marginSize={1} />
          </div>
          <p className="mt-4 text-xs uppercase tracking-wide text-gray-400">
            Kode booking
          </p>
          <p className="text-2xl font-bold tracking-widest text-gray-900">
            {booking.booking_code}
          </p>
          <p className="mx-auto mt-3 max-w-xs text-xs leading-relaxed text-gray-500">
            Tunjukkan QR ini ke petugas loket pada tanggal kunjungan untuk
            ditukar dengan gelang masuk.
          </p>
        </section>
      )}

      {booking.status === "menunggu-bayar" && (
        <section className="mt-5 rounded-2xl bg-white p-5 text-center shadow-sm">
          <p className="text-sm text-gray-600">
            Selesaikan pembayaran sebelum{" "}
            <b>
              {booking.expires_at ? formatDateTime(booking.expires_at) : "—"}
            </b>{" "}
            atau booking otomatis kedaluwarsa.
          </p>
          {booking.invoice_url && (
            <a
              href={booking.invoice_url}
              className="mt-4 block w-full rounded-xl bg-emerald-600 py-3 font-semibold text-white"
            >
              Bayar Sekarang — {formatRp(booking.total)}
            </a>
          )}
          <p className="mt-3 text-xs text-gray-400">
            Halaman ini memperbarui status secara otomatis setelah pembayaran.
          </p>
        </section>
      )}

      {booking.status === "digunakan" && booking.used_at && (
        <section className="mt-5 rounded-2xl bg-white p-5 text-center text-sm text-gray-600 shadow-sm">
          Booking ditukar di loket pada {formatDateTime(booking.used_at)}.
          Selamat bermain! 🎡
        </section>
      )}

      {booking.status === "kedaluwarsa" && (
        <section className="mt-5 rounded-2xl bg-white p-5 text-center text-sm text-gray-600 shadow-sm">
          Batas waktu pembayaran terlewati. Silakan buat booking baru.
        </section>
      )}

      {booking.status === "hangus" && (
        <p className="mt-4 rounded-xl bg-orange-50 px-4 py-3 text-sm text-orange-700">
          Masa berlaku tiket sudah lewat sehingga booking hangus. Hubungi
          petugas venue bila ada kendala pada hari kunjungan Anda.
        </p>
      )}
      {booking.status === "dibatalkan" && (
        <section className="mt-5 rounded-2xl bg-white p-5 text-center text-sm text-gray-600 shadow-sm">
          Booking dibatalkan. Bila sudah terlanjur membayar, hubungi petugas
          venue untuk proses pengembalian.
        </section>
      )}

      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">Tanggal kunjungan</dt>
            <dd className="font-medium text-gray-900">
              {formatDateLong(booking.visit_date)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Atas nama</dt>
            <dd className="font-medium text-gray-900">
              {booking.customer_name}
            </dd>
          </div>
          {booking.paid_at && (
            <div className="flex justify-between">
              <dt className="text-gray-500">Dibayar</dt>
              <dd className="font-medium text-gray-900">
                {formatDateTime(booking.paid_at)}
              </dd>
            </div>
          )}
        </dl>
        <div className="my-3 border-t border-dashed border-gray-200" />
        <div className="space-y-2 text-sm">
          {booking.items.map((item, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-gray-700">
                {item.product_name} — {item.variant_name} × {item.qty}
              </span>
              <span className="font-medium tabular-nums">
                {formatRp(item.subtotal)}
              </span>
            </div>
          ))}
        </div>
        {booking.guests.length > 1 && (
          <>
            <div className="my-3 border-t border-dashed border-gray-200" />
            <p className="mb-1.5 text-xs font-medium text-gray-500">
              Anggota rombongan
            </p>
            <ol className="space-y-1 text-sm text-gray-700">
              {booking.guests.map((guest, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="truncate">
                    {i + 1}. {guest.guest_name}
                  </span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {guest.variant_name}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
        <div className="mt-3 flex justify-between border-t border-gray-200 pt-3">
          <span className="font-semibold text-gray-900">Total</span>
          <span className="font-semibold tabular-nums text-emerald-700">
            {formatRp(booking.total)}
          </span>
        </div>
      </section>
    </div>
  );
}
