"use client";

// Booking publik tanpa login — REDESAIN 24 Jul (struktur ala tiket.com "to-do"):
// halaman SATU layar untuk pemilihan tiket (hero venue → highlight → pilih
// tanggal → daftar kartu paket + stepper qty langsung di kartu → bar total
// sticky), lalu langkah pemesan → ringkasan → invoice Xendit.
//
// Aturan bisnis DIPERTAHANKAN: 1 transaksi = SATU produk tiket. Di layar satu
// halaman ini, menaikkan qty varian sebuah produk otomatis menjadikannya produk
// terpilih dan mereset produk lain (radio implisit). Harga di sini murni
// tampilan; server menghitung ulang saat POST. Payload items[] & flatten nama
// rombongan TIDAK berubah.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  Loader2,
  MapPin,
  Minus,
  Plus,
  QrCode,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { BookingCalendar, type UnavailableMap } from "./booking-calendar";

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

const formatDateShort = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

interface CatalogBundleMember {
  component_variant_id: string;
  member_label: string;
  weight_price: number | null;
}

interface CatalogVariant {
  variant_id: string;
  variant_name: string;
  price: number;
  season_kind: "regular" | "high";
  /** Fase P — paket: anggota per 1 unit (1 entri = 1 orang/gelang). */
  members?: CatalogBundleMember[];
}

interface CatalogProduct {
  ticket_product_id: string;
  code: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  product_kind: "single" | "bundle";
  variants: CatalogVariant[];
}

/** Jumlah ORANG per 1 qty varian (paket = jumlah anggota; satuan = 1). */
const personsPerUnit = (variant: CatalogVariant) =>
  variant.members?.length || 1;

/**
 * Total harga satuan anggota paket — pembanding "hemat". Null bila ada
 * bobot bolong (jangan menampilkan klaim hemat dari data tak lengkap).
 */
const bundleStandaloneTotal = (variant: CatalogVariant): number | null => {
  if (!variant.members || variant.members.length === 0) return null;
  let total = 0;
  for (const member of variant.members) {
    if (member.weight_price === null) return null;
    total += member.weight_price;
  }
  return total;
};

const variantLabelOf = (product: CatalogProduct, variant: CatalogVariant) =>
  product.product_kind === "bundle"
    ? `Paket (${variant.members?.length ?? 0} orang)`
    : variant.variant_name;

const priceRangeOf = (product: CatalogProduct) => {
  const prices = product.variants.map((v) => v.price);
  return prices.length ? Math.min(...prices) : 0;
};

type Step = "pilih" | "pemesan" | "ringkasan";

const STEP_ORDER: Step[] = ["pilih", "pemesan", "ringkasan"];

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

const HIGHLIGHTS = [
  { icon: Zap, label: "Konfirmasi instan" },
  { icon: QrCode, label: "E-tiket via WhatsApp" },
  { icon: ShieldCheck, label: "Tanpa cetak" },
];

interface BookingWizardProps {
  slug: string;
}

