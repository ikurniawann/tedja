"use client";

import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ToastContainer, useToast } from "@/components/ui/toast";
import { apiGet, apiPut } from "@/lib/api-client";

/**
 * Konfigurasi KPI per DEPARTEMEN (owner 2026-08-31): HRD menceklis
 * indikator mana yang mempengaruhi KPI tiap departemen + bobotnya —
 * mis. absen dihitung utk Service, tidak utk Human Resources.
 * Departemen yang belum dikonfigurasi memakai bawaan (pemetaan peran
 * lama). Perubahan berlaku mulai snapshot bulan berikutnya; scorecard
 * final tidak pernah dihitung ulang.
 */

interface Indicator {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unit: string | null;
  direction: string;
}
interface Mapping {
  department_id: string;
  indicator_id: string;
  weight: number | string;
  updated_by: string | null;
}
interface Department {
  id: string;
  name: string;
}

export function KpiConfigPage() {
  const { toasts, showToast, removeToast } = useToast();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [activeDept, setActiveDept] = useState<string>("");
  // Suntingan per peran menimpa baseline dari mapping tersimpan — tanpa
  // effect sinkronisasi, pindah peran tidak kehilangan suntingan.
  const [edits, setEdits] = useState<
    Record<string, Record<string, { enabled: boolean; weight: string }>>
  >({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<{
      data: { departments: Department[]; indicators: Indicator[]; mappings: Mapping[] };
    }>("/api/hris/kpi-config")
      .then((res) => {
        setDepartments(res.data.departments);
        setIndicators(res.data.indicators);
        setMappings(res.data.mappings);
        setActiveDept((prev) => prev || res.data.departments[0]?.id || "");
      })
      .catch((err) =>
        showToast(err instanceof Error ? err.message : "Gagal memuat konfigurasi", "error")
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deptConfigured = useMemo(
    () => mappings.some((m) => m.department_id === activeDept),
    [mappings, activeDept]
  );
  const draft = useMemo(() => {
    const next: Record<string, { enabled: boolean; weight: string }> = {};
    for (const ind of indicators) {
      const found = mappings.find(
        (m) => m.department_id === activeDept && m.indicator_id === ind.id
      );
      next[ind.id] =
        edits[activeDept]?.[ind.id] ??
        (found
          ? { enabled: true, weight: String(Math.round(Number(found.weight))) }
          : { enabled: false, weight: "10" });
    }
    return next;
  }, [activeDept, indicators, mappings, edits]);

  const setDraftItem = (
    indicatorId: string,
    patch: Partial<{ enabled: boolean; weight: string }>
  ) =>
    setEdits((prev) => ({
      ...prev,
      [activeDept]: {
        ...prev[activeDept],
        [indicatorId]: { ...draft[indicatorId], ...patch },
      },
    }));

  const totalWeight = useMemo(
    () =>
      Object.values(draft)
        .filter((d) => d.enabled)
        .reduce((sum, d) => sum + (Number(d.weight) || 0), 0),
    [draft]
  );

  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiPut<{ message: string }>("/api/hris/kpi-config", {
        department_id: activeDept,
        items: indicators.map((ind) => ({
          indicator_id: ind.id,
          enabled: draft[ind.id]?.enabled ?? false,
          weight: Number(draft[ind.id]?.weight) || 0,
        })),
      });
      showToast(res.message ?? "Tersimpan");
      // muat ulang mapping supaya pindah-pindah peran konsisten
      const fresh = await apiGet<{ data: { mappings: Mapping[] } }>("/api/hris/kpi-config");
      setMappings(fresh.data.mappings);
      setEdits((prev) => ({ ...prev, [activeDept]: {} }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal menyimpan", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <SlidersHorizontal className="h-6 w-6 text-primary" />
          Konfigurasi KPI
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Centang indikator yang mempengaruhi KPI tiap departemen beserta
          bobotnya. Perubahan berlaku mulai perhitungan bulan berikutnya —
          scorecard yang sudah final tidak berubah.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {departments.map((dept) => (
          <Button
            key={dept.id}
            size="sm"
            variant={dept.id === activeDept ? "default" : "outline"}
            onClick={() => setActiveDept(dept.id)}
          >
            {dept.name}
          </Button>
        ))}
      </div>

      {!loading && activeDept && !deptConfigured ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Departemen ini belum punya konfigurasi sendiri — KPI-nya masih
          memakai bawaan sistem. Centang indikator lalu Simpan untuk
          mengaturnya.
        </p>
      ) : null}

      {loading ? (
        <Card>
          <CardContent className="flex items-center gap-2 p-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {indicators.map((ind) => {
              const d = draft[ind.id] ?? { enabled: false, weight: "10" };
              return (
                <div key={ind.id} className="flex items-center gap-3 px-4 py-3">
                  <Checkbox
                    checked={d.enabled}
                    onCheckedChange={(v) => setDraftItem(ind.id, { enabled: v === true })}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {ind.name}
                      <span className="ml-2 text-xs text-gray-400">
                        {ind.unit ?? ""} ·{" "}
                        {ind.direction === "lower_better"
                          ? "makin rendah makin baik"
                          : ind.direction === "boolean"
                            ? "tercapai / tidak"
                            : "makin tinggi makin baik"}
                      </span>
                    </p>
                    {ind.description ? (
                      <p className="truncate text-xs text-gray-500">{ind.description}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={d.weight}
                      disabled={!d.enabled}
                      onChange={(e) => setDraftItem(ind.id, { weight: e.target.value })}
                      className="h-8 w-20 text-right"
                    />
                    <span className="text-xs text-gray-500">%</span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between rounded-lg border bg-white px-4 py-3">
        <p className="text-sm">
          Total bobot aktif:{" "}
          <span
            className={
              totalWeight === 100 ? "font-semibold text-emerald-600" : "font-semibold text-amber-600"
            }
          >
            {totalWeight}%
          </span>
          {totalWeight !== 100 ? (
            <span className="ml-2 text-xs text-gray-500">
              (tidak harus 100 — skor dinormalkan otomatis, tapi 100 paling mudah dibaca)
            </span>
          ) : null}
        </p>
        <Button onClick={handleSave} disabled={saving || loading || !activeDept}>
          {saving
            ? "Menyimpan…"
            : `Simpan ${departments.find((d) => d.id === activeDept)?.name ?? ""}`}
        </Button>
      </div>
    </div>
  );
}
