"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ToastContainer, useToast } from "@/components/ui/toast";
import {
  FormFieldLabel,
  formInputClassName,
} from "@/components/layout/form-field";
import {
  FormPageBody,
  FormPageFooter,
  FormPageHeader,
  FormPageLayout,
  FormPageLoading,
} from "@/components/layout/form-page-layout";
import { generateMonthlyPeriods, getOpenPeriodBlockReason } from "@/lib/accounting/fiscal-periods";
import type { FiscalPeriodStatus } from "@/lib/accounting/fiscal-types";
import { useFiscalYear } from "../queries";
import { useCreateFiscalYear, useUpdateFiscalYear } from "../mutations";
import type { FiscalPeriodPayload } from "../types";
import { FISCAL_YEAR_ROUTES } from "../routes";

type FormPeriod = {
  key: string;
  period_no: number;
  name: string;
  start_date: string;
  end_date: string;
  status: FiscalPeriodStatus;
};

type FormState = {
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  periods: FormPeriod[];
};

function defaultYearDates() {
  const y = new Date().getFullYear();
  return {
    start_date: `${y}-01-01`,
    end_date: `${y}-12-31`,
    code: String(y),
    name: `Fiscal Year ${y}`,
  };
}

function toFormPeriods(
  periods: ReturnType<typeof generateMonthlyPeriods>
): FormPeriod[] {
  return periods.map((p) => ({
    key: `p-${p.period_no}`,
    ...p,
  }));
}

