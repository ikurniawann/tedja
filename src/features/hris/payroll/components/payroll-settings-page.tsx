"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeftIcon, Cog6ToothIcon } from "@heroicons/react/24/outline";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { usePayrollSettings } from "../queries";
import { useSavePayrollSettings } from "../mutations";

interface FieldDef {
  key: string;
  label: string;
  suffix?: string;
}

const BPJS_TK_FIELDS: FieldDef[] = [
  { key: "bpjs_tk_jht_employee", label: "JHT Karyawan", suffix: "%" },
  { key: "bpjs_tk_jht_employer", label: "JHT Perusahaan", suffix: "%" },
  { key: "bpjs_tk_jp_employee", label: "JP Karyawan", suffix: "%" },
  { key: "bpjs_tk_jp_employer", label: "JP Perusahaan", suffix: "%" },
  { key: "bpjs_tk_jkk", label: "JKK (Perusahaan)", suffix: "%" },
  { key: "bpjs_tk_jkm", label: "JKM (Perusahaan)", suffix: "%" },
];

const BPJS_KES_FIELDS: FieldDef[] = [
  { key: "bpjs_kes_employee", label: "Karyawan", suffix: "%" },
  { key: "bpjs_kes_employer", label: "Perusahaan", suffix: "%" },
  { key: "bpjs_kes_max_upah", label: "Batas Upah Maks", suffix: "Rp" },
];

const TAPERA_FIELDS: FieldDef[] = [
  { key: "tapera_employee", label: "Karyawan", suffix: "%" },
  { key: "tapera_employer", label: "Perusahaan", suffix: "%" },
];

const LAINNYA_FIELDS: FieldDef[] = [
  { key: "overtime_multiplier", label: "Pengali Lembur", suffix: "×" },
  { key: "overtime_hourly_divisor", label: "Pembagi Upah/Jam Lembur", suffix: "std 173" },
  { key: "payroll_day", label: "Tanggal Gajian", suffix: "tgl" },
  { key: "thr_eligible_months", label: "Min. Bulan Kerja THR", suffix: "bln" },
];

const LATE_MODE_OPTIONS = [
  { value: "off", label: "Nonaktif (tanpa potongan)" },
  { value: "per_minute", label: "Per menit keterlambatan" },
  { value: "flat", label: "Flat per kejadian terlambat" },
];

const PTKP_FIELDS: FieldDef[] = [
  { key: "ptkp_tk_0", label: "TK/0", suffix: "Rp" },
  { key: "ptkp_tk_1", label: "TK/1", suffix: "Rp" },
  { key: "ptkp_tk_2", label: "TK/2", suffix: "Rp" },
  { key: "ptkp_tk_3", label: "TK/3", suffix: "Rp" },
  { key: "ptkp_k_0", label: "K/0", suffix: "Rp" },
  { key: "ptkp_k_1", label: "K/1", suffix: "Rp" },
  { key: "ptkp_k_2", label: "K/2", suffix: "Rp" },
  { key: "ptkp_k_3", label: "K/3", suffix: "Rp" },
];

const BRACKET_FIELDS: FieldDef[] = [
  { key: "bracket_1_limit", label: "Batas Lapisan 1", suffix: "Rp" },
  { key: "bracket_1_rate", label: "Tarif Lapisan 1", suffix: "%" },
  { key: "bracket_2_limit", label: "Batas Lapisan 2", suffix: "Rp" },
  { key: "bracket_2_rate", label: "Tarif Lapisan 2", suffix: "%" },
  { key: "bracket_3_limit", label: "Batas Lapisan 3", suffix: "Rp" },
  { key: "bracket_3_rate", label: "Tarif Lapisan 3", suffix: "%" },
  { key: "bracket_4_limit", label: "Batas Lapisan 4", suffix: "Rp" },
  { key: "bracket_4_rate", label: "Tarif Lapisan 4", suffix: "%" },
  { key: "bracket_5_rate", label: "Tarif Lapisan 5", suffix: "%" },
  { key: "jabatan_expense_percentage", label: "Biaya Jabatan", suffix: "%" },
  { key: "jabatan_expense_max", label: "Biaya Jabatan Maks/Thn", suffix: "Rp" },
];

const SETTINGS_KEYS = [
  ...[...BPJS_TK_FIELDS, ...BPJS_KES_FIELDS, ...TAPERA_FIELDS, ...LAINNYA_FIELDS].map(
    (f) => f.key
  ),
  "late_deduction_mode",
  "late_deduction_amount",
];

/** Kolom pengaturan bertipe teks — dikirim apa adanya, bukan angka. */
const STRING_SETTING_KEYS = new Set(["late_deduction_mode"]);

const TAX_KEYS = [...PTKP_FIELDS, ...BRACKET_FIELDS].map((f) => f.key);

type FormState = Record<string, string>;

function rowToFormState(
  row: Record<string, unknown> | null,
  keys: string[]
): FormState {
  const state: FormState = {};
  for (const key of keys) {
    const value = row?.[key];
    state[key] = value === null || value === undefined ? "" : String(value);
  }
  return state;
}

function formStateToPayload(state: FormState): Record<string, number | string> {
  const payload: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(state)) {
    if (value === "") continue;
    if (STRING_SETTING_KEYS.has(key)) {
      payload[key] = value;
      continue;
    }
    const n = Number(value);
    if (Number.isFinite(n)) payload[key] = n;
  }
  return payload;
}

