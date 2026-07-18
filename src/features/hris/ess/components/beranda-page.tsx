"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  MegaphoneIcon,
  CalendarDaysIcon,
  BanknotesIcon,
  ClockIcon,
  ArrowRightIcon,
  BriefcaseIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { EssClockPanel } from "./ess-clock-panel";

/**
 * Beranda Karyawan (/dashboard/me): ringkasan "hari saya" — profil, absensi
 * hari ini + clock, saldo cuti/kehadiran/slip/pinjaman, jadwal minggu ini,
 * pengumuman terbaru, status pengajuan, aksi cepat, ringkas KPI. Semua data
 * dari satu endpoint agregasi /api/hris/me/beranda.
 */

// ── Tipe respons endpoint ──
interface Employee {
  full_name: string;
  nip: string | null;
  join_date: string | null;
  employment_status: string;
  position_title: string | null;
  department_name: string | null;
}
interface LeaveBalance {
  annual_leave_total: string;
  annual_leave_used: string;
  annual_leave_remaining: string;
}
interface TodayShift {
  name: string;
  start_time: string | null;
  end_time: string | null;
  late_tolerance_minutes: number;
}
interface DaySchedule {
  date: string;
  day_of_week: number;
  is_today: boolean;
  status: "shift" | "libur" | "none";
  shift_name: string | null;
  start_time: string | null;
  end_time: string | null;
}
interface RecentRequest {
  kind: "cuti" | "lembur" | "pinjaman";
  id: string;
  label: string;
  detail: string;
  status: string;
  created_at: string;
  href: string;
}
interface AnnouncementItem {
  id: string;
  title: string;
  cover_image_url: string | null;
  tags: string[];
  is_pinned: boolean;
  publish_at: string | null;
  created_at: string;
  is_read: boolean;
}
interface Beranda {
  employee: Employee | null;
  leave_balance: LeaveBalance | null;
  today_shift: TodayShift | null;
  has_schedule: boolean;
  week_schedule: DaySchedule[];
  attendance: {
    month: number;
    present: number;
    late: number;
    off_schedule: number;
    avg_work_hours: number | null;
    clocked_in_today: boolean;
  };
  latest_payslip: {
    net_salary: number;
    run_name: string | null;
    period_month: number;
    period_year: number;
    paid_at: string | null;
  } | null;
  active_loans: { count: number; total_remaining: number; monthly_installment: number };
  recent_requests: RecentRequest[];
  announcements: { items: AnnouncementItem[]; unread: number; total: number };
  kpi: { count: number; avg_achievement: number | null; avg_score: number | null } | null;
}

