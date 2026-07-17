/**
 * Payroll Module Exports
 */

export {
  calculatePayroll,
  calculatePPh21ETR,
  calculateBPJS,
  calculateTHR,
  calculateOvertime,
  calculateUnpaidLeave,
  calculateLateDeduction,
  calculateJabatanExpense,
  getPTKPAmount,
} from './calculator';

export {
  eachDateOfPeriod,
  countScheduledDays,
  clampedLeaveDays,
  realizedOvertimeHours,
  computeLateStats,
  overtimeHoursFromTimes,
} from './period';

export type {
  PayrollInput,
  PayrollResult,
  BPJSEnrollment,
} from './calculator';

export {
  loadEmployeePayrollInput,
  calculatePayrollForEmployee,
} from './inputs';

export {
  loadPayrollConfig,
  cumulativeLimitsToBrackets,
  DEFAULT_PAYROLL_CONFIG,
} from './config';

export type { PayrollConfig, PPh21Bracket } from './config';
