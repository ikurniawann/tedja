"use client";

// Kalender inline ala Airbnb untuk wizard booking publik: grid bulan dengan
// sel bulat, tanggal terpilih lingkaran solid gelap, tanggal di luar
// rentang dinonaktifkan. 1 bulan di mobile, 2 bulan berdampingan di md+.
// Semua hitungan tanggal pakai UTC dari string ISO — bebas jebakan zona
// waktu lokal (pola todayIso/addDaysIso wizard).

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

// Minggu dimulai Senin (kebiasaan kalender Indonesia)
const WEEKDAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

const toIso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Indeks bulan absolut (tahun×12+bulan) — memudahkan banding antar bulan. */
const monthIndexOf = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return y * 12 + (m - 1);
};

interface MonthGridProps {
  year: number;
  month: number; // 0-11
  value: string;
  minDate: string;
  maxDate: string;
  onSelect: (iso: string) => void;
}

function MonthGrid({ year, month, value, minDate, maxDate, onSelect }: MonthGridProps) {
  const cells = useMemo(() => {
    const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay(); // 0=Min
    const leading = (firstDow + 6) % 7; // geser agar Senin = 0
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const list: (number | null)[] = Array.from({ length: leading }, () => null);
    for (let d = 1; d <= daysInMonth; d++) list.push(d);
    return list;
  }, [year, month]);

  return (
    <div className="w-full">
      <p className="mb-4 text-center text-sm font-semibold text-gray-900">
        {MONTH_NAMES[month]} {year}
      </p>
      <div className="grid grid-cols-7 gap-y-0.5">
        {WEEKDAY_LABELS.map((label) => (
          <span
            key={label}
            className="pb-1 text-center text-[11px] font-medium text-gray-400"
          >
            {label}
          </span>
        ))}
        {cells.map((day, index) => {
          if (day === null) return <span key={`x-${index}`} />;
          const iso = toIso(year, month, day);
          const disabled = iso < minDate || iso > maxDate;
          const selected = iso === value;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => !disabled && onSelect(iso)}
              disabled={disabled}
              aria-label={iso}
              aria-pressed={selected}
              className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full text-sm tabular-nums transition-colors ${
                selected
                  ? "bg-gray-900 font-semibold text-white"
                  : disabled
                    ? "cursor-default text-gray-300"
                    : "font-medium text-gray-800 hover:ring-1 hover:ring-inset hover:ring-gray-900"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface BookingCalendarProps {
  value: string; // ISO atau ""
  minDate: string;
  maxDate: string;
  onChange: (iso: string) => void;
}

export function BookingCalendar({ value, minDate, maxDate, onChange }: BookingCalendarProps) {
  // Mulai dari bulan tanggal terpilih (atau bulan minDate)
  const [viewIndex, setViewIndex] = useState(() =>
    monthIndexOf(value || minDate)
  );
  const minIndex = monthIndexOf(minDate);
  const maxIndex = monthIndexOf(maxDate);

  const clamp = (i: number) => Math.min(Math.max(i, minIndex), maxIndex);
  const first = { year: Math.floor(viewIndex / 12), month: viewIndex % 12 };
  const secondIndex = viewIndex + 1;
  const second = { year: Math.floor(secondIndex / 12), month: secondIndex % 12 };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Bulan sebelumnya"
        onClick={() => setViewIndex((i) => clamp(i - 1))}
        disabled={viewIndex <= minIndex}
        className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 disabled:opacity-25"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Bulan berikutnya"
        onClick={() => setViewIndex((i) => clamp(i + 1))}
        disabled={viewIndex >= maxIndex}
        className="absolute right-0 top-0 flex h-8 w-8 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 disabled:opacity-25"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <div className="flex gap-8">
        <MonthGrid
          {...first}
          value={value}
          minDate={minDate}
          maxDate={maxDate}
          onSelect={onChange}
        />
        {secondIndex <= maxIndex ? (
          <div className="hidden w-full md:block">
            <MonthGrid
              {...second}
              value={value}
              minDate={minDate}
              maxDate={maxDate}
              onSelect={onChange}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
