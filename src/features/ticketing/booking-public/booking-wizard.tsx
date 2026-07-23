"use client";

// Fase D3 — wizard booking publik mobile-first, tanpa login:
// tanggal → pilih 1 jenis tiket (card) → atur qty → data pemesan →
// ringkasan → redirect invoice Xendit.
// Harga di sini murni tampilan; server menghitung ulang saat POST.
// Redesign 23 Jul: UI ala Airbnb (kalender inline custom, sel bulat;
// ringkasan kartu ber-shadow; CTA rose).
// 23 Jul: satu transaksi = SATU varian tiket — pilih card dulu, stepper qty
// muncul di card terpilih; state qty tetap Record agar payload items[] &
// flatten nama rombongan tidak berubah (isinya kini maksimal 1 entri).

import { useCallback, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Loader2,
  Minus,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { BookingCalendar } from "./booking-calendar";

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

const STEP_TITLES: Record<Step, { title: string; subtitle: string }> = {
  tanggal: {
    title: "Kapan mau berkunjung?",
    subtitle: "Pilih tanggal kunjunganmu — harga bisa berbeda per tanggal.",
  },
  tiket: {
    title: "Pilih tiketmu",
    subtitle:
      "Pilih satu jenis tiket lalu atur jumlahnya — 1 jenis tiket per transaksi.",
  },
  pemesan: {
    title: "Siapa yang memesan?",
    subtitle: "Kode booking & QR tiket dikirim lewat WhatsApp.",
  },
  ringkasan: {
    title: "Periksa pesananmu",
    subtitle: "Pastikan semuanya benar sebelum lanjut ke pembayaran.",
  },
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
  // Nama anggota per varian per unit (opsional) — kosong = default server
  // "Group {pemesan} - N"
  const [guestNames, setGuestNames] = useState<Record<string, string[]>>({});
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

  // 1 transaksi = 1 varian: pilih card → qty mulai dari 1, ganti card →
  // qty varian lama dibuang (state hanya menyimpan varian terpilih)
  const selectedVariantId = cart[0]?.variant.variant_id ?? null;

  const selectVariant = (variantId: string) => {
    if (variantId === selectedVariantId) return;
    setQty({ [variantId]: 1 });
    setGuestNames({});
  };

  const changeQty = (variantId: string, delta: number) => {
    setQty((prev) => {
      // Minimal 1 selama card terpilih — batal = pilih card lain
      const next = Math.max(1, (prev[variantId] ?? 1) + delta);
      const known = variantIndex.get(variantId);
      const persons = known ? next * personsPerUnit(known.variant) : next;
      if (persons > MAX_QTY_PER_BOOKING) return prev;
      return { [variantId]: next };
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
  const heading = STEP_TITLES[step];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-white md:max-w-2xl">
      {/* ── Header ala Airbnb: minimal, tombol kembali bulat ── */}
      <header className="sticky top-0 z-10 bg-white/95 px-5 pt-4 backdrop-blur">
        <div className="flex h-9 items-center">
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
              className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full text-gray-800 hover:bg-gray-100"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          {visitDate && step !== "tanggal" && (
            <span className="ml-auto rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700">
              {formatDateShort(visitDate)}
              {totalQty > 0 ? ` · ${totalQty} tiket` : ""}
            </span>
          )}
        </div>
        <div className="mt-3 flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-[3px] flex-1 rounded-full transition-colors ${
                i <= stepIndex ? "bg-gray-900" : "bg-gray-200"
              }`}
            />
          ))}
        </div>
      </header>

      <main className="flex-1 px-5 pb-32 pt-6">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-gray-900">
          {heading.title}
        </h1>
        <p className="mt-1.5 text-sm text-gray-500">{heading.subtitle}</p>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {step === "tanggal" && (
          <section className="mt-6">
            <div className="rounded-3xl border border-gray-200 p-5 shadow-[0_6px_16px_rgba(0,0,0,0.08)]">
              <BookingCalendar
                value={visitDate}
                minDate={minDate}
                maxDate={maxDate}
                onChange={setVisitDate}
              />
            </div>
            <div className="mt-4 flex items-center justify-between px-1">
              <p className="text-sm text-gray-500">
                {visitDate ? (
                  <span className="font-medium text-gray-900">
                    {formatDateLong(visitDate)}
                  </span>
                ) : (
                  "Belum ada tanggal dipilih"
                )}
              </p>
              {visitDate && (
                <button
                  type="button"
                  onClick={() => setVisitDate("")}
                  className="text-sm font-medium text-gray-500 underline hover:text-gray-900"
                >
                  Hapus
                </button>
              )}
            </div>
            <p className="mt-1 px-1 text-xs text-gray-400">
              Bisa dipesan untuk hari ini sampai {MAX_DAYS_AHEAD} hari ke depan.
            </p>
          </section>
        )}

        {step === "tiket" && (
          <section className="mt-6 space-y-4">
            {catalog.flatMap((product) =>
              product.variants.map((variant) => {
                const selected = variant.variant_id === selectedVariantId;
                const n = qty[variant.variant_id] ?? 0;
                const standalone = bundleStandaloneTotal(variant);
                const saving =
                  standalone !== null && standalone > variant.price
                    ? standalone - variant.price
                    : null;
                const variantLabel =
                  product.product_kind === "bundle"
                    ? `Paket (${variant.members?.length ?? 0} orang)`
                    : variant.variant_name;
                return (
                  <div
                    key={variant.variant_id}
                    role="radio"
                    aria-checked={selected}
                    tabIndex={0}
                    onClick={() => selectVariant(variant.variant_id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectVariant(variant.variant_id);
                      }
                    }}
                    className={`cursor-pointer overflow-hidden rounded-3xl border transition-all ${
                      selected
                        ? "border-rose-500 shadow-[0_6px_16px_rgba(244,63,94,0.15)] ring-1 ring-rose-500"
                        : "border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    {product.thumbnail_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.thumbnail_url}
                        alt={product.name}
                        className="aspect-[2/1] w-full object-cover"
                      />
                    )}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-[15px] font-semibold text-gray-900">
                            {product.name}
                          </h3>
                          <p className="mt-0.5 text-sm text-gray-600">
                            {variantLabel}
                            {variant.season_kind === "high" && (
                              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                High Season
                              </span>
                            )}
                          </p>
                        </div>
                        {/* Indikator radio */}
                        <span
                          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                            selected
                              ? "border-rose-500 bg-rose-500 text-white"
                              : "border-gray-300 text-transparent"
                          }`}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      </div>
                      {product.description && (
                        <p className="mt-2 text-sm leading-relaxed text-gray-500">
                          {product.description}
                        </p>
                      )}
                      {product.product_kind === "bundle" && variant.members ? (
                        <p className="mt-2 text-xs leading-snug text-gray-400">
                          Termasuk:{" "}
                          {Object.entries(
                            variant.members.reduce<Record<string, number>>(
                              (acc, m) => ({
                                ...acc,
                                [m.member_label]:
                                  (acc[m.member_label] ?? 0) + 1,
                              }),
                              {}
                            )
                          )
                            .map(([label, count]) => `${count}× ${label}`)
                            .join(", ")}
                        </p>
                      ) : null}
                      <p className="mt-3 text-sm">
                        {saving !== null ? (
                          <>
                            <span className="mr-1.5 text-xs text-gray-400 line-through">
                              {formatRp(standalone!)}
                            </span>
                            <span className="text-base font-semibold text-gray-900">
                              {formatRp(variant.price)}
                            </span>
                            <span className="ml-1.5 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600">
                              Hemat {formatRp(saving)}
                            </span>
                          </>
                        ) : (
                          <span className="text-base font-semibold text-gray-900">
                            {formatRp(variant.price)}
                          </span>
                        )}
                        <span className="text-gray-400"> / tiket</span>
                      </p>
                      {/* Qty muncul setelah card dipilih */}
                      {selected && (
                        <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4">
                          <span className="text-sm font-medium text-gray-900">
                            Jumlah tiket
                          </span>
                          <div className="flex shrink-0 items-center gap-3">
                            <button
                              type="button"
                              aria-label={`Kurangi ${variantLabel}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                changeQty(variant.variant_id, -1);
                              }}
                              disabled={n <= 1}
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-gray-600 transition-colors hover:border-gray-900 hover:text-gray-900 disabled:cursor-default disabled:opacity-25 disabled:hover:border-gray-300 disabled:hover:text-gray-600"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="w-6 text-center text-[15px] font-medium tabular-nums text-gray-900">
                              {n}
                            </span>
                            <button
                              type="button"
                              aria-label={`Tambah ${variantLabel}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                changeQty(variant.variant_id, 1);
                              }}
                              disabled={
                                (n + 1) * personsPerUnit(variant) >
                                MAX_QTY_PER_BOOKING
                              }
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-gray-600 transition-colors hover:border-gray-900 hover:text-gray-900 disabled:cursor-default disabled:opacity-25 disabled:hover:border-gray-300 disabled:hover:text-gray-600"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <p className="text-xs text-gray-400">
              1 jenis tiket per transaksi · maksimum {MAX_QTY_PER_BOOKING} tiket
              per pemesanan.
            </p>
          </section>
        )}

        {step === "pemesan" && (
          <section className="mt-6 space-y-6">
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

        {step === "ringkasan" && (
          <section className="mt-6 space-y-4">
            {/* Kartu ringkasan ber-shadow ala booking card Airbnb */}
            <div className="rounded-3xl border border-gray-200 p-5 shadow-[0_6px_16px_rgba(0,0,0,0.10)]">
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">Tanggal kunjungan</dt>
                  <dd className="font-medium text-gray-900">
                    {formatDateLong(visitDate)}
                  </dd>
                </div>
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

      {/* ── Bar bawah ala checkout Airbnb ── */}
      <footer className="fixed inset-x-0 bottom-0 z-10 mx-auto w-full max-w-lg border-t border-gray-200 bg-white px-5 py-3.5 md:max-w-2xl">
        {step === "tanggal" && (
          <button
            type="button"
            onClick={loadCatalog}
            disabled={!visitDate || loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-500 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-rose-600 disabled:opacity-40 disabled:hover:bg-rose-500"
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
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold tabular-nums text-gray-900">
                {formatRp(totalAmount)}
              </p>
              <p className="text-xs text-gray-500 underline">
                {totalQty} tiket · {formatDateShort(visitDate)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep("pemesan")}
              disabled={totalQty === 0}
              className="rounded-xl bg-rose-500 px-8 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-rose-600 disabled:opacity-40 disabled:hover:bg-rose-500"
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
