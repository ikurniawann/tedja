import { query, queryOne } from "@/lib/db";
import { formatAccountCodeDisplay } from "@/lib/accounting/account-code";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export type CashBankAccount = {
  id: string;
  code: string;
  code_display: string;
  name: string;
  account_type_code: string | null;
  normal_balance: "DEBIT" | "CREDIT";
  balance: number;
  movement_count: number;
};

export type CashBankLedgerLine = {
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

export type CashBankLedger = {
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
  lines: CashBankLedgerLine[];
};

function signedDelta(
  side: string,
  amount: number,
  normalBalance: "DEBIT" | "CREDIT"
) {
  const isIncrease =
    (normalBalance === "DEBIT" && side === "DEBIT") ||
    (normalBalance === "CREDIT" && side === "CREDIT");
  return isIncrease ? amount : -amount;
}

export async function listCashBankAccounts(
  companyId: string
): Promise<CashBankAccount[]> {
  const rows = await query<{
    id: string;
    code: string;
    name: string;
    account_type_code: string | null;
    normal_balance: string;
    debit: string;
    credit: string;
    movement_count: string;
  }>(
    `SELECT
       coa.id,
       coa.code,
       coa.name,
       t.code AS account_type_code,
       t.normal_balance,
       COALESCE(SUM(mov.debit), 0)::text AS debit,
       COALESCE(SUM(mov.credit), 0)::text AS credit,
       COALESCE(COUNT(mov.line_id), 0)::text AS movement_count
     FROM accounting.chart_of_accounts coa
     JOIN accounting.account_types t ON t.id = coa.account_type_id
     LEFT JOIN (
       SELECT
         l.account_id,
         l.id AS line_id,
         CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE 0 END AS debit,
         CASE WHEN l.entry_side = 'CREDIT' THEN l.amount ELSE 0 END AS credit
       FROM accounting.journal_entry_lines l
       JOIN accounting.journal_entries e
         ON e.id = l.entry_id
        AND e.deleted_at IS NULL
        AND e.status = 'POSTED'
        AND e.company_id = $1::uuid
     ) mov ON mov.account_id = coa.id
     WHERE coa.deleted_at IS NULL
       AND coa.is_active = true
       AND coa.is_cash_bank = true
       AND coa.company_id = $1::uuid
     GROUP BY coa.id, coa.code, coa.name, t.code, t.normal_balance
     ORDER BY coa.code ASC`,
    [companyId]
  );

  return rows.map((row) => {
    const normal =
      row.normal_balance === "CREDIT" ? ("CREDIT" as const) : ("DEBIT" as const);
    const debit = Number(row.debit);
    const credit = Number(row.credit);
    const balance =
      normal === "DEBIT" ? round2(debit - credit) : round2(credit - debit);
    return {
      id: row.id,
      code: row.code,
      code_display: formatAccountCodeDisplay(row.code),
      name: row.name,
      account_type_code: row.account_type_code,
      normal_balance: normal,
      balance,
      movement_count: Number(row.movement_count),
    };
  });
}

export async function getCashBankLedger(opts: {
  companyId: string;
  accountId: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<CashBankLedger | null> {
  const account = await queryOne<{
    id: string;
    code: string;
    name: string;
    normal_balance: string;
    company_id: string | null;
    is_cash_bank: boolean;
    deleted_at: string | null;
  }>(
    `SELECT coa.id, coa.code, coa.name, t.normal_balance,
            coa.company_id, coa.is_cash_bank, coa.deleted_at
     FROM accounting.chart_of_accounts coa
     JOIN accounting.account_types t ON t.id = coa.account_type_id
     WHERE coa.id = $1::uuid`,
    [opts.accountId]
  );

  if (
    !account ||
    account.deleted_at ||
    !account.is_cash_bank ||
    account.company_id !== opts.companyId
  ) {
    return null;
  }

  const normal =
    account.normal_balance === "CREDIT"
      ? ("CREDIT" as const)
      : ("DEBIT" as const);

  // Opening = posted movements before date_from
  let openingBalance = 0;
  if (opts.dateFrom) {
    const opening = await queryOne<{ debit: string; credit: string }>(
      `SELECT
         COALESCE(SUM(CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS debit,
         COALESCE(SUM(CASE WHEN l.entry_side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS credit
       FROM accounting.journal_entry_lines l
       JOIN accounting.journal_entries e
         ON e.id = l.entry_id AND e.deleted_at IS NULL AND e.status = 'POSTED'
       WHERE l.account_id = $1::uuid
         AND e.company_id = $2::uuid
         AND e.entry_date < $3::date`,
      [opts.accountId, opts.companyId, opts.dateFrom]
    );
    const d = Number(opening?.debit ?? 0);
    const c = Number(opening?.credit ?? 0);
    openingBalance =
      normal === "DEBIT" ? round2(d - c) : round2(c - d);
  }

  const params: unknown[] = [opts.accountId, opts.companyId];
  const clauses = [
    "l.account_id = $1::uuid",
    "e.company_id = $2::uuid",
    "e.deleted_at IS NULL",
    "e.status = 'POSTED'",
  ];
  if (opts.dateFrom) {
    params.push(opts.dateFrom);
    clauses.push(`e.entry_date >= $${params.length}::date`);
  }
  if (opts.dateTo) {
    params.push(opts.dateTo);
    clauses.push(`e.entry_date <= $${params.length}::date`);
  }

  const movementRows = await query<{
    line_id: string;
    entry_id: string;
    entry_no: string;
    entry_date: string;
    entry_type: string;
    description: string | null;
    memo: string | null;
    entry_side: string;
    amount: string;
  }>(
    `SELECT
       l.id AS line_id,
       e.id AS entry_id,
       e.entry_no,
       e.entry_date::text AS entry_date,
       COALESCE(e.entry_type, 'MANUAL') AS entry_type,
       e.description,
       l.memo,
       l.entry_side,
       l.amount::text AS amount
     FROM accounting.journal_entry_lines l
     JOIN accounting.journal_entries e ON e.id = l.entry_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.entry_date ASC, e.entry_no ASC, l.sort_order ASC, l.entry_side ASC`,
    params
  );

  let running = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;
  const lines: CashBankLedgerLine[] = movementRows.map((row) => {
    const amount = Number(row.amount);
    const debit = row.entry_side === "DEBIT" ? amount : 0;
    const credit = row.entry_side === "CREDIT" ? amount : 0;
    totalDebit = round2(totalDebit + debit);
    totalCredit = round2(totalCredit + credit);
    running = round2(
      running + signedDelta(row.entry_side, amount, normal)
    );
    return {
      line_id: row.line_id,
      entry_id: row.entry_id,
      entry_no: row.entry_no,
      entry_date: row.entry_date,
      entry_type: row.entry_type,
      description: row.description,
      memo: row.memo,
      entry_side: row.entry_side === "CREDIT" ? "CREDIT" : "DEBIT",
      debit,
      credit,
      running_balance: running,
    };
  });

  return {
    account: {
      id: account.id,
      code: account.code,
      code_display: formatAccountCodeDisplay(account.code),
      name: account.name,
      normal_balance: normal,
    },
    date_from: opts.dateFrom ?? null,
    date_to: opts.dateTo ?? null,
    opening_balance: openingBalance,
    closing_balance: running,
    total_debit: totalDebit,
    total_credit: totalCredit,
    lines,
  };
}