// ── Helper tampilan ──
const DAY_LABELS = ["", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const MONTH_LABELS = [
  "", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const LEAVE_TYPE_LABELS: Record<string, string> = {
  annual: "Cuti Tahunan", sick: "Sakit", maternity: "Melahirkan",
  paternity: "Cuti Ayah", unpaid: "Tanpa Gaji", emergency: "Darurat",
  pilgrimage: "Ibadah", menstrual: "Haid", marriage: "Menikah", bereavement: "Duka",
};

function greeting(): string {
  const h = new Date(Date.now() + 7 * 3600_000).getUTCHours();
  if (h < 11) return "Selamat pagi";
  if (h < 15) return "Selamat siang";
  if (h < 18) return "Selamat sore";
  return "Selamat malam";
}

function initials(name: string): string {
  return name.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function rupiah(value: number): string {
  return `Rp ${value.toLocaleString("id-ID")}`;
}

function tenure(joinDate: string | null): string {
  if (!joinDate) return "-";
  const start = new Date(`${joinDate}T00:00:00Z`);
  const now = new Date();
  let months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth());
  if (months < 0) months = 0;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y > 0 ? `${y} thn` : "", m > 0 ? `${m} bln` : "", !y && !m ? "Baru bergabung" : ""].filter(Boolean).join(" ");
}

function statusBadge(status: string): { label: string; cls: string } {
  const s = status.toLowerCase();
  if (["pending", "menunggu"].includes(s)) return { label: "Menunggu", cls: "bg-amber-100 text-amber-700" };
  if (["approved", "disetujui", "paid", "confirmed"].includes(s)) return { label: s === "paid" ? "Dibayar" : "Disetujui", cls: "bg-green-100 text-green-700" };
  if (["rejected", "ditolak", "cancelled", "canceled"].includes(s)) return { label: s.startsWith("cancel") ? "Dibatalkan" : "Ditolak", cls: "bg-red-100 text-red-700" };
  return { label: status, cls: "bg-gray-100 text-gray-600" };
}

const KIND_META: Record<RecentRequest["kind"], { label: string; cls: string }> = {
  cuti: { label: "Cuti", cls: "bg-indigo-100 text-indigo-700" },
  lembur: { label: "Lembur", cls: "bg-sky-100 text-sky-700" },
  pinjaman: { label: "Pinjaman", cls: "bg-emerald-100 text-emerald-700" },
};

// ── Sub-komponen kecil ──
function StatCard({
  href, icon, label, value, sub, accent,
}: {
  href: string; icon: React.ReactNode; label: string; value: string; sub?: string; accent: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-xl border border-gray-200/70 bg-white p-4 shadow-sm transition hover:border-pink-300 hover:shadow"
    >
      <div className="flex items-center justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent}`}>{icon}</span>
        <ChevronRightIcon className="h-4 w-4 text-gray-300 transition group-hover:text-pink-400" />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs font-medium text-gray-500">{label}</p>
        {sub && <p className="mt-0.5 text-[11px] text-gray-400">{sub}</p>}
      </div>
    </Link>
  );
}

function QuickAction({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-200/70 bg-white px-3 py-3 text-center shadow-sm transition hover:border-pink-300 hover:bg-pink-50/40"
    >
      <span className="text-pink-600">{icon}</span>
      <span className="text-[11px] font-semibold text-gray-600">{label}</span>
    </Link>
  );
}

export function EssBerandaPage() {
  const [data, setData] = useState<Beranda | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch("/api/hris/me/beranda")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setData(json?.data ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const leaveRemaining = useMemo(() => {
    const b = data?.leave_balance;
    return b ? Number(b.annual_leave_remaining) : null;
  }, [data]);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // Akun tak tertaut record karyawan (mis. super admin murni)
  if (!data || !data.employee) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
        <BriefcaseIcon className="mx-auto h-10 w-10 text-amber-400" />
        <p className="mt-3 font-semibold text-amber-800">Akun belum terhubung ke data karyawan</p>
        <p className="mt-1 text-sm text-amber-600">
          Beranda karyawan hanya tersedia untuk akun yang tertaut ke record kepegawaian.
        </p>
      </div>
    );
  }

  const emp = data.employee;
  const { attendance, today_shift, latest_payslip, active_loans, kpi } = data;

  return (
    <div className="space-y-6">
      {/* ── Header sapaan + profil ── */}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-pink-600 via-pink-500 to-indigo-500 p-5 text-white shadow-md sm:p-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 text-lg font-bold ring-2 ring-white/40 backdrop-blur-sm">
            {initials(emp.full_name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white/80">{greeting()},</p>
            <h1 className="truncate text-xl font-bold sm:text-2xl">{emp.full_name}</h1>
            <p className="mt-0.5 truncate text-sm text-white/85">
              {[emp.position_title, emp.department_name].filter(Boolean).join(" · ") || "Karyawan"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-semibold capitalize backdrop-blur-sm">
              {emp.employment_status?.replace(/_/g, " ") || "-"}
            </span>
            <span className="text-[11px] text-white/75">
              {emp.nip ? `NIP ${emp.nip} · ` : ""}Masa kerja {tenure(emp.join_date)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Absensi hari ini + clock ── */}
      <div className="rounded-2xl border border-gray-200/70 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <ClockIcon className="h-5 w-5 text-pink-600" /> Absensi Hari Ini
          </h2>
          {today_shift ? (
            <span className="text-xs text-gray-500">
              Shift <b className="text-gray-700">{today_shift.name}</b>
              {today_shift.start_time && today_shift.end_time
                ? ` · ${today_shift.start_time.slice(0, 5)}–${today_shift.end_time.slice(0, 5)}`
                : ""}
              {today_shift.late_tolerance_minutes
                ? ` · toleransi ${today_shift.late_tolerance_minutes} mnt`
                : ""}
            </span>
          ) : (
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
              {data.has_schedule ? "Libur / tanpa shift hari ini" : "Belum ada jadwal shift"}
            </span>
          )}
        </div>
        <EssClockPanel onChanged={load} />
      </div>

      {/* ── Ringkasan cepat ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          href="/dashboard/me/cuti"
          icon={<CalendarDaysIcon className="h-5 w-5 text-indigo-600" />}
          accent="bg-indigo-50"
          label="Sisa Cuti Tahunan"
          value={leaveRemaining !== null ? `${leaveRemaining} hari` : "-"}
          sub={
            data.leave_balance
              ? `Terpakai ${data.leave_balance.annual_leave_used} / ${data.leave_balance.annual_leave_total} hari`
              : "Belum ada kuota"
          }
        />
        <StatCard
          href="/dashboard/me/absensi"
          icon={<ClockIcon className="h-5 w-5 text-pink-600" />}
          accent="bg-pink-50"
          label={`Kehadiran ${MONTH_LABELS[attendance.month]}`}
          value={`${attendance.present} hari`}
          sub={`${attendance.late} terlambat${attendance.avg_work_hours ? ` · avg ${attendance.avg_work_hours} jam` : ""}`}
        />
        <StatCard
          href="/dashboard/me/slip-gaji"
          icon={<BanknotesIcon className="h-5 w-5 text-emerald-600" />}
          accent="bg-emerald-50"
          label="Slip Gaji Terakhir"
          value={latest_payslip ? rupiah(latest_payslip.net_salary) : "-"}
          sub={
            latest_payslip
              ? `${MONTH_LABELS[latest_payslip.period_month]} ${latest_payslip.period_year}`
              : "Belum ada slip dibayar"
          }
        />
        <StatCard
          href="/dashboard/me/pinjaman"
          icon={<BanknotesIcon className="h-5 w-5 text-amber-600" />}
          accent="bg-amber-50"
          label="Pinjaman Aktif"
          value={active_loans.count > 0 ? rupiah(active_loans.total_remaining) : "Tidak ada"}
          sub={
            active_loans.count > 0
              ? `${active_loans.count} pinjaman · cicilan ${rupiah(active_loans.monthly_installment)}/bln`
              : "Tidak ada tanggungan"
          }
        />
      </div>

      {/* ── Jadwal minggu ini ── */}
      {data.week_schedule?.length > 0 && (
        <div className="rounded-2xl border border-gray-200/70 bg-white p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900">
            <CalendarDaysIcon className="h-5 w-5 text-pink-600" /> Jadwal Minggu Ini
          </h2>
          <div className="grid grid-cols-7 gap-2">
            {data.week_schedule.map((d) => (
              <div
                key={d.date}
                className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-center ${
                  d.is_today ? "border-pink-300 bg-pink-50" : "border-gray-200/70 bg-gray-50/50"
                }`}
              >
                <span className={`text-[11px] font-semibold ${d.is_today ? "text-pink-600" : "text-gray-400"}`}>
                  {DAY_LABELS[d.day_of_week]}
                </span>
                <span className="text-sm font-bold text-gray-700">{d.date.slice(8, 10)}</span>
                {d.status === "shift" ? (
                  <span className="text-[9px] font-medium leading-tight text-gray-500">
                    {d.start_time?.slice(0, 5)}
                  </span>
                ) : (
                  <span className="text-[9px] font-medium leading-tight text-gray-300">
                    {d.status === "libur" ? "Libur" : "—"}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Pengumuman + Pengajuan ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Pengumuman terbaru */}
        <div className="rounded-2xl border border-gray-200/70 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
              <MegaphoneIcon className="h-5 w-5 text-pink-600" /> Pengumuman
              {data.announcements.unread > 0 && (
                <span className="rounded-full bg-pink-600 px-1.5 text-[11px] font-bold text-white">
                  {data.announcements.unread}
                </span>
              )}
            </h2>
            <Link href="/dashboard/me/pengumuman" className="flex items-center gap-1 text-xs font-semibold text-pink-600 hover:underline">
              Lihat semua <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
          </div>
          {data.announcements.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">Belum ada pengumuman.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.announcements.items.map((a) => (
                <li key={a.id}>
                  <Link href="/dashboard/me/pengumuman" className="flex items-center gap-3 py-2.5 transition hover:opacity-80">
                    {!a.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-pink-600" />}
                    <span className={`min-w-0 flex-1 truncate text-sm ${a.is_read ? "text-gray-500" : "font-semibold text-gray-900"}`}>
                      {a.is_pinned && "📌 "}
                      {a.title}
                    </span>
                    {!a.is_read && (
                      <span className="shrink-0 rounded-full bg-pink-100 px-1.5 py-0.5 text-[10px] font-bold text-pink-600">Baru</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Status pengajuan saya */}
        <div className="rounded-2xl border border-gray-200/70 bg-white p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900">
            <BriefcaseIcon className="h-5 w-5 text-pink-600" /> Status Pengajuan Saya
          </h2>
          {data.recent_requests.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">Belum ada pengajuan.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.recent_requests.map((r) => {
                const badge = statusBadge(r.status);
                const kind = KIND_META[r.kind];
                return (
                  <li key={`${r.kind}-${r.id}`}>
                    <Link href={r.href} className="flex items-center gap-2 py-2.5 transition hover:opacity-80">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${kind.cls}`}>{kind.label}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium capitalize text-gray-800">
                          {LEAVE_TYPE_LABELS[r.label] ?? r.label}
                        </span>
                        <span className="block truncate text-[11px] text-gray-400">{r.detail}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── Ringkas KPI (fase 2) ── */}
      {kpi && (
        <div className="rounded-2xl border border-gray-200/70 bg-white p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900">
            <BriefcaseIcon className="h-5 w-5 text-pink-600" /> Kinerja (KPI) Terakhir
          </h2>
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-3xl font-bold text-gray-900">
                {kpi.avg_achievement !== null ? `${kpi.avg_achievement}%` : "-"}
              </p>
              <p className="text-xs text-gray-500">Rata-rata pencapaian</p>
            </div>
            <div className="h-10 w-px bg-gray-200" />
            <div>
              <p className="text-3xl font-bold text-gray-900">{kpi.avg_score ?? "-"}</p>
              <p className="text-xs text-gray-500">Skor rata-rata (1–5)</p>
            </div>
            <div className="h-10 w-px bg-gray-200" />
            <div>
              <p className="text-3xl font-bold text-gray-900">{kpi.count}</p>
              <p className="text-xs text-gray-500">Indikator dinilai</p>
            </div>
          </div>
          {kpi.avg_achievement !== null && (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-pink-500 to-indigo-500"
                style={{ width: `${Math.min(100, kpi.avg_achievement)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Aksi cepat ── */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-gray-500">Aksi Cepat</h2>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <QuickAction href="/dashboard/me/absensi" label="Absensi" icon={<ClockIcon className="h-6 w-6" />} />
          <QuickAction href="/dashboard/me/cuti" label="Ajukan Cuti" icon={<CalendarDaysIcon className="h-6 w-6" />} />
          <QuickAction href="/dashboard/me/lembur" label="Lembur" icon={<ClockIcon className="h-6 w-6" />} />
          <QuickAction href="/dashboard/me/pinjaman" label="Pinjaman" icon={<BanknotesIcon className="h-6 w-6" />} />
          <QuickAction href="/dashboard/me/slip-gaji" label="Slip Gaji" icon={<BanknotesIcon className="h-6 w-6" />} />
          <QuickAction href="/dashboard/me/pengumuman" label="Pengumuman" icon={<MegaphoneIcon className="h-6 w-6" />} />
        </div>
      </div>
    </div>
  );
}
