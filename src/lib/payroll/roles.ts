/**
 * Role yang berhak mengelola payroll (run, kalkulasi, pengaturan, slip HR).
 * Data gaji adalah PII finansial — jangan longgarkan tanpa review keamanan.
 */

export const PAYROLL_MANAGE_ROLES = [
  'super_admin',
  'hrd',
  'finance_staff',
] as const;

/** Pengubahan tarif statutori (BPJS/PPh21) dibatasi lebih ketat. */
export const PAYROLL_SETTINGS_WRITE_ROLES = ['super_admin', 'hrd'] as const;

/**
 * Kelola pinjaman karyawan — termasuk 'admin' (selaras menu
 * hris.compensation.loans & page guard); run payroll tetap 3 role di atas.
 */
export const LOAN_MANAGE_ROLES = [
  'super_admin',
  'admin',
  'hrd',
  'finance_staff',
] as const;
