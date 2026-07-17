import { describe, it, expect } from "vitest";
import {
  isLoanDue,
  loanDeductionForPeriod,
  allocateLoanPayment,
  validateLoanLimits,
  type LoanDeductionRow,
} from "./loans";

function loan(overrides: Partial<LoanDeductionRow> = {}): LoanDeductionRow {
  return {
    id: "loan-1",
    monthly_installment: 500_000,
    remaining_balance: 3_000_000,
    first_installment_month: 6,
    first_installment_year: 2026,
    status: "approved",
    is_active: true,
    ...overrides,
  };
}

describe("isLoanDue", () => {
  it("is due from the first installment period onward", () => {
    expect(isLoanDue(loan(), 6, 2026)).toBe(true);
    expect(isLoanDue(loan(), 12, 2026)).toBe(true);
    expect(isLoanDue(loan(), 1, 2027)).toBe(true);
  });

  it("is not due before the first installment period", () => {
    expect(isLoanDue(loan(), 5, 2026)).toBe(false);
    expect(isLoanDue(loan({ first_installment_year: 2027 }), 12, 2026)).toBe(false);
  });

  it("is not due when pending/rejected/inactive/zero balance/missing schedule", () => {
    expect(isLoanDue(loan({ status: "pending" }), 6, 2026)).toBe(false);
    expect(isLoanDue(loan({ is_active: false }), 6, 2026)).toBe(false);
    expect(isLoanDue(loan({ remaining_balance: 0 }), 6, 2026)).toBe(false);
    expect(isLoanDue(loan({ first_installment_month: null }), 6, 2026)).toBe(false);
  });
});

describe("loanDeductionForPeriod", () => {
  it("sums installments across due loans", () => {
    const total = loanDeductionForPeriod(
      [loan(), loan({ id: "loan-2", monthly_installment: 250_000 })],
      6,
      2026
    );
    expect(total).toBe(750_000);
  });

  it("caps the last installment at the remaining balance", () => {
    const total = loanDeductionForPeriod(
      [loan({ remaining_balance: 200_000 })],
      6,
      2026
    );
    expect(total).toBe(200_000);
  });

  it("ignores loans not yet due", () => {
    const total = loanDeductionForPeriod(
      [loan({ first_installment_month: 8 })],
      6,
      2026
    );
    expect(total).toBe(0);
  });
});

describe("allocateLoanPayment", () => {
  it("allocates the deducted amount oldest-first, one installment per loan", () => {
    const allocations = allocateLoanPayment(
      [
        loan({ id: "old", monthly_installment: 500_000, remaining_balance: 1_000_000 }),
        loan({ id: "new", monthly_installment: 300_000, remaining_balance: 900_000 }),
      ],
      800_000
    );
    expect(allocations).toEqual([
      { loanId: "old", amount: 500_000, newRemaining: 500_000, paidOff: false },
      { loanId: "new", amount: 300_000, newRemaining: 600_000, paidOff: false },
    ]);
  });

  it("marks a loan paid off when the balance reaches zero", () => {
    const allocations = allocateLoanPayment(
      [loan({ remaining_balance: 400_000, monthly_installment: 500_000 })],
      400_000
    );
    expect(allocations).toEqual([
      { loanId: "loan-1", amount: 400_000, newRemaining: 0, paidOff: true },
    ]);
  });

  it("never allocates more than the deducted amount (stale slip guard)", () => {
    const allocations = allocateLoanPayment(
      [
        loan({ id: "a", monthly_installment: 500_000 }),
        loan({ id: "b", monthly_installment: 500_000 }),
      ],
      600_000
    );
    expect(allocations.reduce((acc, a) => acc + a.amount, 0)).toBe(600_000);
    expect(allocations[1]).toMatchObject({ loanId: "b", amount: 100_000 });
  });
});

describe("validateLoanLimits", () => {
  const base = {
    monthlyInstallment: 2_000_000,
    baseSalary: 10_000_000,
    maxInstallmentPercent: 30,
    activeLoanCount: 0,
    maxActiveLoans: 1,
  };

  it("passes within limits", () => {
    expect(validateLoanLimits(base)).toBeNull();
  });

  it("rejects installment above percent-of-salary cap", () => {
    expect(
      validateLoanLimits({ ...base, monthlyInstallment: 3_500_000 })
    ).toMatch(/melebihi batas 30%/);
  });

  it("rejects when active loan count reaches the max", () => {
    expect(validateLoanLimits({ ...base, activeLoanCount: 1 })).toMatch(
      /pinjaman aktif/
    );
  });

  it("rejects when employee has no active salary structure", () => {
    expect(validateLoanLimits({ ...base, baseSalary: null })).toMatch(
      /struktur gaji/
    );
  });
});