export function BookingWizard({ slug }: BookingWizardProps) {
  const [step, setStep] = useState<Step>("pilih");
  const [visitDate, setVisitDate] = useState(todayIso());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [venueName, setVenueName] = useState("");
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  // 1 transaksi = 1 produk tiket; qty diisi per varian produk terpilih
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null
  );
  const [qty, setQty] = useState<Record<string, number>>({});
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  // Nama anggota per varian per unit (opsional) — kosong = default server
  // "Group {pemesan} - N"
  const [guestNames, setGuestNames] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // EPIC-031 B4 — tanggal penuh/tutup dari availability API (indikatif;
  // kebenaran final tetap 409 dari create). Gagal fetch = biarkan kosong.
  const [unavailable, setUnavailable] = useState<UnavailableMap>({});
  // EPIC-031 D — slot waktu: kosong = venue tanpa timed-entry (tanpa
  // langkah pilih jam); ada isi = wajib pilih sebelum lanjut
  const [slots, setSlots] = useState<
    { slot_id: string; label: string; start_time: string; end_time: string; status: "available" | "sold_out" }[]
  >([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

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
  // Kuota & nama dihitung per ORANG — 1 unit paket = beberapa orang
  const totalQty = cart.reduce(
    (sum, c) => sum + c.qty * personsPerUnit(c.variant),
    0
  );
  const totalAmount = cart.reduce((sum, c) => sum + c.qty * c.variant.price, 0);

  // Unit ORANG ter-flatten urut keranjang (paket meledak per anggota) —
  // posisi global 1..N utk penomoran default nama anggota (1 = pemesan);
  // urutan HARUS sama dengan flatten server (item → qty → anggota)
  const units = useMemo(() => {
    const list: {
      variantId: string;
      unitIndex: number;
      position: number;
      label: string;
    }[] = [];
    let position = 0;
    for (const c of cart) {
      const members = c.variant.members;
      let flatIndex = 0;
      for (let k = 0; k < c.qty; k++) {
        if (members && members.length > 0) {
          for (const member of members) {
            position += 1;
            list.push({
              variantId: c.variant.variant_id,
              unitIndex: flatIndex++,
              position,
              label: `${c.product.name} · ${member.member_label}`,
            });
          }
        } else {
          position += 1;
          list.push({
            variantId: c.variant.variant_id,
            unitIndex: flatIndex++,
            position,
            label: `${c.product.name} — ${c.variant.variant_name}`,
          });
        }
      }
    }
    return list;
  }, [cart]);

  const defaultGuestName = (position: number) => {
    const base = customerName.trim() || "Anda";
    return position === 1 ? base : `Group ${base} - ${position}`;
  };

  const setGuestName = (variantId: string, unitIndex: number, value: string) => {
    setGuestNames((prev) => {
      const next = [...(prev[variantId] ?? [])];
      next[unitIndex] = value;
      return { ...prev, [variantId]: next };
    });
  };

  const loadCatalog = useCallback(
    async (date: string) => {
      if (!date) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/public/booking/${slug}/catalog?date=${date}`
        );
        const body = await res.json();
        if (body?.data?.venue?.name) setVenueName(body.data.venue.name);
        if (!res.ok || !body.success) {
          setCatalog([]);
          setError(
            body.error ??
              (res.status === 404
                ? "Halaman booking tidak ditemukan"
                : "Gagal memuat tiket — coba lagi")
          );
          return;
        }
        const products: CatalogProduct[] = body.data.products;
        // Ganti tanggal membuang pilihan sebelumnya (harga bisa beda)
        setCatalog(products);
        setQty({});
        setSelectedProductId(null);
        setGuestNames({});
        if (products.length === 0) {
          setError("Tidak ada tiket tersedia untuk tanggal ini");
        }
      } catch {
        setCatalog([]);
        setError("Jaringan bermasalah — coba lagi");
      } finally {
        setLoading(false);
      }
    },
    [slug]
  );

  // Muat katalog saat mount (default hari ini) & setiap tanggal berubah
  useEffect(() => {
    loadCatalog(visitDate);
  }, [visitDate, loadCatalog]);

  const loadAvailability = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/public/booking/${slug}/availability?from=${minDate}&to=${maxDate}`
      );
      const body = await res.json();
      if (res.ok && body.success) setUnavailable(body.data.dates ?? {});
    } catch {
      // indikatif — biarkan peta lama; guard server tetap menolak saat penuh
    }
  }, [slug, minDate, maxDate]);

  useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  const loadSlots = useCallback(
    async (date: string) => {
      try {
        const res = await fetch(`/api/public/booking/${slug}/slots?date=${date}`);
        const body = await res.json();
        if (res.ok && body.success) {
          setSlots(body.data.slots ?? []);
        }
      } catch {
        // biarkan daftar lama — guard server tetap menolak slot invalid
      }
    },
    [slug]
  );

  // Ganti tanggal → muat ulang slot & buang pilihan (kuota per tanggal)
  useEffect(() => {
    setSelectedSlotId(null);
    loadSlots(visitDate);
  }, [visitDate, loadSlots]);

  const dateUnavailable = unavailable[visitDate] !== undefined;
  const selectedSlot = slots.find((s) => s.slot_id === selectedSlotId) ?? null;
  // Venue ber-slot: wajib pilih slot yang masih tersedia sebelum lanjut
  const slotRequirementUnmet =
    slots.length > 0 && (!selectedSlot || selectedSlot.status === "sold_out");

  const selectedProduct =
    catalog.find((p) => p.ticket_product_id === selectedProductId) ?? null;

  const heroUrl = useMemo(
    () => catalog.find((p) => p.thumbnail_url)?.thumbnail_url ?? null,
    [catalog]
  );

  // Menaikkan qty varian → jadikan produknya terpilih (reset produk lain)
  const changeQty = (product: CatalogProduct, variant: CatalogVariant, delta: number) => {
    const variantId = variant.variant_id;
    const switchingProduct =
      delta > 0 && selectedProductId !== product.ticket_product_id;

    if (switchingProduct) {
      setSelectedProductId(product.ticket_product_id);
      setGuestNames({});
      setQty({ [variantId]: 1 });
      return;
    }

    setQty((prev) => {
      const next = Math.max(0, (prev[variantId] ?? 0) + delta);
      const persons = (id: string, n: number) => {
        const known = variantIndex.get(id);
        return known ? n * personsPerUnit(known.variant) : n;
      };
      const others = Object.entries(prev)
        .filter(([id]) => id !== variantId)
        .reduce((sum, [id, n]) => sum + persons(id, n), 0);
      if (others + persons(variantId, next) > MAX_QTY_PER_BOOKING) return prev;
      const draft = { ...prev, [variantId]: next };
      return draft;
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
          ...(selectedSlotId ? { slot_id: selectedSlotId } : {}),
          items: cart.map((c) => ({
            variant_id: c.variant.variant_id,
            qty: c.qty,
            // nama per ORANG (paket = qty × anggota), urutan = flatten server
            guest_names: Array.from(
              { length: c.qty * personsPerUnit(c.variant) },
              (_, k) => {
                const name = guestNames[c.variant.variant_id]?.[k]?.trim();
                return name || null; // kosong → default server
              }
            ),
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setError(body.error ?? "Gagal membuat booking — coba lagi");
        // Keburu penuh (409 EPIC-031) → segarkan peta & slot supaya yang
        // penuh langsung tercoret saat pengunjung memilih ulang
        if (res.status === 409) {
          loadAvailability();
          loadSlots(visitDate);
        }
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

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-white md:max-w-2xl">
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-white/95 px-5 pt-4 backdrop-blur">
        <div className="flex h-9 items-center">
          {step !== "pilih" && (
            <button
              type="button"
              aria-label="Kembali"
              onClick={() => setStep(STEP_ORDER[Math.max(0, stepIndex - 1)])}
              className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full text-gray-800 hover:bg-gray-100"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <span className="ml-auto rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700">
            {formatDateShort(visitDate)}
            {totalQty > 0 ? ` · ${totalQty} tiket` : ""}
          </span>
        </div>
        <div className="mt-3 flex gap-1">
          {STEP_ORDER.map((_, i) => (
            <div
              key={i}
              className={`h-[3px] flex-1 rounded-full transition-colors ${
                i <= stepIndex ? "bg-gray-900" : "bg-gray-200"
              }`}
            />
          ))}
        </div>
      </header>

      <main className="flex-1 pb-32">
        {error && step === "pilih" && catalog.length === 0 && !loading && (
          <div className="mx-5 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        )}

        {/* ══════════════ LAYAR PILIH (single-page ala tiket.com) ══════════════ */}
        {step === "pilih" && (
          <>
            {/* Hero venue */}
            <section className="px-5 pt-4">
              <div className="relative overflow-hidden rounded-3xl">
                <div className="aspect-[16/9] w-full bg-gradient-to-br from-rose-400 via-rose-500 to-rose-600">
                  {heroUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={heroUrl}
                      alt={venueName}
                      className="h-full w-full object-cover"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                </div>
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <h1 className="text-xl font-bold leading-tight text-white drop-shadow-sm">
                    {venueName || "Pesan Tiket"}
                  </h1>
                  <p className="mt-1 flex items-center gap-1 text-xs font-medium text-white/90">
                    <MapPin className="h-3.5 w-3.5" /> Tiket masuk resmi · e-ticket
                  </p>
                </div>
              </div>

              {/* Highlight chips (pernyataan faktual) */}
              <div className="mt-3 flex flex-wrap gap-2">
                {HIGHLIGHTS.map(({ icon: Icon, label }) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"
                  >
                    <Icon className="h-3.5 w-3.5 text-rose-500" /> {label}
                  </span>
                ))}
              </div>
            </section>

            {/* Pilih tanggal */}
            <section className="mt-6 px-5">
              <h2 className="text-base font-semibold text-gray-900">
                Tanggal kunjungan
              </h2>
              <button
                type="button"
                onClick={() => setCalendarOpen((v) => !v)}
                className="mt-2 flex w-full items-center justify-between gap-3 rounded-2xl border border-gray-200 px-4 py-3.5 text-left transition-colors hover:border-gray-400"
              >
                <span className="flex items-center gap-3">
                  <CalendarDays className="h-5 w-5 text-rose-500" />
                  <span className="text-[15px] font-medium text-gray-900">
                    {formatDateLong(visitDate)}
                  </span>
                </span>
                <ChevronDown
                  className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${
                    calendarOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {calendarOpen && (
                <div className="mt-3 rounded-3xl border border-gray-200 p-5 shadow-[0_6px_16px_rgba(0,0,0,0.08)]">
                  <BookingCalendar
                    value={visitDate}
                    minDate={minDate}
                    maxDate={maxDate}
                    unavailable={unavailable}
                    onChange={(iso) => {
                      setVisitDate(iso);
                      setCalendarOpen(false);
                    }}
                  />
                </div>
              )}
              {dateUnavailable && (
                <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {unavailable[visitDate] === "closed"
                    ? "Tanggal ini tidak menerima kunjungan — pilih tanggal lain."
                    : "Tanggal ini sudah penuh — pilih tanggal lain."}
                </p>
              )}
              <p className="mt-2 px-1 text-xs text-gray-400">
                Harga bisa berbeda per tanggal · bisa dipesan sampai{" "}
                {MAX_DAYS_AHEAD} hari ke depan.
              </p>
            </section>

            {/* EPIC-031 D — pilih slot jam (hanya venue ber-timed-entry) */}
            {slots.length > 0 && !dateUnavailable && (
              <section className="mt-6 px-5">
                <h2 className="text-base font-semibold text-gray-900">
                  Jam kunjungan
                </h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {slots.map((slot) => {
                    const soldOut = slot.status === "sold_out";
                    const active = slot.slot_id === selectedSlotId;
                    return (
                      <button
                        key={slot.slot_id}
                        type="button"
                        disabled={soldOut}
                        onClick={() => setSelectedSlotId(slot.slot_id)}
                        aria-pressed={active}
                        className={`rounded-2xl border px-4 py-2.5 text-left text-sm transition-colors ${
                          active
                            ? "border-gray-900 bg-gray-900 text-white"
                            : soldOut
                              ? "cursor-default border-gray-200 text-gray-300 line-through"
                              : "border-gray-200 text-gray-800 hover:border-gray-400"
                        }`}
                      >
                        <span className="font-medium">{slot.label}</span>
                        <span
                          className={`ml-2 tabular-nums ${active ? "text-gray-300" : "text-gray-500"}`}
                        >
                          {slot.start_time}–{slot.end_time}
                        </span>
                        {soldOut ? <span className="ml-2 text-xs">Penuh</span> : null}
                      </button>
                    );
                  })}
                </div>
                {slotRequirementUnmet && (
                  <p className="mt-2 px-1 text-xs text-gray-400">
                    Pilih jam kunjungan untuk lanjut.
                  </p>
                )}
              </section>
            )}

            {/* Daftar paket */}
            <section className="mt-6 px-5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-base font-semibold text-gray-900">
                  Pilih tiket
                </h2>
                <span className="text-xs text-gray-400">1 jenis / transaksi</span>
              </div>

              {loading ? (
                <div className="mt-4 space-y-3">
                  {[0, 1].map((i) => (
                    <div
                      key={i}
                      className="h-28 animate-pulse rounded-3xl bg-gray-100"
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-3 space-y-4">
                  {catalog.map((product) => {
                    const isSelected =
                      product.ticket_product_id === selectedProductId;
                    return (
                      <PackageCard
                        key={product.ticket_product_id}
                        product={product}
                        isSelected={isSelected}
                        qty={qty}
                        totalQty={totalQty}
                        onChangeQty={changeQty}
                      />
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {/* ══════════════ PEMESAN ══════════════ */}
        {step === "pemesan" && (
          <section className="mt-2 space-y-6 px-5 pt-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
                Siapa yang memesan?
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Kode booking & QR tiket dikirim lewat WhatsApp.
              </p>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-gray-900">
                  Nama lengkap
                </span>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  maxLength={120}
                  placeholder="Nama sesuai identitas"
                  className="mt-1.5 w-full rounded-xl border border-gray-300 px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-900">
                  Nomor WhatsApp
                </span>
                <input
                  type="tel"
                  inputMode="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  maxLength={25}
                  placeholder="08xxxxxxxxxx"
                  className="mt-1.5 w-full rounded-xl border border-gray-300 px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <p className="flex items-start gap-2 text-xs leading-relaxed text-gray-500">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                Kode booking & QR tiket dikirim ke nomor WhatsApp ini setelah
                pembayaran berhasil.
              </p>
            </div>

            {totalQty > 1 && (
              <div className="rounded-3xl border border-gray-200 p-5">
                <h2 className="font-semibold text-gray-900">
                  Nama anggota rombongan{" "}
                  <span className="text-xs font-normal text-gray-400">
                    (opsional)
                  </span>
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">
                  Kosongkan bila tidak perlu — otomatis diberi nama{" "}
                  <span className="font-medium">{defaultGuestName(2)}</span>,
                  dst. Nama ini tampil saat penukaran gelang di loket.
                </p>
                <div className="mt-4 space-y-3">
                  {units.map((unit) => (
                    <label
                      key={`${unit.variantId}-${unit.unitIndex}`}
                      className="block text-xs font-medium text-gray-500"
                    >
                      Tiket {unit.position} · {unit.label}
                      <input
                        type="text"
                        value={guestNames[unit.variantId]?.[unit.unitIndex] ?? ""}
                        onChange={(e) =>
                          setGuestName(
                            unit.variantId,
                            unit.unitIndex,
                            e.target.value
                          )
                        }
                        maxLength={120}
                        placeholder={defaultGuestName(unit.position)}
                        className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-base font-normal text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ══════════════ RINGKASAN ══════════════ */}
        {step === "ringkasan" && (
          <section className="mt-2 space-y-4 px-5 pt-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
                Periksa pesananmu
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Pastikan semuanya benar sebelum lanjut ke pembayaran.
              </p>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="rounded-3xl border border-gray-200 p-5 shadow-[0_6px_16px_rgba(0,0,0,0.10)]">
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">Tanggal kunjungan</dt>
                  <dd className="font-medium text-gray-900">
                    {formatDateLong(visitDate)}
                  </dd>
                </div>
                {selectedSlot && (
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-500">Jam kunjungan</dt>
                    <dd className="font-medium tabular-nums text-gray-900">
                      {selectedSlot.label} · {selectedSlot.start_time}–{selectedSlot.end_time}
                    </dd>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">Pemesan</dt>
                  <dd className="font-medium text-gray-900">
                    {customerName.trim()}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">WhatsApp</dt>
                  <dd className="font-medium text-gray-900">{customerPhone}</dd>
                </div>
              </dl>
              <div className="my-4 border-t border-gray-100" />
              <div className="space-y-2.5 text-sm">
                {cart.map((c) => (
                  <div
                    key={c.variant.variant_id}
                    className="flex justify-between gap-3"
                  >
                    <span className="text-gray-700">
                      {c.product.name} — {c.variant.variant_name} × {c.qty}
                    </span>
                    <span className="font-medium tabular-nums text-gray-900">
                      {formatRp(c.variant.price * c.qty)}
                    </span>
                  </div>
                ))}
              </div>
              {totalQty > 1 && (
                <>
                  <div className="my-4 border-t border-gray-100" />
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                    Anggota rombongan
                  </p>
                  <ol className="space-y-1.5 text-sm text-gray-700">
                    {units.map((unit) => (
                      <li
                        key={`${unit.variantId}-${unit.unitIndex}`}
                        className="flex justify-between gap-3"
                      >
                        <span className="truncate">
                          {unit.position}.{" "}
                          {guestNames[unit.variantId]?.[unit.unitIndex]?.trim() ||
                            defaultGuestName(unit.position)}
                        </span>
                        <span className="shrink-0 text-xs text-gray-400">
                          {unit.label}
                        </span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              <div className="mt-4 flex justify-between border-t border-gray-200 pt-4">
                <span className="text-base font-semibold text-gray-900">
                  Total
                </span>
                <span className="text-base font-semibold tabular-nums text-gray-900">
                  {formatRp(totalAmount)}
                </span>
              </div>
            </div>
            <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-gray-500">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              Setelah menekan <b>Bayar Sekarang</b> Anda diarahkan ke halaman
              pembayaran. Selesaikan dalam 2 jam — lewat dari itu booking
              otomatis kedaluwarsa.
            </p>
          </section>
        )}
      </main>

      {/* ── Bar bawah sticky (ringkasan pesanan + CTA) ── */}
      <footer className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-lg border-t border-gray-200 bg-white px-5 py-3.5 md:max-w-2xl">
        {step === "pilih" && (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              {totalQty > 0 ? (
                <>
                  <p className="truncate text-base font-semibold tabular-nums text-gray-900">
                    {formatRp(totalAmount)}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {selectedProduct?.name} · {totalQty} tiket
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-500">
                  Pilih jumlah tiket untuk lanjut
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setStep("pemesan")}
              disabled={totalQty === 0 || dateUnavailable || slotRequirementUnmet}
              className="shrink-0 rounded-xl bg-rose-500 px-8 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-rose-600 disabled:opacity-40 disabled:hover:bg-rose-500"
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
            className="w-full rounded-xl bg-rose-500 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-rose-600 disabled:opacity-40 disabled:hover:bg-rose-500"
          >
            Lihat Ringkasan
          </button>
        )}
        {step === "ringkasan" && (
          <button
            type="button"
            onClick={submitBooking}
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-500 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-rose-600 disabled:opacity-60"
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

/* ── Kartu paket ala tiket.com: header + expand detail + stepper per varian ── */
interface PackageCardProps {
  product: CatalogProduct;
  isSelected: boolean;
  qty: Record<string, number>;
  totalQty: number;
  onChangeQty: (
    product: CatalogProduct,
    variant: CatalogVariant,
    delta: number
  ) => void;
}

function PackageCard({
  product,
  isSelected,
  qty,
  totalQty,
  onChangeQty,
}: PackageCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const fromPrice = priceRangeOf(product);
  const productQty = product.variants.reduce(
    (sum, v) => sum + (qty[v.variant_id] ?? 0),
    0
  );

  return (
    <div
      className={`overflow-hidden rounded-3xl border transition-all ${
        isSelected
          ? "border-rose-500 shadow-[0_6px_16px_rgba(244,63,94,0.15)] ring-1 ring-rose-500"
          : "border-gray-200"
      }`}
    >
      <div className="flex gap-3 p-4">
        {product.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.thumbnail_url}
            alt={product.name}
            className="h-20 w-20 shrink-0 rounded-2xl object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 text-[15px] font-semibold text-gray-900">
              {product.name}
            </h3>
            {isSelected && productQty > 0 && (
              <span className="flex h-6 shrink-0 items-center gap-1 rounded-full bg-rose-500 px-2 text-[11px] font-semibold text-white">
                <Check className="h-3 w-3" /> {productQty}
              </span>
            )}
          </div>
          {product.description && (
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-gray-500">
              {product.description}
            </p>
          )}
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-[11px] text-gray-400">Mulai</span>
            <span className="text-[15px] font-bold text-gray-900">
              {formatRp(fromPrice)}
            </span>
            <span className="text-[11px] text-gray-400">/tiket</span>
          </div>
        </div>
      </div>

      {/* Toggle detail */}
      <button
        type="button"
        onClick={() => setDetailOpen((v) => !v)}
        className="flex w-full items-center gap-1 border-t border-gray-100 px-4 py-2.5 text-xs font-semibold text-rose-600"
      >
        {detailOpen ? "Sembunyikan detail" : "Lihat detail & pilih jumlah"}
        <ChevronDown
          className={`h-4 w-4 transition-transform ${
            detailOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {detailOpen && (
        <div className="divide-y divide-gray-100 border-t border-gray-100 bg-gray-50/60 px-4">
          {product.variants.map((variant) => {
            const n = qty[variant.variant_id] ?? 0;
            const standalone = bundleStandaloneTotal(variant);
            const saving =
              standalone !== null && standalone > variant.price
                ? standalone - variant.price
                : null;
            const label = variantLabelOf(product, variant);
            return (
              <div
                key={variant.variant_id}
                className="flex items-center justify-between gap-4 py-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {label}
                    {variant.season_kind === "high" && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        High Season
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm">
                    {saving !== null ? (
                      <>
                        <span className="mr-1.5 text-xs text-gray-400 line-through">
                          {formatRp(standalone!)}
                        </span>
                        <span className="font-semibold text-gray-900">
                          {formatRp(variant.price)}
                        </span>
                        <span className="ml-1.5 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600">
                          Hemat {formatRp(saving)}
                        </span>
                      </>
                    ) : (
                      <span className="font-semibold text-gray-900">
                        {formatRp(variant.price)}
                      </span>
                    )}
                  </p>
                  {product.product_kind === "bundle" && variant.members ? (
                    <p className="mt-0.5 text-xs leading-snug text-gray-400">
                      Termasuk:{" "}
                      {Object.entries(
                        variant.members.reduce<Record<string, number>>(
                          (acc, m) => ({
                            ...acc,
                            [m.member_label]: (acc[m.member_label] ?? 0) + 1,
                          }),
                          {}
                        )
                      )
                        .map(([lbl, count]) => `${count}× ${lbl}`)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
                {/* Stepper */}
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    aria-label={`Kurangi ${label}`}
                    onClick={() => onChangeQty(product, variant, -1)}
                    disabled={n === 0}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-gray-600 transition-colors hover:border-gray-900 hover:text-gray-900 disabled:cursor-default disabled:opacity-25 disabled:hover:border-gray-300 disabled:hover:text-gray-600"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-6 text-center text-[15px] font-medium tabular-nums text-gray-900">
                    {n}
                  </span>
                  <button
                    type="button"
                    aria-label={`Tambah ${label}`}
                    onClick={() => onChangeQty(product, variant, 1)}
                    disabled={
                      isSelected &&
                      totalQty + personsPerUnit(variant) > MAX_QTY_PER_BOOKING
                    }
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-gray-600 transition-colors hover:border-gray-900 hover:text-gray-900 disabled:cursor-default disabled:opacity-25 disabled:hover:border-gray-300 disabled:hover:text-gray-600"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
          <p className="py-3 text-[11px] text-gray-400">
            Maks {MAX_QTY_PER_BOOKING} tiket / pemesanan · 1 jenis tiket per
            transaksi.
          </p>
        </div>
      )}
    </div>
  );
}
