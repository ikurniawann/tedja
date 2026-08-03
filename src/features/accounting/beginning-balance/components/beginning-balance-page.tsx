"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { ToastContainer, useToast } from "@/components/ui/toast";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FormPageBody,
  FormPageFooter,
  FormPageHeader,
  FormPageLayout,
  FormPageLoading,
} from "@/components/layout/form-page-layout";
import { useCoaList } from "@/features/accounting/chart-of-accounts/queries";
import type { CoaAccountItem } from "@/features/accounting/chart-of-accounts/types";
import { BEGINNING_BALANCE_ROUTES } from "../routes";
import { useBeginningBalance } from "../queries";
import { useSaveBeginningBalance } from "../mutations";

const BS_TYPES = new Set(["ASSET", "LIABILITY", "EQUITY"]);

type ViewMode = "cash_bank" | "all";

function formatAmount(n: number) {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

type BalanceRow = {
  account_id: string;
  code: string;
  name: string;
  account_type_code: string;
  normal_balance: string;
  is_cash_bank: boolean;
  debit: number;
  credit: number;
  source: "PRIOR_BS" | "RETAINED_EARNINGS" | "MANUAL" | null;
};

type SuggestedLine = {
  account_id: string;
  account_code?: string;
  entry_side: string;
  amount: number;
  source: "PRIOR_BS" | "RETAINED_EARNINGS" | "MANUAL";
};

function normalizeCode(code: string) {
  return code.replace(/\D/g, "") || code.trim();
}

function buildRows(
  accounts: CoaAccountItem[],
  suggested: SuggestedLine[]
): BalanceRow[] {
  type Hit = {
    debit: number;
    credit: number;
    source: SuggestedLine["source"];
  };

  const byId = new Map<string, Hit>();
  const byCode = new Map<string, Hit>();

  for (const line of suggested) {
    const hit: Hit = {
      debit: line.entry_side === "DEBIT" ? line.amount : 0,
      credit: line.entry_side === "CREDIT" ? line.amount : 0,
      source: line.source,
    };
    byId.set(line.account_id, hit);
    if (line.account_code) {
      byCode.set(normalizeCode(line.account_code), hit);
      byCode.set(line.account_code, hit);
    }
  }

  return accounts
    .filter(
      (a) =>
        a.is_postable &&
        a.is_active &&
        a.account_type_code &&
        BS_TYPES.has(a.account_type_code)
    )
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => {
      const hit =
        byId.get(a.id) ??
        byCode.get(a.code) ??
        byCode.get(normalizeCode(a.code)) ??
        byCode.get(normalizeCode(a.code_display || a.code));
      return {
        account_id: a.id,
        code: a.code_display || a.code,
        name: a.name,
        account_type_code: a.account_type_code || "",
        normal_balance: a.normal_balance || "DEBIT",
        is_cash_bank: Boolean(a.is_cash_bank),
        debit: hit?.debit ?? 0,
        credit: hit?.credit ?? 0,
        source: hit?.source ?? null,
      };
    });
}

