"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { ToastContainer, useToast } from "@/components/ui/toast";
import { apiGet, apiPut } from "@/lib/api-client";

/**
 * Tab "Jadwal Shift" di detail karyawan — HRD/Super Admin mengatur pola
 * shift mingguan (Senin–Minggu) per karyawan, berlaku sejak tanggal
 * tertentu. Absensi karyawan dinilai (terlambat/tidak) terhadap jadwal ini.
 */

interface ShiftOption {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

interface ScheduleRow {
  id: string;
  day_of_week: number;
  shift_id: string | null;
  effective_from: string;
  effective_to: string | null;
  shift_name: string | null;
  start_time: string | null;
  end_time: string | null;
}

const DAY_NAMES = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
const OFF_VALUE = "off";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function EmployeeShiftsTab({ employeeId }: { employeeId: string }) {
  const { toasts, showToast, removeToast } = useToast();
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [history, setHistory] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  // pattern[hari 1-7] = shift_id | "off"
  const [pattern, setPattern] = useState<Record<number, string>>(
    Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, OFF_VALUE]))
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiGet<{ data: ShiftOption[] }>("/api/hris/shifts"),
      apiGet<{ data: ScheduleRow[] }>(`/api/hris/employees/${employeeId}/shifts`),
    ])
      .then(([shiftRes, scheduleRes]) => {
        if (cancelled) return;
        setShifts((shiftRes.data ?? []).filter((s) => s.is_active));
        const rows = scheduleRes.data ?? [];
        setHistory(rows);
        // pola berjalan hari ini = baris efektif terbaru per hari
        const now = today();
        const current: Record<number, string> = { ...pattern };
        for (let day = 1; day <= 7; day++) {
          const active = rows
            .filter(
              (r) =>
                r.day_of_week === day &&
                r.effective_from <= now &&
                (r.effective_to === null || r.effective_to >= now)
            )
            .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
          current[day] = active?.shift_id ?? OFF_VALUE;
        }
        setPattern(current);
      })
      .catch(() => showToast("Gagal memuat jadwal", "error"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const shiftOptions = useMemo(
    () => [
      { value: OFF_VALUE, label: "Libur" },
      ...shifts.map((s) => ({
        value: s.id,
        label: `${s.name} (${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)})`,
      })),
    ],
    [shifts]
  );

  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiPut<{ message: string }>(
        `/api/hris/employees/${employeeId}/shifts`,
        {
          effective_from: effectiveFrom,
          days: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
            day_of_week: day,
            shift_id: pattern[day] === OFF_VALUE ? null : pattern[day],
          })),
        }
      );
      showToast(res.message ?? "Jadwal disimpan");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Gagal menyimpan", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const hasHistory = history.length > 0;

  return (
    <div className="space-y-5">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div>
        <h3 className="text-sm font-semibold text-gray-800">Pola Shift Mingguan</h3>
        <p className="text-xs text-gray-500">
          Absensi karyawan dinilai terhadap jadwal ini (terlambat dihitung dari jam mulai
          shift + toleransi). Perubahan disimpan sebagai pola baru — riwayat lama tetap
          tercatat.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {DAY_NAMES.map((name, index) => {
          const day = index + 1;
          return (
            <div
              key={day}
              className="flex items-center justify-between gap-3 rounded-lg border border-gray-200/70 bg-white px-3 py-2"
            >
              <span className="w-16 text-sm font-medium text-gray-700">{name}</span>
              <Combobox
                options={shiftOptions}
                value={pattern[day]}
                onChange={(value) => setPattern((p) => ({ ...p, [day]: value }))}
                placeholder="Pilih shift"
                className="flex-1"
              />
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Berlaku mulai
          </label>
          <Input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="w-44"
          />
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan Jadwal"}
        </Button>
      </div>

      {hasHistory && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Riwayat pola
          </h4>
          <ul className="space-y-0.5 text-xs text-gray-500">
            {[...new Set(history.map((r) => r.effective_from))].slice(0, 5).map((from) => {
              const rows = history.filter((r) => r.effective_from === from);
              const to = rows[0]?.effective_to;
              const summary = rows
                .filter((r) => r.shift_name)
                .map((r) => `${DAY_NAMES[r.day_of_week - 1].slice(0, 3)} ${r.shift_name}`)
                .join(", ");
              return (
                <li key={from}>
                  {from} {to ? `s.d. ${to}` : "(berjalan)"} — {summary || "libur semua"}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
