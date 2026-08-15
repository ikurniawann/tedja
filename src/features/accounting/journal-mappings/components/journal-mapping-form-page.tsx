"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
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
import {
  JOURNAL_AMOUNT_SOURCES,
  JOURNAL_ENTRY_SIDES,
  JOURNAL_EVENT_CODES,
  JOURNAL_EVENT_META,
  JOURNAL_LINE_ROLES,
  JOURNAL_MODULES,
  isCashBankLineRole,
  type JournalAmountSource,
  type JournalEntrySide,
  type JournalEventCode,
  type JournalModule,
} from "@/lib/accounting/journal-mapping-types";
import { useJournalMapping, useJournalMappingList } from "../queries";
import {
  useCreateJournalMapping,
  useUpdateJournalMapping,
} from "../mutations";
import type { JournalMappingLinePayload } from "../types";
import { JOURNAL_MAPPING_ROUTES } from "../routes";

type FormLine = {
  key: string;
  entry_side: JournalEntrySide;
  line_role: string;
  account_id: string;
  amount_source: JournalAmountSource;
  sort_order: number;
  is_required: boolean;
};

type FormState = {
  event_code: string;
  name: string;
  description: string;
  module: JournalModule | "";
  is_active: boolean;
  lines: FormLine[];
};

const EMPTY_FORM: FormState = {
  event_code: "",
  name: "",
  description: "",
  module: "",
  is_active: true,
  lines: [],
};

function newLine(partial?: Partial<FormLine>): FormLine {
  return {
    key: `tmp-${Math.random().toString(36).slice(2, 9)}`,
    entry_side: "DEBIT",
    line_role: "OTHER",
    account_id: "",
    amount_source: "TOTAL",
    sort_order: 10,
    is_required: true,
    ...partial,
  };
}

function defaultCreateLines(): FormLine[] {
  return [
    newLine({ entry_side: "DEBIT", line_role: "CASH", sort_order: 10 }),
    newLine({
      entry_side: "CREDIT",
      line_role: "REVENUE",
      amount_source: "SUBTOTAL",
      sort_order: 20,
    }),
  ];
}

