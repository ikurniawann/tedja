"use client";

import { useQuery } from "@tanstack/react-query";
import { reportQueryKeys } from "./query-keys";
import {
  fetchBalanceSheet,
  fetchCashFlow,
  fetchGeneralLedger,
  fetchGeneralLedgerAccounts,
  fetchIncomeStatement,
  fetchTrialBalance,
} from "./api";

export const useTrialBalance = (asOf: string) =>
  useQuery({
    queryKey: reportQueryKeys.report("trial-balance", { as_of: asOf }),
    queryFn: () => fetchTrialBalance(asOf),
  });

export const useBalanceSheet = (asOf: string) =>
  useQuery({
    queryKey: reportQueryKeys.report("balance-sheet", { as_of: asOf }),
    queryFn: () => fetchBalanceSheet(asOf),
  });

export const useIncomeStatement = (dateFrom: string, dateTo: string) =>
  useQuery({
    queryKey: reportQueryKeys.report("income-statement", {
      date_from: dateFrom,
      date_to: dateTo,
    }),
    queryFn: () => fetchIncomeStatement(dateFrom, dateTo),
  });

export const useCashFlow = (dateFrom: string, dateTo: string) =>
  useQuery({
    queryKey: reportQueryKeys.report("cash-flow", {
      date_from: dateFrom,
      date_to: dateTo,
    }),
    queryFn: () => fetchCashFlow(dateFrom, dateTo),
  });

export const useGeneralLedgerAccounts = (asOf: string) =>
  useQuery({
    queryKey: reportQueryKeys.report("general-ledger-accounts", {
      as_of: asOf,
    }),
    queryFn: () => fetchGeneralLedgerAccounts(asOf),
  });

export const useGeneralLedger = (
  accountId: string | null,
  dateFrom: string,
  dateTo: string
) =>
  useQuery({
    queryKey: reportQueryKeys.report("general-ledger", {
      account_id: accountId ?? "",
      date_from: dateFrom,
      date_to: dateTo,
    }),
    queryFn: () => fetchGeneralLedger(accountId!, dateFrom || undefined, dateTo || undefined),
    enabled: Boolean(accountId),
  });
