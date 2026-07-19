/**
 * Logika murni cicilan pinjaman karyawan (EPIC-008 Fase D).
 * - Pinjaman jatuh tempo: approved, aktif, ada sisa, dan cicilan pertama
 *   sudah/berjalan pada periode payroll.
 * - Potongan per periode = Σ min(cicilan bulanan, sisa) per pinjaman due.
 * - Alokasi pembayaran saat run PAID: urut pinjaman tertua dulu, per
 *   pinjaman maksimal min(cicilan, sisa), total dibatasi nominal terpotong.
 */

export interface LoanDeductionRow {
  id: string;
  monthly_installment: number;
  remaining_balance: number;
  first_installment_month: number | null;
  first_installment_year: number | null;
  status: string;
  is_active: boolean;
}

export interface LoanAllocation {
  loanId: string;
  amount: number;
  newRemaining: number;
  paidOff: boolean;
}

/** Apakah pinjaman menagih cicilan pada periode (month, year)? */
export function isLoanDue(
  loan: LoanDeductionRow,
  periodMonth: number,
  periodYear: number
): boolean {
  if (loan.status !== "approved" || !loan.is_active) return false;
  if (Number(loan.remaining_balance) <= 0) return false;
  if (Number(loan.monthly_installment) <= 0) return false;
  const m = loan.first_installment_month;
  const y = loan.first_installment_year;
  if (!m || !y) return false;
  return y < periodYear || (y === periodYear && m <= periodMonth);
}

/** Total potongan cicilan seorang karyawan untuk satu periode payroll. */
export function loanDeductionForPeriod(
  loans: LoanDeductionRow[],
  periodMonth: number,
  periodYear: number
): number {
  return loans
    .filter((loan) => isLoanDue(loan, periodMonth, periodYear))
    .reduce(
      (acc, loan) =>
        acc +
        Math.min(
          Math.round(Number(loan.monthly_installment)),
          Math.round(Number(loan.remaining_balance))
        ),
      0
    );
}

/**
 * Alokasikan nominal yang terpotong di slip ke pinjaman-pinjaman due
 * (urutan pemanggil: tertua dulu). Nominal bisa berbeda dari hitungan
 * terkini bila run dihitung sebelum data pinjaman berubah — karena itu
 * dibatasi `amount` DAN sisa masing-masing pinjaman.
 */
export function allocateLoanPayment(
  loans: LoanDeductionRow[],
  amount: number
): LoanAllocation[] {
  const allocations: LoanAllocation[] = [];
  let remainingAmount = Math.round(amount);
  for (const loan of loans) {
    if (remainingAmount <= 0) break;
    const balance = Math.round(Number(loan.remaining_balance));
    if (balance <= 0) continue;
    const installment = Math.round(Number(loan.monthly_installment));
    const pay = Math.min(installment, balance, remainingAmount);
    if (pay <= 0) continue;
    const newRemaining = balance - pay;
    allocations.push({
      loanId: loan.id,
      amount: pay,
      newRemaining,
      paidOff: newRemaining <= 0,
    });
    remainingAmount -= pay;
  }
  return allocations;
}

/**
 * Validasi limit pinjaman (dipakai saat pengajuan & approval):
 * cicilan/bulan maks % dari gaji pokok + jumlah pinjaman aktif maks.
 * Return pesan error, atau null bila lolos.
 */
export function validateLoanLimits(params: {
  monthlyInstallment: number;
  baseSalary: number | null;
  maxInstallmentPercent: number;
  activeLoanCount: number;
  maxActiveLoans: number;
}): string | null {
  const {
    monthlyInstallment,
    baseSalary,
    maxInstallmentPercent,
    activeLoanCount,
    maxActiveLoans,
  } = params;

  if (activeLoanCount >= maxActiveLoans) {
    return `Karyawan sudah punya ${activeLoanCount} pinjaman aktif (maks ${maxActiveLoans})`;
  }
  if (baseSalary === null || baseSalary <= 0) {
    return "Karyawan belum punya struktur gaji aktif — atur gaji dulu sebelum mengajukan pinjaman";
  }
  const maxInstallment = (baseSalary * maxInstallmentPercent) / 100;
  if (monthlyInstallment > maxInstallment) {
    return (
      `Cicilan Rp ${Math.round(monthlyInstallment).toLocaleString("id-ID")}/bulan melebihi batas ` +
      `${maxInstallmentPercent}% dari gaji pokok (maks Rp ${Math.round(maxInstallment).toLocaleString("id-ID")})`
    );
  }
  return null;
}
