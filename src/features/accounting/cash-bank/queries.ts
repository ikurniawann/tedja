"use client";

import { useQuery } from "@tanstack/react-query";
import { cashBankQueryKeys } from "./query-keys";
import { fetchCashBankAccounts, fetchCashBankLedger } from "./api";
import type { CashBankLedgerFilters } from "./types";

export const useCashBankAccounts = () =>
  useQuery({
    queryKey: cashBankQueryKeys.list(),
    queryFn: fetchCashBankAccounts,
  });

export const useCashBankLedger = (
  accountId: string | null,
  filters?: CashBankLedgerFilters
) =>
  useQuery({
    queryKey: cashBankQueryKeys.ledger(
      accountId ?? "",
      filters as Record<string, string | undefined>
    ),
    queryFn: () => fetchCashBankLedger(accountId!, filters),
    enabled: Boolean(accountId),
  });