export function JournalMappingFormPage({
  mode,
  mappingId,
}: {
  mode: "create" | "edit";
  mappingId?: string;
}) {
  const router = useRouter();
  const { toasts, showToast, removeToast } = useToast();
  const [form, setForm] = useState<FormState>(() =>
    mode === "create"
      ? { ...EMPTY_FORM, lines: defaultCreateLines() }
      : EMPTY_FORM
  );
  const [hydrated, setHydrated] = useState(mode === "create");

  const { data: listData } = useJournalMappingList();
  const { data: existing, isLoading: loadingExisting, isError } =
    useJournalMapping(mode === "edit" ? mappingId ?? null : null);
  const { data: coaData } = useCoaList({ is_postable: "true" });
  const createMutation = useCreateJournalMapping();
  const updateMutation = useUpdateJournalMapping();

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const coaRows = useMemo(() => coaData ?? [], [coaData]);
  const listRows = useMemo(() => listData ?? [], [listData]);

  useEffect(() => {
    if (mode !== "edit" || !existing || hydrated) return;
    setForm({
      event_code: existing.event_code,
      name: existing.name,
      description: existing.description ?? "",
      module: existing.module,
      is_active: existing.is_active,
      lines: existing.lines.map((l, idx) => ({
        key: l.id,
        entry_side: l.entry_side,
        line_role: l.line_role,
        account_id: l.account_id ?? "",
        amount_source: l.amount_source,
        sort_order: l.sort_order ?? (idx + 1) * 10,
        is_required: l.is_required,
      })),
    });
    setHydrated(true);
  }, [mode, existing, hydrated]);

  const moduleOptions = useMemo(
    () => JOURNAL_MODULES.map((m) => ({ value: m, label: m })),
    []
  );

  const eventOptions = useMemo(() => {
    const used = new Set(
      listRows
        .filter((r) => (mode === "edit" ? r.id !== mappingId : true))
        .map((r) => r.event_code)
    );
    return JOURNAL_EVENT_CODES.filter((code) => !used.has(code)).map(
      (code) => ({
        value: code,
        label: code,
        description: JOURNAL_EVENT_META[code].name,
      })
    );
  }, [listRows, mode, mappingId]);

  const coaOptionsAll = useMemo(
    () =>
      coaRows.map((a) => ({
        value: a.id,
        label: `${a.code_display || a.code} — ${a.name}`,
        description: a.is_cash_bank ? "Kas/Bank" : undefined,
      })),
    [coaRows]
  );

  const coaCashBankOptions = useMemo(
    () =>
      coaRows
        .filter((a) => a.is_cash_bank)
        .map((a) => ({
          value: a.id,
          label: `${a.code_display || a.code} — ${a.name}`,
          description: "Kas/Bank",
        })),
    [coaRows]
  );

  const sideOptions = useMemo(
    () => JOURNAL_ENTRY_SIDES.map((s) => ({ value: s, label: s })),
    []
  );
  const roleOptions = useMemo(
    () => JOURNAL_LINE_ROLES.map((r) => ({ value: r, label: r })),
    []
  );
  const amountOptions = useMemo(
    () => JOURNAL_AMOUNT_SOURCES.map((s) => ({ value: s, label: s })),
    []
  );

  function applyEvent(code: string) {
    const meta = JOURNAL_EVENT_META[code as JournalEventCode];
    setForm((f) => ({
      ...f,
      event_code: code,
      name: meta?.name || f.name || code,
      description: meta?.description || f.description,
      module: meta?.module || f.module || "",
    }));
  }

  function updateLine(key: string, patch: Partial<FormLine>) {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    }));
  }

  function removeLine(key: string) {
    setForm((f) => ({
      ...f,
      lines: f.lines.filter((l) => l.key !== key),
    }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    if (!form.event_code || !form.name.trim() || !form.module) {
      showToast("Event, nama, dan module wajib diisi", "error");
      return;
    }
    if (form.lines.length < 1) {
      showToast("Minimal satu baris mapping", "error");
      return;
    }

    const lines: JournalMappingLinePayload[] = form.lines.map((l, idx) => ({
      entry_side: l.entry_side,
      line_role: l.line_role,
      account_id: l.account_id || null,
      amount_source: l.amount_source,
      sort_order: l.sort_order || (idx + 1) * 10,
      is_required: l.is_required,
    }));

    const payload = {
      event_code: form.event_code,
      name: form.name.trim(),
      description: form.description.trim() || null,
      module: form.module as JournalModule,
      is_active: form.is_active,
      lines,
    };

    try {
      if (mode === "edit" && mappingId) {
        const res = await updateMutation.mutateAsync({
          id: mappingId,
          ...payload,
        });
        showToast(res.message || "Mapping berhasil diperbarui", "success");
      } else {
        const res = await createMutation.mutateAsync(payload);
        showToast(res.message || "Mapping berhasil ditambahkan", "success");
      }
      router.push(JOURNAL_MAPPING_ROUTES.list);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Gagal menyimpan mapping",
        "error"
      );
    }
  }

  if (mode === "edit" && loadingExisting) {
    return <FormPageLoading />;
  }

  if (mode === "edit" && (isError || (!loadingExisting && !existing))) {
    return (
      <FormPageLayout>
        <FormPageHeader
          title="Mapping tidak ditemukan"
          description="Data mungkin sudah dihapus."
          onBack={() => router.push(JOURNAL_MAPPING_ROUTES.list)}
        />
      </FormPageLayout>
    );
  }

  return (
    <FormPageLayout>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <FormPageHeader
        title={mode === "edit" ? "Edit Journal Mapping" : "Tambah Journal Mapping"}
        description="Template jurnal otomatis: saat event terjadi, sistem nanti membuat jurnal mengikuti baris Debit/Credit dan akun COA di bawah."
        onBack={() => router.push(JOURNAL_MAPPING_ROUTES.list)}
      />

      <form onSubmit={handleSave} className="space-y-6">
        <FormPageBody>
          <section className="rounded-xl border border-gray-200/70 bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground">
              Informasi event
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <FormFieldLabel required>Event</FormFieldLabel>
                <Combobox
                  options={
                    mode === "edit" && form.event_code
                      ? [
                          {
                            value: form.event_code,
                            label: form.event_code,
                            description:
                              JOURNAL_EVENT_META[
                                form.event_code as JournalEventCode
                              ]?.name,
                          },
                          ...eventOptions,
                        ]
                      : eventOptions
                  }
                  value={form.event_code}
                  onChange={applyEvent}
                  placeholder="Pilih event bisnis"
                  searchPlaceholder="Cari event..."
                  disabled={mode === "edit"}
                  className={formComboboxClassName}
                />
                <p className="text-xs text-muted-foreground">
                  Kode kejadian bisnis (POS sale, GRN, pembayaran vendor, dll.).
                </p>
              </div>
              <div className="space-y-1.5">
                <FormFieldLabel required>Module</FormFieldLabel>
                <Combobox
                  options={moduleOptions}
                  value={form.module}
                  onChange={(value) =>
                    setForm((f) => ({
                      ...f,
                      module: value as JournalModule | "",
                    }))
                  }
                  placeholder="Pilih module"
                  className={formComboboxClassName}
                />
                <p className="text-xs text-muted-foreground">
                  Modul sumber transaksi: POS atau Purchasing.
                </p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <FormFieldLabel required>Nama</FormFieldLabel>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className={formInputClassName}
                  required
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
                />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Checkbox
                  checked={form.is_active}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, is_active: Boolean(v) }))
                  }
                />
                Aktif (dipakai saat posting)
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200/70 bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Baris jurnal
                </h2>
                <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">
                  Satu baris = satu sisi jurnal. Minimal biasanya ada{" "}
                  <span className="font-medium text-foreground">Debit</span> dan{" "}
                  <span className="font-medium text-foreground">Credit</span>.
                  Contoh penjualan cash: Debit Kas (TOTAL) + Credit Revenue
                  (SUBTOTAL) + Credit Pajak (TAX).
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 rounded-lg border-gray-200/80"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    lines: [
                      ...f.lines,
                      newLine({ sort_order: (f.lines.length + 1) * 10 }),
                    ],
                  }))
                }
              >
                + Baris
              </Button>
            </div>

            <div className="mt-4 hidden gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:grid lg:grid-cols-12">
              <div className="lg:col-span-2">Sisi</div>
              <div className="lg:col-span-2">Peran akun</div>
              <div className="lg:col-span-2">Sumber nominal</div>
              <div className="lg:col-span-5">Akun COA</div>
              <div className="lg:col-span-1" />
            </div>

            <div className="mt-2 space-y-3">
              {form.lines.map((line) => {
                const accountOptions = isCashBankLineRole(line.line_role)
                  ? coaCashBankOptions.length > 0
                    ? coaCashBankOptions
                    : coaOptionsAll
                  : coaOptionsAll;
                return (
                  <div
                    key={line.key}
                    className="grid gap-2 rounded-lg border border-gray-200/70 bg-muted/20 p-3 lg:grid-cols-12"
                  >
                    <div className="space-y-1 lg:col-span-2">
                      <span className="text-xs text-muted-foreground lg:hidden">
                        Sisi (Debit/Credit)
                      </span>
                      <Combobox
                        options={sideOptions}
                        value={line.entry_side}
                        onChange={(value) =>
                          updateLine(line.key, {
                            entry_side: value as JournalEntrySide,
                          })
                        }
                        placeholder="Debit / Credit"
                        className={formComboboxClassName}
                      />
                    </div>
                    <div className="space-y-1 lg:col-span-2">
                      <span className="text-xs text-muted-foreground lg:hidden">
                        Peran akun
                      </span>
                      <Combobox
                        options={roleOptions}
                        value={line.line_role}
                        onChange={(value) =>
                          updateLine(line.key, { line_role: value })
                        }
                        placeholder="Peran akun"
                        searchPlaceholder="Cari peran..."
                        className={formComboboxClassName}
                      />
                    </div>
                    <div className="space-y-1 lg:col-span-2">
                      <span className="text-xs text-muted-foreground lg:hidden">
                        Sumber nominal
                      </span>
                      <Combobox
                        options={amountOptions}
                        value={line.amount_source}
                        onChange={(value) =>
                          updateLine(line.key, {
                            amount_source: value as JournalAmountSource,
                          })
                        }
                        placeholder="Sumber nominal"
                        className={formComboboxClassName}
                      />
                    </div>
                    <div className="space-y-1 lg:col-span-5">
                      <span className="text-xs text-muted-foreground lg:hidden">
                        Akun COA
                      </span>
                      <Combobox
                        options={accountOptions}
                        value={line.account_id}
                        onChange={(value) =>
                          updateLine(line.key, { account_id: value })
                        }
                        placeholder="Pilih akun COA"
                        searchPlaceholder="Cari akun..."
                        allowClear
                        className={formComboboxClassName}
                      />
                    </div>
                    <div className="flex items-center justify-end lg:col-span-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 text-muted-foreground hover:text-destructive"
                        onClick={() => removeLine(line.key)}
                        disabled={form.lines.length <= 1}
                        aria-label="Hapus baris"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 rounded-lg border border-primary/15 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Arti kolom</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4">
                <li>
                  <span className="font-medium text-foreground">Sisi</span> —
                  Debit (kiri) atau Credit (kanan) di jurnal.
                </li>
                <li>
                  <span className="font-medium text-foreground">Peran akun</span>{" "}
                  — fungsi baris (CASH, BANK, REVENUE, TAX, INVENTORY, AP, …).
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    Sumber nominal
                  </span>{" "}
                  — field transaksi yang diisi (TOTAL, SUBTOTAL, TAX, COGS,
                  PAID, …).
                </li>
                <li>
                  <span className="font-medium text-foreground">Akun COA</span> —
                  akun postable di Chart of Accounts (CASH/BANK diutamakan
                  akun Kas/Bank).
                </li>
              </ul>
            </div>
          </section>
        </FormPageBody>

        <FormPageFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(JOURNAL_MAPPING_ROUTES.list)}
            disabled={isSaving}
            className="h-10 rounded-lg border-gray-200/80"
          >
            Batal
          </Button>
          <Button
            type="submit"
            disabled={isSaving}
            className="h-10 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Menyimpan...
              </>
            ) : (
              "Simpan"
            )}
          </Button>
        </FormPageFooter>
      </form>
    </FormPageLayout>
  );
}
