"use client";

// Fase D3 — wizard booking publik mobile-first, tanpa login:
// tanggal → pilih tiket & qty per varian (harga live per tanggal) →
// data pemesan → ringkasan → redirect invoice Xendit.
// Harga di sini murni tampilan; server menghitung ulang saat POST.

import { useCallback, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Loader2,
  Minus,
  Plus,
  Ticket,
  UserRound,
} from "lucide-react";

const MAX_QTY_PER_BOOKING = 20;
const MAX_DAYS_AHEAD = 90;

const formatRp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

const formatDateLong = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

interface CatalogVariant {
  variant_id: string;
  variant_name: string;
  price: number;
  season_kind: "regular" | "high";
}

interface CatalogProduct {
  ticket_product_id: string;
  code: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  variants: CatalogVariant[];
}

type Step = "tanggal" | "tiket" | "pemesan" | "ringkasan";

const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const addDaysIso = (iso: string, days: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

interface BookingWizardProps {
  slug: string;
}

export function BookingWizard({ slug }: BookingWizardProps) {
  const [step, setStep] = useState<Step>("tanggal");
  const [visitDate, setVisitDate] = useState("");
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minDate = todayIso();
  const maxDate = addDaysIso(minDate, MAX_DAYS_AHEAD);

  const variantIndex = useMemo(() => {
    const map = new Map<
      string,
      { product: CatalogProduct; variant: CatalogVariant }
    >();
    for (const product of catalog) {
      for (const variant of product.variants) {
        map.set(variant.variant_id, { product, variant });
      }
    }
    return map;
  }, [catalog]);

  const cart = useMemo(
    () =>
      Object.entries(qty)
        .filter(([, n]) => n > 0)
        .map(([variantId, n]) => {
          const known = variantIndex.get(variantId);
          return known ? { ...known, qty: n } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    [qty, variantIndex]
  );
  const totalQty = cart.reduce((sum, c) => sum + c.qty, 0);
  const totalAmount = cart.reduce((sum, c) => sum + c.qty * c.variant.price, 0);

  const loadCatalog = useCallback(async () => {
    if (!visitDate) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/public/booking/${slug}/catalog?date=${visitDate}`
      );
      const body = await res.json();
      if (!res.ok || !body.success) {
        setError(
          body.error ??
            (res.status === 404
              ? "Halaman booking tidak ditemukan"
              : "Gagal memuat tiket — coba lagi")
        );
        return;
      }
      const products: CatalogProduct[] = body.data.products;
      if (products.length === 0) {
        setError("Tidak ada tiket tersedia untuk tanggal ini");
        return;
      }
      setCatalog(products);
      setQty({});
      setStep("tiket");
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setLoading(false);
    }
  }, [slug, visitDate]);

  const changeQty = (variantId: string, delta: number) => {
    setQty((prev) => {
      const next = Math.max(0, (prev[variantId] ?? 0) + delta);
      const others = Object.entries(prev)
        .filter(([id]) => id !== variantId)
        .reduce((sum, [, n]) => sum + n, 0);
      if (others + next > MAX_QTY_PER_BOOKING) return prev;
      return { ...prev, [variantId]: next };
    });
  };

  const phoneDigits = customerPhone.replace(/\D/g, "");
  const pemesanValid = customerName.trim().length >= 2 && phoneDigits.length >= 8;

  const submitBooking = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/booking/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visit_date: visitDate,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          items: cart.map((c) => ({
            variant_id: c.variant.variant_id,
            qty: c.qty,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setError(body.error ?? "Gagal membuat booking — coba lagi");
        setSubmitting(false);
        return;
      }
      // Simpan link status di tab ini lalu bawa ke halaman pembayaran
      window.location.href = body.data.invoice_url ?? body.data.status_url;
    } catch {
      setError("Jaringan bermasalah — booking belum dibuat, coba lagi");
      setSubmitting(false);
    }
  };

  const stepIndex = ["tanggal", "tiket", "pemesan", "ringkasan"].indexOf(step);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          {step !== "tanggal" && (
            <button
              type="button"
              aria-label="Kembali"
              onClick={() =>
                setStep(
                  step === "tiket"
                    ? "tanggal"
                    : step === "pemesan"
                      ? "tiket"
                      : "pemesan"
                )
              }
              className="rounded-full p-1.5 text-gray-600 hover:bg-gray-100"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div>
            <h1 className="text-base font-semibold text-gray-900">
              Booking Tiket Online
            </h1>
            {visitDate && step !== "tanggal" && (
              <p className="text-xs text-gray-500">{formatDateLong(visitDate)}</p>
            )}
          </div>
        </div>
        <div className="mt-3 flex gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${
                i <= stepIndex ? "bg-emerald-500" : "bg-gray-200"
              }`}
            />
          ))}
        </div>
      </header>

      <main className="flex-1 px-4 py-5 pb-28">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}

        {step === "tanggal" && (
          <section className="space-y-4">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-gray-900">
                <CalendarDays className="h-5 w-5 text-emerald-600" />
                <h2 className="font-medium">Pilih tanggal kunjungan</h2>
              </div>
              <input
                type="date"
                value={visitDate}
                min={minDate}
                max={maxDate}
                onChange={(e) => setVisitDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-emerald-500 focus:outline-none"
              />
              <p className="mt-2 text-xs text-gray-500">
                Bisa dipesan untuk hari ini sampai {MAX_DAYS_AHEAD} hari ke depan.
              </p>
            </div>
          </section>
        )}

        {step === "tiket" && (
          <section className="space-y-3">
            {catalog.map((product) => (
              <div
                key={product.ticket_product_id}
                className="overflow-hidden rounded-2xl bg-white shadow-sm"
              >
                {product.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.thumbnail_url}
                    alt={product.name}
                    className="h-36 w-full object-cover"
                  />
                )}
                <div className="p-4">
                  <div className="flex items-start gap-2">
                    <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        {product.name}
                      </h3>
                      {product.description && (
                        <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
                          {product.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {product.variants.map((variant) => {
                      const n = qty[variant.variant_id] ?? 0;
                      return (
                        <div
                          key={variant.variant_id}
                          className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5"
                        >
                          <div>
                            <p className="text-sm font-medium text-gray-800">
                              {variant.variant_name}
                            </p>
                            <p className="text-sm text-gray-600">
                              {formatRp(variant.price)}
                              {variant.season_kind === "high" && (
                                <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                  High Season
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              aria-label={`Kurangi ${variant.variant_name}`}
                              onClick={() => changeQty(variant.variant_id, -1)}
                              disabled={n === 0}
                              className="rounded-full border border-gray-300 bg-white p-1.5 text-gray-700 disabled:opacity-30"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="w-5 text-center text-sm font-semibold tabular-nums">
                              {n}
                            </span>
                            <button
                              type="button"
                              aria-label={`Tambah ${variant.variant_name}`}
                              onClick={() => changeQty(variant.variant_id, 1)}
                              disabled={totalQty >= MAX_QTY_PER_BOOKING}
                              className="rounded-full border border-emerald-500 bg-emerald-500 p-1.5 text-white disabled:opacity-30"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
            <p className="px-1 text-xs text-gray-400">
              Maksimum {MAX_QTY_PER_BOOKING} tiket per pemesanan.
            </p>
          </section>
        )}

        {step === "pemesan" && (
          <section className="space-y-4">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-gray-900">
                <UserRound className="h-5 w-5 text-emerald-600" />
                <h2 className="font-medium">Data pemesan</h2>
              </div>
              <label className="block text-sm font-medium text-gray-700">
                Nama lengkap
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  maxLength={120}
                  placeholder="Nama sesuai identitas"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base font-normal focus:border-emerald-500 focus:outline-none"
                />
              </label>
              <label className="mt-4 block text-sm font-medium text-gray-700">
                Nomor WhatsApp
                <input
                  type="tel"
                  inputMode="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  maxLength={25}
                  placeholder="08xxxxxxxxxx"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base font-normal focus:border-emerald-500 focus:outline-none"
                />
              </label>
              <p className="mt-2 text-xs text-gray-500">
                Kode booking & QR tiket dikirim ke nomor WhatsApp ini setelah
                pembayaran berhasil.
              </p>
            </div>
          </section>
        )}

        {step === "ringkasan" && (
          <section className="space-y-3">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="mb-3 font-medium text-gray-900">Ringkasan pesanan</h2>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Tanggal kunjungan</dt>
                  <dd className="font-medium text-gray-900">
                    {formatDateLong(visitDate)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Pemesan</dt>
                  <dd className="font-medium text-gray-900">
                    {customerName.trim()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">WhatsApp</dt>
                  <dd className="font-medium text-gray-900">{customerPhone}</dd>
                </div>
              </dl>
              <div className="my-3 border-t border-dashed border-gray-200" />
              <div className="space-y-2 text-sm">
                {cart.map((c) => (
                  <div
                    key={c.variant.variant_id}
                    className="flex justify-between"
                  >
                    <span className="text-gray-700">
                      {c.product.name} — {c.variant.variant_name} × {c.qty}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatRp(c.variant.price * c.qty)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-between border-t border-gray-200 pt-3">
                <span className="font-semibold text-gray-900">Total</span>
                <span className="font-semibold tabular-nums text-emerald-700">
                  {formatRp(totalAmount)}
                </span>
              </div>
            </div>
            <p className="px-1 text-xs leading-relaxed text-gray-500">
              Setelah menekan <b>Bayar Sekarang</b> Anda diarahkan ke halaman
              pembayaran. Selesaikan dalam 2 jam — lewat dari itu booking
              otomatis kedaluwarsa.
            </p>
          </section>
        )}
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-10 mx-auto w-full max-w-lg border-t border-gray-200 bg-white px-4 py-3">
        {step === "tanggal" && (
          <button
            type="button"
            onClick={loadCatalog}
            disabled={!visitDate || loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-semibold text-white disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                Lihat Tiket <ChevronRight className="h-4 w-4" />
              </>
            )}
          </button>
        )}
        {step === "tiket" && (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-500">{totalQty} tiket</p>
              <p className="truncate font-semibold tabular-nums text-gray-900">
                {formatRp(totalAmount)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep("pemesan")}
              disabled={totalQty === 0}
              className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white disabled:opacity-40"
            >
              Lanjut
            </button>
          </div>
        )}
        {step === "pemesan" && (
          <button
            type="button"
            onClick={() => setStep("ringkasan")}
            disabled={!pemesanValid}
            className="w-full rounded-xl bg-emerald-600 py-3 font-semibold text-white disabled:opacity-40"
          >
            Lihat Ringkasan
          </button>
        )}
        {step === "ringkasan" && (
          <button
            type="button"
            onClick={submitBooking}
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-semibold text-white disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Memproses…
              </>
            ) : (
              <>Bayar Sekarang — {formatRp(totalAmount)}</>
            )}
          </button>
        )}
      </footer>
    </div>
  );
}