export function FiscalYearFormPage({
  mode,
  fiscalYearId,
}: {
  mode: "create" | "edit";
  fiscalYearId?: string;
}) {
  const router = useRouter();
  const { toasts, showToast, removeToast } = useToast();
  const defaults = defaultYearDates();
  const [form, setForm] = useState<FormState>(() => ({
    code: defaults.code,
    name: defaults.name,
    start_date: defaults.start_date,
    end_date: defaults.end_date,
    is_active: true,
    periods:
      mode === "create"
        ? toFormPeriods(
            generateMonthlyPeriods(defaults.start_date, defaults.end_date)
          )
        : [],
  }));
  const [hydrated, setHydrated] = useState(mode === "create");

  const { data: existing, isLoading, isError } = useFiscalYear(
    mode === "edit" ? fiscalYearId ?? null : null
  );
  const createMutation = useCreateFiscalYear();
  const updateMutation = useUpdateFiscalYear();
  const isSaving = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (mode !== "edit" || !existing || hydrated) return;
    setForm({
      code: existing.code,
      name: existing.name,
      start_date: existing.start_date,
      end_date: existing.end_date,
      is_active: existing.is_active,
      periods: existing.periods.map((p) => ({
        key: p.id,
        period_no: p.period_no,
        name: p.name,
        start_date: p.start_date,
        end_date: p.end_date,
        status: p.status,
      })),
    });
    setHydrated(true);
  }, [mode, existing, hydrated]);

  function regeneratePeriods() {
    try {
      const periods = generateMonthlyPeriods(form.start_date, form.end_date);
      setForm((f) => ({
        ...f,
        periods: periods.map((p) => {
          const prev = f.periods.find((x) => x.period_no === p.period_no);
          return {
            key: prev?.key ?? `p-${p.period_no}`,
            ...p,
            // Pakai status generate (period 1 OPEN, sisanya CLOSED) agar urutan valid
            name: prev?.name || p.name,
          };
        }),
      }));
      showToast("12 period bulanan digenerate ulang", "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Gagal generate period",
        "error"
      );
    }
  }

  function updatePeriod(key: string, patch: Partial<FormPeriod>) {
    setForm((f) => ({
      ...f,
      periods: f.periods.map((p) => (p.key === key ? { ...p, ...patch } : p)),
    }));
  }

  function togglePeriodStatus(key: string) {
    const target = form.periods.find((p) => p.key === key);
    if (!target) return;

    // CLOSED → OPEN: wajib period sebelumnya sudah CLOSED
    if (target.status === "CLOSED") {
      const block = getOpenPeriodBlockReason(form.periods, target.period_no);
      if (block) {
        showToast(block, "error");
        return;
      }
    }

    setForm((f) => ({
      ...f,
      periods: f.periods.map((p) =>
        p.key === key
          ? { ...p, status: p.status === "OPEN" ? "CLOSED" : "OPEN" }
          : p
      ),
    }));
  }

  function openNextPeriod() {
    const sorted = [...form.periods].sort((a, b) => a.period_no - b.period_no);
    const openPeriods = sorted.filter((p) => p.status === "OPEN");
    const lastOpen = openPeriods[openPeriods.length - 1];
    const next = lastOpen
      ? sorted.find((p) => p.period_no === lastOpen.period_no + 1)
      : sorted.find((p) => p.status === "CLOSED");

    if (!next) {
      showToast("Tidak ada period berikutnya yang bisa dibuka", "error");
      return;
    }

    setForm((f) => ({
      ...f,
      periods: f.periods.map((p) => {
        if (p.period_no < next.period_no && p.status === "OPEN") {
          return { ...p, status: "CLOSED" as const };
        }
        if (p.key === next.key) {
          return { ...p, status: "OPEN" as const };
        }
        return p;
      }),
    }));

    const closedNames = openPeriods
      .filter((p) => p.period_no < next.period_no)
      .map((p) => p.name)
      .join(", ");
    showToast(
      closedNames
        ? `Menutup ${closedNames} → membuka ${next.name}. Simpan untuk menerapkan.`
        : `Menyarankan buka ${next.name}. Simpan untuk menerapkan.`,
      "success"
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    if (!form.code.trim() || !form.name.trim()) {
      showToast("Kode dan nama wajib diisi", "error");
      return;
    }
    if (form.periods.length < 1) {
      showToast("Generate period terlebih dahulu", "error");
      return;
    }

    const periods: FiscalPeriodPayload[] = form.periods.map((p) => ({
      period_no: p.period_no,
      name: p.name.trim(),
      start_date: p.start_date,
      end_date: p.end_date,
      status: p.status,
    }));

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      start_date: form.start_date,
      end_date: form.end_date,
      is_active: form.is_active,
      periods,
    };

    try {
      if (mode === "edit" && fiscalYearId) {
        const res = await updateMutation.mutateAsync({
          id: fiscalYearId,
          ...payload,
        });
        showToast(res.message || "Fiscal year berhasil diperbarui", "success");
        router.push(FISCAL_YEAR_ROUTES.list);
      } else {
        const res = await createMutation.mutateAsync(payload);
        showToast(
          res.message || "Fiscal year berhasil ditambahkan",
          "success"
        );
        // Setelah fiscal dibuat → langsung ke Beginning Balance
        router.push(FISCAL_YEAR_ROUTES.beginningBalance(res.data.id));
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Gagal menyimpan",
        "error"
      );
    }
  }

  if (mode === "edit" && isLoading) return <FormPageLoading />;

  if (mode === "edit" && (isError || (!isLoading && !existing))) {
    return (
      <FormPageLayout>
        <FormPageHeader
          title="Fiscal year tidak ditemukan"
          description="Data mungkin sudah dihapus."
          onBack={() => router.push(FISCAL_YEAR_ROUTES.list)}
        />
      </FormPageLayout>
    );
  }

  return (
    <FormPageLayout>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <FormPageHeader
        title={mode === "edit" ? "Edit Fiscal Year" : "Tambah Fiscal Year"}
        description="Tentukan rentang tahun fiskal lalu generate 12 period bulanan. Period berikutnya hanya bisa OPEN setelah period sebelumnya CLOSED. Fiscal year baru juga tidak bisa OPEN jika fiscal sebelumnya masih punya period OPEN."
        onBack={() => router.push(FISCAL_YEAR_ROUTES.list)}
      />

      <form onSubmit={handleSave} className="space-y-6">
        <FormPageBody>
          <section className="rounded-xl border border-gray-200/70 bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground">
              Informasi fiscal year
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <FormFieldLabel required>Kode</FormFieldLabel>
                <Input
                  value={form.code}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, code: e.target.value }))
                  }
                  className={formInputClassName}
                  required
                />
              </div>
              <div className="space-y-1.5">
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
              <div className="space-y-1.5">
                <FormFieldLabel required>Start date</FormFieldLabel>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, start_date: e.target.value }))
                  }
                  className={formInputClassName}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <FormFieldLabel required>End date</FormFieldLabel>
                <Input
                  type="date"
                  value={form.end_date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, end_date: e.target.value }))
                  }
                  className={formInputClassName}
                  required
                />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Checkbox
                  checked={form.is_active}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, is_active: Boolean(v) }))
                  }
                />
                Aktif
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200/70 bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Periods
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Toggle OPEN/CLOSED per period. Tidak bisa OPEN jika period
                  sebelumnya belum CLOSED. Generate: period 1 OPEN, sisanya
                  CLOSED.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={openNextPeriod}
                  disabled={form.periods.length === 0}
                  className="h-9 rounded-lg border-primary/20 text-primary"
                >
                  Buka period berikutnya
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={regeneratePeriods}
                  className="h-9 rounded-lg border-gray-200/80"
                >
                  Generate 12 period
                </Button>
              </div>
            </div>

            {form.periods.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Belum ada period. Klik Generate 12 period.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-2">No</th>
                      <th className="px-2 py-2">Nama</th>
                      <th className="px-2 py-2">Start</th>
                      <th className="px-2 py-2">End</th>
                      <th className="px-2 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.periods.map((p) => (
                      <tr
                        key={p.key}
                        className="border-b border-gray-200/70 last:border-0"
                      >
                        <td className="px-2 py-2 text-muted-foreground">
                          {p.period_no}
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            value={p.name}
                            onChange={(e) =>
                              updatePeriod(p.key, { name: e.target.value })
                            }
                            className="h-9 border-gray-200/80"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            type="date"
                            value={p.start_date}
                            onChange={(e) =>
                              updatePeriod(p.key, {
                                start_date: e.target.value,
                              })
                            }
                            className="h-9 border-gray-200/80"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            type="date"
                            value={p.end_date}
                            onChange={(e) =>
                              updatePeriod(p.key, {
                                end_date: e.target.value,
                              })
                            }
                            className="h-9 border-gray-200/80"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => togglePeriodStatus(p.key)}
                            title={
                              p.status === "CLOSED"
                                ? getOpenPeriodBlockReason(
                                    form.periods,
                                    p.period_no
                                  ) ?? "Klik untuk OPEN"
                                : "Klik untuk CLOSED"
                            }
                            className={
                              p.status === "OPEN"
                                ? "h-8 border-primary/20 text-primary"
                                : "h-8 border-gray-200/80 text-muted-foreground"
                            }
                          >
                            {p.status}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </FormPageBody>

        <FormPageFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(FISCAL_YEAR_ROUTES.list)}
            disabled={isSaving}
            className="h-10 rounded-lg border-gray-200/80"
          >
            Batal
          </Button>
          <Button
            type="submit"
            disabled={isSaving}
            className="h-10 gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Simpan
          </Button>
        </FormPageFooter>
      </form>
    </FormPageLayout>
  );
}
