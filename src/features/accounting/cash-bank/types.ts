export type CashBankAccountItem = {
  id: string;
  code: string;
  code_display: string;
  name: string;
  account_type_code: string | null;
  normal_balance: "DEBIT" | "CREDIT";
  balance: number;
  movement_count: number;
};

export type CashBankLedgerLineItem = {
  line_id: string;
  entry_id: string;
  entry_no: string;
  entry_date: string;
  entry_type: string;
  description: string | null;
  memo: string | null;
  entry_side: "DEBIT" | "CREDIT";
  debit: number;
  credit: number;
  running_balance: number;
};

export type CashBankLedgerItem = {
  account: {
    id: string;
    code: string;
    code_display: string;
    name: string;
    normal_balance: "DEBIT" | "CREDIT";
  };
  date_from: string | null;
  date_to: string | null;
  opening_balance: number;
  closing_balance: number;
  total_debit: number;
  total_credit: number;
  lines: CashBankLedgerLineItem[];
};

export type CashBankLedgerFilters = {
  date_from?: string;
  date_to?: string;
};
