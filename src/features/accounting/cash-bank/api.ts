import { apiGet, buildListUrl } from "@/lib/api-client";
import type {
  CashBankAccountItem,
  CashBankLedgerFilters,
  CashBankLedgerItem,
} from "./types";

const BASE = "/api/accounting/cash-bank";

export const fetchCashBankAccounts = () =>
  apiGet<{ data: CashBankAccountItem[] }>(BASE).then((res) => res.data);

export const fetchCashBankLedger = (
  accountId: string,
  filters?: CashBankLedgerFilters
) =>
  apiGet<{ data: CashBankLedgerItem }>(
    buildListUrl(
      `${BASE}/${accountId}/ledger`,
      filters as Record<string, string | number | boolean | null | undefined>
    )
  ).then((res) => res.data);
