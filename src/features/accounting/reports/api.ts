import { apiGet, buildListUrl } from "@/lib/api-client";
import type {
  BalanceSheetReport,
  CashFlowReport,
  GeneralLedgerAccountOption,
  GeneralLedgerReport,
  IncomeStatementReport,
  TrialBalanceReport,
} from "./types";
import type { ReportKind } from "./routes";

const BASE = "/api/accounting/reports";

function getReport<T>(kind: ReportKind, filters?: Record<string, string | undefined>) {
  return apiGet<{ data: T }>(
    buildListUrl(`${BASE}/${kind}`, filters)
  ).then((res) => res.data);
}

export const fetchTrialBalance = (asOf?: string) =>
  getReport<TrialBalanceReport>("trial-balance", {
    as_of: asOf,
  });

export const fetchBalanceSheet = (asOf?: string) =>
  getReport<BalanceSheetReport>("balance-sheet", { as_of: asOf });

export const fetchIncomeStatement = (dateFrom?: string, dateTo?: string) =>
  getReport<IncomeStatementReport>("income-statement", {
    date_from: dateFrom,
    date_to: dateTo,
  });

export const fetchCashFlow = (dateFrom?: string, dateTo?: string) =>
  getReport<CashFlowReport>("cash-flow", {
    date_from: dateFrom,
    date_to: dateTo,
  });

export const fetchGeneralLedgerAccounts = (asOf?: string) =>
  getReport<GeneralLedgerAccountOption[]>("general-ledger", {
    as_of: asOf,
  });

export const fetchGeneralLedger = (
  accountId: string,
  dateFrom?: string,
  dateTo?: string
) =>
  getReport<GeneralLedgerReport>("general-ledger", {
    account_id: accountId,
    date_from: dateFrom,
    date_to: dateTo,
  });
