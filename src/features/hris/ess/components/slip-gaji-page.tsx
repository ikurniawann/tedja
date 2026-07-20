"use client";

import {
  loanInstallmentLabel,
  type LoanInstallmentDetail,
} from "@/lib/payroll/loans";
import { useEffect, useState } from "react";
import { BanknotesIcon, DocumentTextIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { prorateNote } from "@/lib/payroll/prorate-note";

/**
 * ESS → Slip Gaji (/dashboard/me/slip-gaji): karyawan melihat slip gajinya
 * SENDIRI dari run payroll yang sudah dibayar (di-enforce server di
 * /api/hris/payslips). EPIC-008 Fase E.
 */

interface MeData {
  employee: { id: string; full_name: string } | null;
}

interface PayslipRow {
  id: string;
  base_salary: number;
  fixed_allowance: number;
  variable_allowance: number;
  transport_allowance: number;
  meal_allowance: number;
  housing_allowance: number;
  overtime_pay: number;
  thr: number;
  bonus: number;
  gross_salary: number;
  bpjs_tk_jht_deduction: number;
  bpjs_tk_jp_deduction: number;
  bpjs_kes_deduction: number;
  tapera_deduction: number;
  pph21_deduction: number;
  unpaid_leave_deduction: number;
  late_deduction?: number;
  loan_deduction?: number;
  loan_details?: LoanInstallmentDetail[];
  other_deduction: number;
  total_deductions: number;
  net_salary: number;
  working_days: number;
  present_days: number;
  late_days: number;
  overtime_hours?: number;
  /** Faktor proraté cakupan kontrak (0..1); pg numeric datang sebagai string */
  prorate_factor?: number | string;
  /** Snapshot gaji pokok penuh sebelum proraté (null utk baris lama) */
  full_base_salary?: number | string | null;
  payroll_run?: {
    id: string;
    period_month: number;
    period_year: number;
    status: string;
    paid_at: string | null;
  } | null;
}

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function formatCurrency(amount: number | undefined): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

function periodLabel(slip: PayslipRow): string {
  const run = slip.payroll_run;
  if (!run) return "—";
  return `${MONTHS[(run.period_month ?? 1) - 1]} ${run.period_year}`;
}

interface RowProps {
  label: string;
  amount: number | undefined;
  bold?: boolean;
  negative?: boolean;
}

function AmountRow({ label, amount, bold, negative }: RowProps) {
  if (!bold && !(Number(amount) > 0)) return null;
  return (
    <div className={`flex justify-between py-1 text-sm ${bold ? "font-semibold" : ""}`}>
      <span className="text-gray-600">{label}</span>
      <span className={negative ? "text-red-600" : "text-gray-900"}>
        {negative ? "− " : ""}
        {formatCurrency(amount)}
      </span>
    </div>
  );
}

export function EssSlipGajiPage() {
  const [me, setMe] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [slips, setSlips] = useState<PayslipRow[]>([]);
  const [selected, setSelected] = useState<PayslipRow | null>(null);
  const selectedProrateNote = selected
    ? prorateNote({
        factor: selected.prorate_factor,
        fullBase: selected.full_base_salary,
        paidBase: selected.base_salary,
      })
    : null;

  useEffect(() => {
    Promise.all([
      fetch("/api/hris/me").then((res) => (res.ok ? res.json() : null)),
      fetch("/api/hris/payslips?employee_id=me").then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([meJson, slipJson]) => {
        setMe(meJson?.data ?? null);
        setSlips(slipJson?.data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!me?.employee) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-lg font-semibold text-gray-800">
          Akun ini tidak terhubung ke data karyawan
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Slip gaji hanya tersedia untuk akun yang tertaut ke record karyawan
          HRIS. Hubungi HRD bila menurut Anda ini keliru.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <BanknotesIcon className="h-6 w-6 text-pink-600" /> Slip Gaji
        </h1>
        <p className="text-sm text-gray-500">
          Slip gaji Anda dari periode yang sudah dibayarkan
        </p>
      </div>

      {slips.length === 0 ? (
        <div className="rounded-xl border border-gray-200/70 bg-white p-10 text-center shadow-sm">
          <DocumentTextIcon className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            Belum ada slip gaji yang terbit. Slip muncul di sini setelah
            payroll periode berjalan dibayarkan.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {slips.map((slip) => (
            <li key={slip.id}>
              <button
                type="button"
                onClick={() => setSelected(slip)}
                className="w-full rounded-xl border border-gray-200/70 bg-white p-5 text-left shadow-sm transition hover:border-pink-300 hover:shadow"
              >
                <p className="text-sm font-semibold text-gray-800">{periodLabel(slip)}</p>
                <p className="mt-2 text-2xl font-bold text-gray-900">
                  {formatCurrency(slip.net_salary)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Take home pay · bruto {formatCurrency(slip.gross_salary)}
                </p>
                <p className="mt-2 text-xs text-gray-400">
                  {slip.present_days}/{slip.working_days} hari hadir
                  {Number(slip.overtime_hours) > 0 ? ` · lembur ${Number(slip.overtime_hours)} jam` : ""}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Slip Gaji — {selected ? periodLabel(selected) : ""}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Penghasilan
                </p>
                <AmountRow label="Gaji Pokok" amount={selected.base_salary} />
                {selectedProrateNote && (
                  <p className="text-xs italic text-amber-700">
                    {selectedProrateNote}
                  </p>
                )}
                <AmountRow label="Tunjangan Tetap" amount={selected.fixed_allowance} />
                <AmountRow label="Tunjangan Variabel" amount={selected.variable_allowance} />
                <AmountRow label="Tunjangan Transport" amount={selected.transport_allowance} />
                <AmountRow label="Tunjangan Makan" amount={selected.meal_allowance} />
                <AmountRow label="Tunjangan Perumahan" amount={selected.housing_allowance} />
                <AmountRow label="Lembur" amount={selected.overtime_pay} />
                <AmountRow label="THR" amount={selected.thr} />
                <AmountRow label="Bonus" amount={selected.bonus} />
                <div className="border-t pt-1">
                  <AmountRow label="Total Bruto" amount={selected.gross_salary} bold />
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Potongan
                </p>
                <AmountRow label="BPJS TK (JHT)" amount={selected.bpjs_tk_jht_deduction} negative />
                <AmountRow label="BPJS TK (JP)" amount={selected.bpjs_tk_jp_deduction} negative />
                <AmountRow label="BPJS Kesehatan" amount={selected.bpjs_kes_deduction} negative />
                <AmountRow label="Tapera" amount={selected.tapera_deduction} negative />
                <AmountRow label="PPh 21" amount={selected.pph21_deduction} negative />
                <AmountRow label="Cuti Tanpa Bayaran" amount={selected.unpaid_leave_deduction} negative />
                <AmountRow label="Potongan Keterlambatan" amount={selected.late_deduction} negative />
                {(selected.loan_details?.length ?? 0) > 0 ? (
                  selected.loan_details!.map((loan) => (
                    <AmountRow
                      key={loan.loan_id}
                      label={loanInstallmentLabel(loan)}
                      amount={loan.amount}
                      negative
                    />
                  ))
                ) : (
                  <AmountRow label="Cicilan Pinjaman" amount={selected.loan_deduction} negative />
                )}
                <AmountRow label="Potongan Lain" amount={selected.other_deduction} negative />
                <div className="border-t pt-1">
                  <AmountRow label="Total Potongan" amount={selected.total_deductions} bold negative />
                </div>
              </div>

              <div className="rounded-lg bg-pink-50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">
                    Gaji Diterima (Take Home Pay)
                  </span>
                  <span className="text-lg font-bold text-pink-700">
                    {formatCurrency(selected.net_salary)}
                  </span>
                </div>
              </div>

              <p className="text-xs text-gray-400">
                Kehadiran: {selected.present_days}/{selected.working_days} hari
                {selected.late_days > 0 ? ` · terlambat ${selected.late_days}×` : ""}
                {Number(selected.overtime_hours) > 0
                  ? ` · lembur ${Number(selected.overtime_hours)} jam`
                  : ""}
                . Ada pertanyaan tentang slip ini? Hubungi HRD.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