interface FieldGridProps {
  fields: FieldDef[];
  state: FormState;
  onChange: (key: string, value: string) => void;
}

function FieldGrid({ fields, state, onChange }: FieldGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {fields.map((field) => (
        <div key={field.key}>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            {field.label}
            {field.suffix ? (
              <span className="ml-1 text-gray-400">({field.suffix})</span>
            ) : null}
          </label>
          <Input
            type="number"
            step="any"
            value={state[field.key] ?? ""}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

export function PayrollSettingsPage() {
  const router = useRouter();
  const { toasts, showToast, removeToast } = useToast();
  const currentYear = new Date().getFullYear();
  const [taxYear, setTaxYear] = useState(currentYear);

  const { data, isLoading } = usePayrollSettings(taxYear);
  const saveMutation = useSavePayrollSettings();

  // Nilai tampilan = data tersimpan + edit lokal yang belum disimpan.
  const [settingsEdits, setSettingsEdits] = useState<FormState>({});
  const [taxEdits, setTaxEdits] = useState<FormState>({});

  const settingsForm: FormState = {
    ...rowToFormState(data?.settings ?? null, SETTINGS_KEYS),
    ...settingsEdits,
  };
  const taxForm: FormState = {
    ...rowToFormState(data?.tax_config ?? null, TAX_KEYS),
    ...taxEdits,
  };

  const handleSettingsChange = (key: string, value: string) =>
    setSettingsEdits((prev) => ({ ...prev, [key]: value }));

  const handleTaxChange = (key: string, value: string) =>
    setTaxEdits((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    const settingsPayload = formStateToPayload(settingsEdits);
    const taxPayload = formStateToPayload(taxEdits);

    if (
      Object.keys(settingsPayload).length === 0 &&
      Object.keys(taxPayload).length === 0
    ) {
      showToast("Tidak ada perubahan untuk disimpan", "error");
      return;
    }

    try {
      await saveMutation.mutateAsync({
        ...(Object.keys(settingsPayload).length > 0
          ? { settings: settingsPayload }
          : {}),
        ...(Object.keys(taxPayload).length > 0
          ? { tax_config: { tax_year: taxYear, ...taxPayload } }
          : {}),
      });
      setSettingsEdits({});
      setTaxEdits({});
      showToast("Pengaturan payroll tersimpan", "success");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Gagal menyimpan pengaturan";
      showToast(message, "error");
    }
  };

  return (
    <div className="space-y-6 p-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/dashboard/hris/payroll")}
          >
            <ArrowLeftIcon className="mr-1 h-4 w-4" />
            Kembali
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Cog6ToothIcon className="h-6 w-6 text-pink-600" />
              Pengaturan Payroll
            </h1>
            <p className="text-sm text-gray-500">
              Sumber kebenaran tarif BPJS, PTKP, dan bracket PPh21 — dipakai
              langsung oleh kalkulasi payroll. Kosongkan kolom untuk memakai
              nilai default.
            </p>
          </div>
        </div>
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending || isLoading}
          className="bg-pink-600 hover:bg-pink-700"
        >
          {saveMutation.isPending ? "Menyimpan..." : "Simpan Pengaturan"}
        </Button>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-gray-500">
            Memuat pengaturan…
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                BPJS Ketenagakerjaan
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGrid
                fields={BPJS_TK_FIELDS}
                state={settingsForm}
                onChange={handleSettingsChange}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">BPJS Kesehatan</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGrid
                fields={BPJS_KES_FIELDS}
                state={settingsForm}
                onChange={handleSettingsChange}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tapera</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGrid
                fields={TAPERA_FIELDS}
                state={settingsForm}
                onChange={handleSettingsChange}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">THR, Lembur & Gajian</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGrid
                fields={LAINNYA_FIELDS}
                state={settingsForm}
                onChange={handleSettingsChange}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Potongan Keterlambatan</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Mode Potongan
                  </label>
                  <Select
                    value={settingsForm.late_deduction_mode || "off"}
                    onValueChange={(value) =>
                      handleSettingsChange("late_deduction_mode", value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih mode" />
                    </SelectTrigger>
                    <SelectContent>
                      {LATE_MODE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Tarif Potongan{" "}
                    <span className="text-gray-400">
                      (Rp — per menit / per kejadian sesuai mode)
                    </span>
                  </label>
                  <Input
                    type="number"
                    step="any"
                    value={settingsForm.late_deduction_amount ?? ""}
                    onChange={(e) =>
                      handleSettingsChange("late_deduction_amount", e.target.value)
                    }
                  />
                </div>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                Menit keterlambatan diambil dari absensi v2 (dihitung terhadap
                shift saat clock-in). Mode nonaktif = tidak ada potongan.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                PPh 21 — PTKP & Bracket (per Tahun Pajak)
              </CardTitle>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-600">
                  Tahun Pajak
                </label>
                <Input
                  type="number"
                  className="w-24"
                  value={taxYear}
                  onChange={(e) => {
                    const y = Number(e.target.value);
                    if (Number.isInteger(y) && y >= 2000 && y <= 2100) {
                      setTaxYear(y);
                      setTaxEdits({});
                    }
                  }}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  PTKP Tahunan
                </p>
                <FieldGrid
                  fields={PTKP_FIELDS}
                  state={taxForm}
                  onChange={handleTaxChange}
                />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Bracket Progresif (batas kumulatif) & Biaya Jabatan
                </p>
                <FieldGrid
                  fields={BRACKET_FIELDS}
                  state={taxForm}
                  onChange={handleTaxChange}
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