export function BeginningBalancePage({
  fiscalYearId,
}: {
  fiscalYearId: string;
}) {
  const router = useRouter();
  const { toasts, showToast, removeToast } = useToast();
  const { data, isLoading, isError } = useBeginningBalance(fiscalYearId);
  const saveMutation = useSaveBeginningBalance(fiscalYearId);
  const { data: coaData, isLoading: coaLoading } = useCoaList({
    is_postable: "true",
    is_active: "true",
  });
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cash_bank");

  useEffect(() => {
    if (!data || !coaData || hydrated) return;
    setRows(buildRows(coaData, data.lines));
    setHydrated(true);
  }, [data, coaData, hydrated]);

  const visibleRows = useMemo(() => {
    const base =
      viewMode === "cash_bank" ? rows.filter((r) => r.is_cash_bank) : rows;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.account_type_code.toLowerCase().includes(q)
    );
  }, [rows, searchQuery, viewMode]);

  const cashTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    let filled = 0;
    for (const row of rows) {
      if (!row.is_cash_bank) continue;
      if (row.debit > 0) debit += row.debit;
      if (row.credit > 0) credit += row.credit;
      if (row.debit > 0 || row.credit > 0) filled += 1;
    }
    return {
      debit: Math.round(debit * 100) / 100,
      credit: Math.round(credit * 100) / 100,
      diff: Math.round((debit - credit) * 100) / 100,
      filled,
    };
  }, [rows]);

  const allTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const row of rows) {
      if (row.debit > 0) debit += row.debit;
      if (row.credit > 0) credit += row.credit;
    }
    return {
      debit: Math.round(debit * 100) / 100,
      credit: Math.round(credit * 100) / 100,
      diff: Math.round((debit - credit) * 100) / 100,
      filled: rows.filter((r) => r.debit > 0 || r.credit > 0).length,
    };
  }, [rows]);

  const totals = viewMode === "cash_bank" ? cashTotals : allTotals;
  const autoBalanceSide =
    viewMode === "cash_bank" && cashTotals.diff !== 0
      ? cashTotals.diff > 0
        ? ("CREDIT" as const)
        : ("DEBIT" as const)
      : null;
  const autoBalanceAmount =
    viewMode === "cash_bank" ? Math.abs(cashTotals.diff) : 0;

  const readOnly = data ? !data.can_edit : true;
  const isSaving = saveMutation.isPending;

  function updateAmount(
    accountId: string,
    side: "debit" | "credit",
    value: number
  ) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.account_id !== accountId) return r;
        const amount = Number.isFinite(value) && value > 0 ? value : 0;
        // Isi satu sisi saja per akun (saldo netto)
        if (side === "debit") {
          return {
            ...r,
            debit: amount,
            credit: amount > 0 ? 0 : r.credit,
            source: r.source ?? "MANUAL",
          };
        }
        return {
          ...r,
          credit: amount,
          debit: amount > 0 ? 0 : r.debit,
          source: r.source ?? "MANUAL",
        };
      })
    );
  }

  async function handleSave(post: boolean) {
    if (isSaving || readOnly) return;

    let payloadLines =
      viewMode === "cash_bank"
        ? rows
            .filter((r) => r.is_cash_bank && (r.debit > 0 || r.credit > 0))
            .map((r) => ({
              account_id: r.account_id,
              entry_side: (r.debit > 0 ? "DEBIT" : "CREDIT") as
                | "DEBIT"
                | "CREDIT",
              amount: r.debit > 0 ? r.debit : r.credit,
            }))
        : rows
            .filter((r) => r.debit > 0 || r.credit > 0)
            .map((r) => ({
              account_id: r.account_id,
              entry_side: (r.debit > 0 ? "DEBIT" : "CREDIT") as
                | "DEBIT"
                | "CREDIT",
              amount: r.debit > 0 ? r.debit : r.credit,
            }));

    if (viewMode === "cash_bank" && cashTotals.diff !== 0) {
      const reId = data?.retained_earnings_account?.id;
      if (!reId) {
        showToast(
          "Butuh akun Retained Earnings / Laba Ditahan untuk menyeimbangkan Kas & Bank",
          "error"
        );
        return;
      }
      // Jangan dobel jika RE sudah ikut diisi manual di cash list (harusnya tidak)
      payloadLines = payloadLines.filter((l) => l.account_id !== reId);
      payloadLines.push({
        account_id: reId,
        entry_side: cashTotals.diff > 0 ? "CREDIT" : "DEBIT",
        amount: Math.abs(cashTotals.diff),
      });
    }

    if (payloadLines.length < 2) {
      showToast(
        viewMode === "cash_bank"
          ? "Isi minimal satu akun Kas/Bank (lawan otomatis ke Laba Ditahan)"
          : "Minimal 2 akun dengan saldo > 0",
        "error"
      );
      return;
    }

    if (viewMode === "all" && allTotals.diff !== 0) {
      showToast(
        `Belum balance (selisih ${formatAmount(Math.abs(allTotals.diff))})`,
        "error"
      );
      return;
    }

    try {
      const res = await saveMutation.mutateAsync({
        lines: payloadLines,
        post,
        retained_earnings_account_id:
          data?.retained_earnings_account?.id ?? null,
      });
      showToast(res.message || "Berhasil disimpan", "success");
      if (post) {
        router.push(BEGINNING_BALANCE_ROUTES.list);
      } else {
        setHydrated(false);
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Gagal menyimpan",
        "error"
      );
    }
  }

  if (isLoading || coaLoading) return <FormPageLoading />;

  if (isError || !data) {
    return (
      <FormPageLayout>
        <FormPageHeader
          title="Beginning balance tidak tersedia"
          description="Fiscal year mungkin tidak ditemukan."
          onBack={() => router.push(BEGINNING_BALANCE_ROUTES.list)}
        />
      </FormPageLayout>
    );
  }

  return (
    <FormPageLayout>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <FormPageHeader
        title={`Beginning Balance — ${data.fiscal_year_code}`}
        description={`${data.fiscal_year_name} · mulai ${data.start_date}${
          data.period_name ? ` · period ${data.period_name}` : ""
        }`}
        onBack={() => router.push(BEGINNING_BALANCE_ROUTES.list)}
      />

      {data.message ? (
        <div
          className={
            data.is_first_year
              ? "mb-4 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground"
              : "mb-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground"
          }
        >
          {data.is_first_year ? (
            <p className="font-medium">Fiscal year pertama</p>
          ) : null}
          <p className={data.is_first_year ? "mt-1 text-muted-foreground" : undefined}>
            {data.message}
          </p>
          {data.prior_fiscal_year ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              Sumber: {data.prior_fiscal_year.code} (akhir{" "}
              {data.prior_fiscal_year.end_date})
              {data.prior_fiscal_year.is_fully_closed
                ? " · fully closed"
                : " · belum fully closed"}
            </span>
          ) : null}
          {data.retained_earnings_account ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              Retained Earnings: {data.retained_earnings_account.code} —{" "}
              {data.retained_earnings_account.name}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-6">
        <FormPageBody>
          <section className="rounded-xl border border-gray-200/70 bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Chart of Accounts — isi saldo
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {viewMode === "cash_bank"
                      ? "Mode Kas & Bank: isi saldo kas/bank saja. Selisih otomatis di-balance ke Laba Ditahan / Retained Earnings."
                      : "Mode semua neraca (Asset / Liability / Equity). Total Debit harus = Credit."}
                  </p>
                </div>
                <label className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Cari kode / nama akun..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-10 bg-card pl-9 pr-9 text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      aria-label="Clear"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </label>
              </div>

              <Tabs
                value={viewMode}
                onValueChange={(v) => setViewMode(v as ViewMode)}
              >
                <TabsList className="h-10">
                  <TabsTrigger value="cash_bank" className="px-3">
                    Kas & Bank saja
                  </TabsTrigger>
                  <TabsTrigger value="all" className="px-3">
                    Semua neraca
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {viewMode === "cash_bank" && autoBalanceAmount > 0 ? (
              <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground">
                Auto-balance:{" "}
                <span className="font-medium">
                  {autoBalanceSide}{" "}
                  {data.retained_earnings_account
                    ? `${data.retained_earnings_account.code} — ${data.retained_earnings_account.name}`
                    : "Laba Ditahan (belum ditemukan di COA)"}
                </span>{" "}
                = {formatAmount(autoBalanceAmount)}
              </div>
            ) : null}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-3">Kode</th>
                    <th className="px-3 py-3">Nama akun</th>
                    <th className="px-3 py-3">Tipe</th>
                    <th className="px-3 py-3 text-right">Debit</th>
                    <th className="px-3 py-3 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-10 text-center text-muted-foreground"
                      >
                        {viewMode === "cash_bank"
                          ? "Tidak ada akun Kas/Bank (is_cash_bank). Tandai dulu di Chart of Accounts."
                          : "Tidak ada akun COA yang cocok"}
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((row) => (
                      <tr
                        key={row.account_id}
                        className="border-b border-gray-200/70 last:border-0 hover:bg-muted/30"
                      >
                        <td className="px-3 py-2 font-medium tabular-nums text-foreground">
                          {row.code}
                          {row.source === "PRIOR_BS" ||
                          row.source === "RETAINED_EARNINGS" ? (
                            <span className="ml-2 text-[10px] font-normal uppercase text-muted-foreground">
                              {row.source === "RETAINED_EARNINGS"
                                ? "RE"
                                : "suggest"}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-foreground">{row.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.account_type_code}
                        </td>
                        <td className="px-3 py-2">
                          <NumericInput
                            value={row.debit || null}
                            onValueChange={(v) =>
                              updateAmount(row.account_id, "debit", v)
                            }
                            decimalScale={2}
                            disabled={readOnly}
                            placeholder="0"
                            className="h-9 border-gray-200/80 text-right focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <NumericInput
                            value={row.credit || null}
                            onValueChange={(v) =>
                              updateAmount(row.account_id, "credit", v)
                            }
                            decimalScale={2}
                            disabled={readOnly}
                            placeholder="0"
                            className="h-9 border-gray-200/80 text-right focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap gap-4 border-t border-gray-200/70 pt-4 text-sm">
              <div className="text-muted-foreground">
                Terisi:{" "}
                <span className="font-medium text-foreground">
                  {totals.filled}
                </span>{" "}
                akun
              </div>
              <div>
                Debit:{" "}
                <span className="font-medium tabular-nums">
                  {formatAmount(totals.debit)}
                </span>
              </div>
              <div>
                Credit:{" "}
                <span className="font-medium tabular-nums">
                  {formatAmount(totals.credit)}
                </span>
              </div>
              {viewMode === "cash_bank" ? (
                <div className="text-muted-foreground">
                  Setelah auto-balance:{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {formatAmount(
                      Math.max(totals.debit, totals.credit)
                    )}{" "}
                    /{" "}
                    {formatAmount(
                      Math.max(totals.debit, totals.credit)
                    )}
                  </span>
                </div>
              ) : (
                <div
                  className={
                    totals.diff === 0
                      ? "text-muted-foreground"
                      : "text-destructive"
                  }
                >
                  Selisih:{" "}
                  <span className="font-medium tabular-nums">
                    {formatAmount(Math.abs(totals.diff))}
                  </span>
                </div>
              )}
            </div>
          </section>
        </FormPageBody>

        <FormPageFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(BEGINNING_BALANCE_ROUTES.list)}
            disabled={isSaving}
            className="h-10 rounded-lg border-gray-200/80"
          >
            Kembali
          </Button>
          {!readOnly ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={isSaving || totals.filled === 0}
                onClick={() => void handleSave(false)}
                className="h-10 gap-2 rounded-lg border-gray-200/80"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Simpan Draft
              </Button>
              <Button
                type="button"
                disabled={
                  isSaving ||
                  totals.filled === 0 ||
                  (viewMode === "all" &&
                    (totals.filled < 2 || totals.diff !== 0)) ||
                  (viewMode === "cash_bank" &&
                    !data.retained_earnings_account &&
                    cashTotals.diff !== 0)
                }
                onClick={() => void handleSave(true)}
                className="h-10 gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Post Beginning Balance
              </Button>
            </>
          ) : null}
        </FormPageFooter>
      </div>
    </FormPageLayout>
  );
}
