"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { ToastContainer, useToast } from "@/components/ui/toast";
import {
  FormFieldLabel,
  formComboboxClassName,
  formInputClassName,
} from "@/components/layout/form-field";
import {
  FormPageBody,
  FormPageFooter,
  FormPageHeader,
  FormPageLayout,
  FormPageLoading,
} from "@/components/layout/form-page-layout";
import { useCoaList } from "@/features/accounting/chart-of-accounts/queries";
import { useFiscalCoverage } from "@/features/accounting/fiscal-years/queries";
import { useOpenFiscalPeriod } from "@/features/accounting/fiscal-years/mutations";
import { FISCAL_YEAR_ROUTES } from "@/features/accounting/fiscal-years/routes";
import { useJournalEntry } from "../queries";
import {
  useCreateJournalEntry,
  useUpdateJournalEntry,
} from "../mutations";
import type { JournalEntryLinePayload } from "../types";
import { JOURNAL_ENTRY_ROUTES } from "../routes";

type FormLine = {
  key: string;
  account_id: string;
  debit: number;
  credit: number;
  memo: string;
  sort_order: number;
};

type FormState = {
  entry_date: string;
  description: string;
  is_recon: boolean;
  lines: FormLine[];
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function newLine(partial?: Partial<FormLine>): FormLine {
  return {
    key: `tmp-${Math.random().toString(36).slice(2, 9)}`,
    account_id: "",
    debit: 0,
    credit: 0,
    memo: "",
    sort_order: 10,
    ...partial,
  };
}

function defaultLines(): FormLine[] {
  return [
    newLine({ sort_order: 10 }),
    newLine({ sort_order: 20 }),
  ];
}

function formatAmount(n: number) {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function JournalEntryFormPage({
  mode,
  entryId,
}: {
  mode: "create" | "edit";
  entryId?: string;
}) {
  const router = useRouter();
  const { toasts, showToast, removeToast } = useToast();
  const [form, setForm] = useState<FormState>(() => ({
    entry_date: todayStr(),
    description: "",
    is_recon: false,
    lines: mode === "create" ? defaultLines() : [],
  }));
  const [hydrated, setHydrated] = useState(mode === "create");
  const [readOnly, setReadOnly] = useState(false);

  const { data: existing, isLoading, isError } = useJournalEntry(
    mode === "edit" ? entryId ?? null : null
  );
  const { data: coaData } = useCoaList({
    is_postable: "true",
    is_active: "true",
  });
  const { data: coverage, isLoading: coverageLoading } = useFiscalCoverage(
    form.entry_date
  );
  const openPeriodMutation = useOpenFiscalPeriod();
  const createMutation = useCreateJournalEntry();
  const updateMutation = useUpdateJournalEntry();
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const fiscalReady = coverage?.ready === true;
  const suggestion = coverage?.suggestion ?? null;

  const coaRows = useMemo(() => coaData ?? [], [coaData]);

  useEffect(() => {
    if (mode !== "edit" || !existing || hydrated) return;
    setForm({
      entry_date: existing.entry_date,
      description: existing.description ?? "",
      is_recon: existing.is_recon,
      lines: existing.lines.map((l, idx) => ({
        key: l.id,
        account_id: l.account_id,
        debit: l.entry_side === "DEBIT" ? l.amount : 0,
        credit: l.entry_side === "CREDIT" ? l.amount : 0,
        memo: l.memo ?? "",
        sort_order: l.sort_order ?? (idx + 1) * 10,
      })),
    });
    setReadOnly(!existing.can_edit);
    setHydrated(true);
  }, [mode, existing, hydrated]);

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const line of form.lines) {
      if (line.debit > 0) debit += line.debit;
      if (line.credit > 0) credit += line.credit;
    }
    const d = Math.round(debit * 100) / 100;
    const c = Math.round(credit * 100) / 100;
    return { debit: d, credit: c, diff: Math.round((d - c) * 100) / 100 };
  }, [form.lines]);

  function accountOptionsFor(lineKey: string) {
    const used = new Set(
      form.lines
        .filter((l) => l.key !== lineKey && l.account_id)
        .map((l) => l.account_id)
    );
    return coaRows
      .filter((a) => !used.has(a.id))
      .map((a) => ({
        value: a.id,
        label: `${a.code_display || a.code} — ${a.name}`,
        description: a.is_cash_bank ? "Kas/Bank" : undefined,
      }));
  }

  function updateLine(key: string, patch: Partial<FormLine>) {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    }));
  }

  function setDebit(key: string, value: number) {
    const amount = Number.isFinite(value) && value > 0 ? value : 0;
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l) =>
        l.key === key
          ? { ...l, debit: amount, credit: amount > 0 ? 0 : l.credit }
          : l
      ),
    }));
  }

  function setCredit(key: string, value: number) {
    const amount = Number.isFinite(value) && value > 0 ? value : 0;
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l) =>
        l.key === key
          ? { ...l, credit: amount, debit: amount > 0 ? 0 : l.debit }
          : l
      ),
    }));
  }

  function removeLine(key: string) {
    setForm((f) => ({
      ...f,
      lines: f.lines.filter((l) => l.key !== key),
    }));
  }

  function addLine() {
    setForm((f) => ({
      ...f,
      lines: [
        ...f.lines,
        newLine({ sort_order: (f.lines.length + 1) * 10 }),
      ],
    }));
  }

  async function handleSave(post: boolean) {
    if (isSaving || readOnly) return;
    if (!fiscalReady) {
      showToast(
        "Fiscal period OPEN belum tersedia untuk tanggal ini",
        "error"
      );
      return;
    }

    const filled = form.lines.filter(
      (l) => l.account_id && (l.debit > 0 || l.credit > 0)
    );
    if (filled.length < 2) {
      showToast("Minimal 2 baris jurnal dengan akun dan amount", "error");
      return;
    }
    if (filled.some((l) => !l.account_id)) {
      showToast("Setiap baris harus punya akun COA", "error");
      return;
    }
    const accountIds = filled.map((l) => l.account_id);
    if (new Set(accountIds).size !== accountIds.length) {
      showToast("Satu akun tidak boleh dipakai lebih dari sekali", "error");
      return;
    }
    if (totals.diff !== 0) {
      showToast(
        `Jurnal belum balance (selisih ${formatAmount(Math.abs(totals.diff))})`,
        "error"
      );
      return;
    }
    if (totals.debit <= 0 || totals.credit <= 0) {
      showToast("Harus ada minimal satu Debit dan satu Credit", "error");
      return;
    }

    const lines: JournalEntryLinePayload[] = filled.map((l, idx) => ({
      account_id: l.account_id,
      entry_side: l.debit > 0 ? "DEBIT" : "CREDIT",
      amount: l.debit > 0 ? l.debit : l.credit,
      memo: l.memo.trim() || null,
      sort_order: l.sort_order || (idx + 1) * 10,
    }));

    const payload = {
      entry_date: form.entry_date,
      description: form.description.trim() || null,
      lines,
      post,
    };

    try {
      if (mode === "edit" && entryId) {
        const res = await updateMutation.mutateAsync({
          id: entryId,
          ...payload,
        });
        showToast(res.message || "Jurnal berhasil disimpan", "success");
      } else {
        const res = await createMutation.mutateAsync(payload);
        showToast(res.message || "Jurnal berhasil disimpan", "success");
      }
      router.push(JOURNAL_ENTRY_ROUTES.list);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Gagal menyimpan jurnal",
        "error"
      );
    }
  }

  if (mode === "edit" && isLoading) return <FormPageLoading />;

  if (mode === "edit" && (isError || (!isLoading && !existing))) {
    return (
      <FormPageLayout>
        <FormPageHeader
          title="Journal entry tidak ditemukan"
          description="Data mungkin sudah dihapus."
          onBack={() => router.push(JOURNAL_ENTRY_ROUTES.list)}
        />
      </FormPageLayout>
    );
  }

  return (
    <FormPageLayout>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <FormPageHeader
        title={
          mode === "edit"
            ? readOnly
              ? `Lihat ${existing?.entry_no ?? "Jurnal"}`
              : `Edit ${existing?.entry_no ?? "Jurnal"}`
            : "Tambah Journal Entry"
        }
        description="Jurnal manual: total Debit harus sama dengan Credit. Fiscal period OPEN wajib ada."
        onBack={() => router.push(JOURNAL_ENTRY_ROUTES.list)}
      />

      {!coverageLoading && !fiscalReady ? (
        <div className="mb-4 space-y-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-foreground">
          {suggestion ? (
            <>
              <p>{suggestion.message}</p>
              <div className="flex flex-wrap items-center gap-2">
                {suggestion.can_open ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={openPeriodMutation.isPending || readOnly}
                    onClick={async () => {
                      try {
                        const res = await openPeriodMutation.mutateAsync({
                          periodId: suggestion.period.id,
                          close_previous: true,
                        });
                        showToast(
                          res.message ||
                            `Period ${suggestion.period.name} dibuka`,
                          "success"
                        );
                      } catch (err) {
                        showToast(
                          err instanceof Error
                            ? err.message
                            : "Gagal membuka period",
                          "error"
                        );
                      }
                    }}
                    className="h-9 gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {openPeriodMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {suggestion.close_previous?.length
                      ? `Tutup sebelumnya & buka ${suggestion.period.name}`
                      : `Buka ${suggestion.period.name}`}
                  </Button>
                ) : null}
                <Link
                  href={FISCAL_YEAR_ROUTES.edit(suggestion.period.fiscal_year_id)}
                  className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  Kelola Fiscal Years
                </Link>
              </div>
            </>
          ) : (
            <p>
              Belum ada fiscal period OPEN untuk tanggal{" "}
              <span className="font-medium">{form.entry_date}</span>.{" "}
              <Link
                href={FISCAL_YEAR_ROUTES.new}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Konfigurasi Fiscal Years
              </Link>{" "}
              terlebih dahulu.
            </p>
          )}
        </div>
      ) : null}

      {coverage?.period ? (
        <p className="mb-4 text-xs text-muted-foreground">
          Period: {coverage.period.name} ({coverage.period.fiscal_year_code}) —{" "}
          {coverage.period.status}
        </p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave(false);
        }}
        className="space-y-6"
      >
        <FormPageBody>
          <section className="rounded-xl border border-gray-200/70 bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground">
              Header jurnal
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <FormFieldLabel>Journal Number</FormFieldLabel>
                <Input
                  value={
                    mode === "edit" && existing?.entry_no
                      ? existing.entry_no
                      : ""
                  }
                  placeholder="Auto-generated by system"
                  className={formInputClassName}
                  disabled
                  readOnly
                />
              </div>
              <div className="space-y-1.5">
                <FormFieldLabel required>Tanggal</FormFieldLabel>
                <Input
                  type="date"
                  value={form.entry_date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, entry_date: e.target.value }))
                  }
                  className={formInputClassName}
                  required
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <FormFieldLabel>Deskripsi</FormFieldLabel>
                <Input
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  className={formInputClassName}
                  disabled={readOnly}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground sm:col-span-2">
                <Checkbox checked={form.is_recon} disabled />
                Flag recon (hanya di-set dari rekonsiliasi; entri terkunci)
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200/70 bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Baris jurnal
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Isi Debit atau Credit per baris. Satu akun hanya bisa dipakai
                  sekali. Total Debit harus = Credit.
                </p>
              </div>
              {!readOnly ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={addLine}
                  className="h-9 rounded-lg border-gray-200/80"
                >
                  + Baris
                </Button>
              ) : null}
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-225 text-sm">
                <thead>
                  <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="min-w-70 px-2 py-2">Akun</th>
                    <th className="w-36 px-2 py-2 text-right">Debit</th>
                    <th className="w-36 px-2 py-2 text-right">Credit</th>
                    <th className="min-w-40 px-2 py-2">Memo</th>
                    <th className="w-12 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((line) => (
                    <tr
                      key={line.key}
                      className="border-b border-gray-200/70 last:border-0"
                    >
                      <td className="min-w-70 px-2 py-2 align-middle">
                        <Combobox
                          options={accountOptionsFor(line.key)}
                          value={line.account_id}
                          onChange={(v) =>
                            updateLine(line.key, { account_id: v })
                          }
                          placeholder="Pilih akun"
                          searchPlaceholder="Cari COA..."
                          disabled={readOnly}
                          className={formComboboxClassName}
                          contentClassName="min-w-80"
                        />
                      </td>
                      <td className="px-2 py-2 align-middle">
                        <NumericInput
                          value={line.debit || null}
                          onValueChange={(v) => setDebit(line.key, v)}
                          decimalScale={2}
                          disabled={readOnly}
                          placeholder="0"
                          className="h-10 border-gray-200/80 text-right focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
                        />
                      </td>
                      <td className="px-2 py-2 align-middle">
                        <NumericInput
                          value={line.credit || null}
                          onValueChange={(v) => setCredit(line.key, v)}
                          decimalScale={2}
                          disabled={readOnly}
                          placeholder="0"
                          className="h-10 border-gray-200/80 text-right focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
                        />
                      </td>
                      <td className="px-2 py-2 align-middle">
                        <Input
                          value={line.memo}
                          onChange={(e) =>
                            updateLine(line.key, { memo: e.target.value })
                          }
                          placeholder="Memo"
                          className={formInputClassName}
                          disabled={readOnly}
                        />
                      </td>
                      <td className="px-2 py-2 align-middle">
                        {!readOnly ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => removeLine(line.key)}
                            className="h-10 w-10 p-0 text-red-500"
                            aria-label="Hapus baris"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap gap-4 border-t border-gray-200/70 pt-4 text-sm">
              <div>
                Total Debit:{" "}
                <span className="font-medium tabular-nums">
                  {formatAmount(totals.debit)}
                </span>
              </div>
              <div>
                Total Credit:{" "}
                <span className="font-medium tabular-nums">
                  {formatAmount(totals.credit)}
                </span>
              </div>
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
            </div>
          </section>
        </FormPageBody>

        <FormPageFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(JOURNAL_ENTRY_ROUTES.list)}
            disabled={isSaving}
            className="h-10 rounded-lg border-gray-200/80"
          >
            {readOnly ? "Kembali" : "Batal"}
          </Button>
          {!readOnly ? (
            <>
              <Button
                type="submit"
                variant="outline"
                disabled={isSaving || !fiscalReady}
                className="h-10 gap-2 rounded-lg border-gray-200/80"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Simpan Draft
              </Button>
              <Button
                type="button"
                disabled={isSaving || !fiscalReady}
                onClick={() => void handleSave(true)}
                className="h-10 gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Post
              </Button>
            </>
          ) : null}
        </FormPageFooter>
      </form>
    </FormPageLayout>
  );
}
