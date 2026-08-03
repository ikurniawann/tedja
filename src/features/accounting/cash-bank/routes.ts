export const CASH_BANK_ROUTES = {
  list: "/dashboard/accounting/cash-bank",
  ledger: (accountId: string) =>
    `/dashboard/accounting/cash-bank/${accountId}`,
} as const;
