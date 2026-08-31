"use client";

import { useCallback, useEffect, useState } from "react";
import { ChartNoAxesCombined, Loader2, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToastContainer, useToast } from "@/components/ui/toast";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";

/**
 * Performance Review kuartalan (owner 2026-08-31, Fase 1) + report KPI
 * berjalan. Nilai akhir 60% Hasil Kerja (KPI otomatis) + 30% Perilaku
 * (Head Division menilai 1–5) + 10% Kontribusi (opsional). UI dirancang
 * ramah HP/tablet (kartu sentuh, tombol besar) seperti Task Departemen.
 */

interface RtMonth { month: number; score: number | string | null; status: string }
interface RtEmployee {
  id: string; full_name: string; department_name: string | null;
  avg_score: number | string | null; months: RtMonth[] | null;
}
interface CycleRow {
  id: string; name: string; period_year: number; period_quarter: number;
  start_date: string; end_date: string; status: string;
  total_reviews: number; final_reviews: number; rated_reviews: number;
}
interface ReviewRow {
  id: string; employee_id: string; full_name: string; nip: string | null;
  department_name: string | null; status: string; category: string | null;
  total_work_result_score: number | string | null;
  total_behavioral_score: number | string | null;
  grand_total_score: number | string | null;
  employee_sign_date: string | null; reviewer_sign_date: string | null;
  reviewer_name: string | null; rated_items: number; total_items: number;
}
interface ItemRow {
  id: string; value_name: string; competency: string | null;
  behavioral_standard: string | null; score: number | null; notes: string | null;
  score_1_description: string | null; score_5_description: string | null;
}
interface DetailData {
  review: {
    id: string; full_name: string; nip: string | null; department_name: string | null;
    cycle_name: string; status: string; category: string | null;
    total_work_result_score: string | number | null;
    total_behavioral_score: string | number | null;
    total_project_score: string | number | null;
    grand_total_score: string | number | null;
    self_assessment: string | null; reviewer_notes: string | null;
    reviewer_name: string | null;
    employee_sign_date: string | null; reviewer_sign_date: string | null;
  };
  items: ItemRow[];
  kpi_months: { period_month: number; score: number | string | null; status: string }[];
  can_rate: boolean;
  can_finalize: boolean;
  is_owner: boolean;
}

const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function scoreCls(v: number | null): string {
  if (v === null) return "text-gray-400";
  if (v >= 90) return "text-emerald-600";
  if (v >= 75) return "text-blue-600";
  if (v >= 60) return "text-amber-600";
  return "text-red-600";
}

function categoryBadge(category: string | null) {
  if (!category) return null;
  const cls =
    category === "Istimewa" ? "bg-emerald-100 text-emerald-700"
    : category === "Baik" ? "bg-blue-100 text-blue-700"
    : category === "Cukup" ? "bg-amber-100 text-amber-700"
    : "bg-red-100 text-red-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{category}</span>;
}

export function PerformanceReviewPage() {
  const { toasts, showToast, removeToast } = useToast();
  const now = new Date();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;

  // ---- KPI Berjalan (realtime QTD) ----
  const [rtYear, setRtYear] = useState(now.getFullYear());
  const [rtQuarter, setRtQuarter] = useState(currentQuarter);
  const [rt, setRt] = useState<{ employees: RtEmployee[]; months: number[]; is_hr: boolean } | null>(null);

  const loadRealtime = useCallback((year: number, quarter: number) => {
    apiGet<{ data: { employees: RtEmployee[]; months: number[]; is_hr: boolean } }>(
      `/api/hris/performance/realtime?year=${year}&quarter=${quarter}`
    )
      .then((res) => setRt(res.data))
      .catch((err) => showToast(err instanceof Error ? err.message : "Gagal memuat KPI berjalan", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadRealtime(rtYear, rtQuarter);
  }, [rtYear, rtQuarter, loadRealtime]);

  // ---- Siklus review ----
  const [cycles, setCycles] = useState<{ cycles: CycleRow[]; is_hr: boolean } | null>(null);
  const [activeCycle, setActiveCycle] = useState<string>("");
  const [reviews, setReviews] = useState<{ reviews: ReviewRow[]; can_review: boolean } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadCycles = useCallback(() => {
    apiGet<{ data: { cycles: CycleRow[]; is_hr: boolean } }>("/api/hris/performance/cycles")
      .then((res) => {
        setCycles(res.data);
        setActiveCycle((prev) => prev || res.data.cycles[0]?.id || "");
      })
      .catch((err) => showToast(err instanceof Error ? err.message : "Gagal memuat siklus", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCycles();
  }, [loadCycles]);

  const loadReviews = useCallback((cycleId: string) => {
    if (!cycleId) return;
    apiGet<{ data: { reviews: ReviewRow[]; can_review: boolean } }>(
      `/api/hris/performance/reviews?cycle_id=${cycleId}`
    )
      .then((res) => setReviews(res.data))
      .catch((err) => showToast(err instanceof Error ? err.message : "Gagal memuat review", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeCycle) loadReviews(activeCycle);
  }, [activeCycle, loadReviews]);

  async function createCycle(year: number, quarter: number) {
    setBusy(true);
    try {
      const res = await apiPost<{ message: string }>("/api/hris/performance/cycles", {
        period_year: year,
        period_quarter: quarter,
      });
      showToast(res.message ?? "Siklus dibuka");
      setCreateOpen(false);
      loadCycles();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal membuka siklus", "error");
    } finally {
      setBusy(false);
    }
  }

  // ---- Detail review ----
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [selfDraft, setSelfDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");

  const loadDetail = useCallback((id: string) => {
    apiGet<{ data: DetailData }>(`/api/hris/performance/reviews/${id}`)
      .then((res) => {
        setDetail(res.data);
        setSelfDraft(res.data.review.self_assessment ?? "");
        setNotesDraft(res.data.review.reviewer_notes ?? "");
      })
      .catch((err) => showToast(err instanceof Error ? err.message : "Gagal memuat detail", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openDetail(id: string) {
    setDetail(null);
    setDetailId(id);
    loadDetail(id);
  }

  async function patchReview(payload: Record<string, unknown>, refresh = true) {
    if (!detailId || busy) return;
    setBusy(true);
    try {
      const res = await apiPatch<{ message: string }>(
        `/api/hris/performance/reviews/${detailId}`,
        payload
      );
      showToast(res.message ?? "Tersimpan");
      if (refresh) loadDetail(detailId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal menyimpan", "error");
    } finally {
      setBusy(false);
    }
  }

  function closeDetail() {
    setDetailId(null);
    setDetail(null);
    if (activeCycle) loadReviews(activeCycle);
    loadCycles();
  }

  const quarterOptions = [1, 2, 3, 4];
  const yearOptions = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <ChartNoAxesCombined className="h-6 w-6 text-primary" />
          Performance Review
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Rapor kinerja kuartalan: 60% Hasil Kerja (KPI otomatis) + 30% Perilaku
          (dinilai Head Division) + 10% Kontribusi. Pantau KPI berjalan kapan
          saja tanpa menunggu siklus dibuka.
        </p>
      </div>

      <Tabs defaultValue="realtime">
        <TabsList>
          <TabsTrigger value="realtime">KPI Berjalan</TabsTrigger>
          <TabsTrigger value="cycles">Siklus Review</TabsTrigger>
        </TabsList>

        {/* ---------- TAB KPI BERJALAN ---------- */}
        <TabsContent value="realtime" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {yearOptions.map((y) => (
              <Button key={y} size="sm" variant={y === rtYear ? "default" : "outline"} onClick={() => { setRt(null); setRtYear(y); }}>
                {y}
              </Button>
            ))}
            <span className="mx-1 text-gray-300">|</span>
            {quarterOptions.map((q) => (
              <Button key={q} size="sm" variant={q === rtQuarter ? "default" : "outline"} onClick={() => { setRt(null); setRtQuarter(q); }}>
                Q{q}
              </Button>
            ))}
          </div>

          {rt === null ? (
            <Card><CardContent className="flex items-center gap-2 p-6 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rt.employees.map((emp) => {
                const avg = num(emp.avg_score);
                return (
                  <Card key={emp.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-gray-900">{emp.full_name}</p>
                          <p className="truncate text-xs text-gray-500">{emp.department_name ?? "—"}</p>
                        </div>
                        <p className={`text-xl font-bold ${scoreCls(avg)}`}>
                          {avg === null ? "—" : avg.toFixed(1)}
                        </p>
                      </div>
                      <div className="mt-2 flex gap-2">
                        {rt.months.map((m) => {
                          const found = (emp.months ?? []).find((row) => row.month === m);
                          const s = num(found?.score ?? null);
                          return (
                            <span key={m} className="flex-1 rounded-md bg-muted/60 px-2 py-1 text-center text-xs">
                              <span className="block text-[10px] text-gray-400">{MONTH_SHORT[m]}</span>
                              <span className={`font-semibold ${scoreCls(s)}`}>{s === null ? "—" : s.toFixed(0)}</span>
                            </span>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {rt.employees.length === 0 ? (
                <p className="col-span-full rounded-lg border border-dashed p-6 text-center text-sm text-gray-500">
                  Belum ada data KPI pada kuartal ini.
                </p>
              ) : null}
            </div>
          )}
        </TabsContent>

        {/* ---------- TAB SIKLUS REVIEW ---------- */}
        <TabsContent value="cycles" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {(cycles?.cycles ?? []).map((c) => (
              <Button key={c.id} size="sm" variant={c.id === activeCycle ? "default" : "outline"} onClick={() => { setReviews(null); setActiveCycle(c.id); }}>
                {c.name}
                <span className="ml-1 text-xs opacity-70">{c.final_reviews}/{c.total_reviews} final</span>
              </Button>
            ))}
            {cycles?.is_hr ? (
              <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />Buka Siklus
              </Button>
            ) : null}
            {cycles?.is_hr ? (
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader><DialogTitle>Buka Siklus Review</DialogTitle></DialogHeader>
                  <p className="text-sm text-gray-500">
                    Sistem akan membuat draft review untuk semua karyawan aktif,
                    terisi otomatis rata-rata KPI kuartal tersebut.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {yearOptions.map((y) =>
                      quarterOptions.map((q) => (
                        <Button
                          key={`${y}-${q}`}
                          variant="outline"
                          disabled={busy}
                          onClick={() => createCycle(y, q)}
                        >
                          Q{q} {y}
                        </Button>
                      ))
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            ) : null}
          </div>

          {cycles !== null && cycles.cycles.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-gray-500">
              Belum ada siklus review. {cycles.is_hr ? "Klik “Buka Siklus” untuk memulai." : "HRD belum membuka siklus."}
            </p>
          ) : null}

          {activeCycle ? (
            reviews === null ? (
              <Card><CardContent className="flex items-center gap-2 p-6 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
              </CardContent></Card>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {reviews.reviews.map((r) => {
                  const grand = num(r.grand_total_score);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => openDetail(r.id)}
                      className="rounded-xl border-2 border-gray-200 bg-white p-4 text-left transition-colors hover:border-primary/40 active:bg-gray-50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-gray-900">{r.full_name}</p>
                          <p className="truncate text-xs text-gray-500">{r.department_name ?? "—"}</p>
                        </div>
                        <p className={`text-xl font-bold ${scoreCls(grand)}`}>
                          {grand === null || grand === 0 ? "—" : grand.toFixed(1)}
                        </p>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {categoryBadge(r.category)}
                        <Badge variant={r.status === "final" ? "default" : "outline"}>
                          {r.status === "final" ? "Final" : "Draft"}
                        </Badge>
                        <span className="text-xs text-gray-400">
                          Perilaku {r.rated_items}/{r.total_items}
                        </span>
                        {r.employee_sign_date ? <span className="text-xs text-emerald-600">✓ ttd karyawan</span> : null}
                        {r.reviewer_sign_date ? <span className="text-xs text-emerald-600">✓ ttd reviewer</span> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          ) : null}
        </TabsContent>
      </Tabs>

      {/* ---------- DIALOG DETAIL REVIEW ---------- */}
      <Dialog open={detailId !== null} onOpenChange={(open) => { if (!open) closeDetail(); }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          {detail === null ? (
            <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
            </div>
          ) : (
            <div className="space-y-5">
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {detail.review.full_name}
                  {categoryBadge(detail.review.category)}
                  <Badge variant={detail.review.status === "final" ? "default" : "outline"}>
                    {detail.review.status === "final" ? "Final" : "Draft"}
                  </Badge>
                </DialogTitle>
              </DialogHeader>
              <p className="-mt-3 text-sm text-gray-500">
                {detail.review.cycle_name} · {detail.review.department_name ?? "—"}
              </p>

              {/* Ringkasan nilai */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: "Hasil Kerja (60%)", value: num(detail.review.total_work_result_score) },
                  { label: "Perilaku (30%)", value: num(detail.review.total_behavioral_score) },
                  { label: "Kontribusi (10%)", value: num(detail.review.total_project_score) },
                  { label: "Nilai Akhir", value: num(detail.review.grand_total_score) },
                ].map((cell) => (
                  <div key={cell.label} className="rounded-lg bg-muted/50 p-3 text-center">
                    <p className={`text-lg font-bold ${scoreCls(cell.value === 0 ? null : cell.value)}`}>
                      {cell.value === null || cell.value === 0 ? "—" : cell.value.toFixed(1)}
                    </p>
                    <p className="text-[11px] text-gray-500">{cell.label}</p>
                  </div>
                ))}
              </div>

              {/* KPI per bulan */}
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-700">Hasil Kerja — KPI per bulan</p>
                <div className="flex gap-2">
                  {detail.kpi_months.length === 0 ? (
                    <p className="text-xs text-gray-400">Belum ada scorecard KPI pada kuartal ini.</p>
                  ) : (
                    detail.kpi_months.map((m) => {
                      const s = num(m.score);
                      return (
                        <span key={m.period_month} className="flex-1 rounded-md bg-muted/60 px-2 py-1 text-center text-xs">
                          <span className="block text-[10px] text-gray-400">{MONTH_SHORT[m.period_month]}</span>
                          <span className={`font-semibold ${scoreCls(s)}`}>{s === null ? "—" : s.toFixed(0)}</span>
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Penilaian perilaku — kartu sentuh 1–5 */}
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-700">
                  Perilaku Kerja {detail.can_rate && detail.review.status !== "final" ? "— tap 1–5 untuk menilai" : ""}
                </p>
                <div className="space-y-2">
                  {detail.items.map((item) => (
                    <div key={item.id} className="rounded-xl border-2 border-gray-200 bg-white p-3">
                      <p className="text-sm font-medium text-gray-800">{item.value_name}</p>
                      {item.behavioral_standard ? (
                        <p className="text-xs text-gray-500">{item.behavioral_standard}</p>
                      ) : null}
                      <div className="mt-2 flex gap-2">
                        {[1, 2, 3, 4, 5].map((s) => {
                          const active = item.score === s;
                          const canTap = detail.can_rate && detail.review.status !== "final" && !busy;
                          return (
                            <button
                              key={s}
                              type="button"
                              disabled={!canTap}
                              onClick={() => patchReview({ action: "rate_item", item_id: item.id, score: s })}
                              className={`flex h-11 flex-1 items-center justify-center rounded-lg border-2 text-sm font-semibold transition-colors ${
                                active
                                  ? "border-emerald-500 bg-emerald-500 text-white"
                                  : "border-gray-200 bg-white text-gray-600 active:bg-gray-50"
                              } ${canTap ? "" : "opacity-60"}`}
                            >
                              {s}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Self assessment */}
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-700">Self Assessment (karyawan)</p>
                {detail.is_owner && detail.review.status !== "final" ? (
                  <div className="space-y-2">
                    <Textarea
                      value={selfDraft}
                      onChange={(e) => setSelfDraft(e.target.value)}
                      placeholder="Refleksi kinerja kuartal ini: pencapaian, kendala, rencana perbaikan…"
                      rows={3}
                    />
                    <Button size="sm" disabled={busy} onClick={() => patchReview({ action: "self_assessment", text: selfDraft })}>
                      Simpan Self Assessment
                    </Button>
                  </div>
                ) : (
                  <p className="rounded-lg bg-muted/50 p-3 text-sm text-gray-600">
                    {detail.review.self_assessment || "Belum diisi."}
                  </p>
                )}
              </div>

              {/* Catatan reviewer */}
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-700">
                  Catatan Reviewer{detail.review.reviewer_name ? ` — ${detail.review.reviewer_name}` : ""}
                </p>
                {detail.can_rate && detail.review.status !== "final" ? (
                  <div className="space-y-2">
                    <Textarea
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      placeholder="Catatan pembinaan, apresiasi, atau kontribusi khusus…"
                      rows={3}
                    />
                    <Button size="sm" disabled={busy} onClick={() => patchReview({ action: "reviewer_notes", text: notesDraft })}>
                      Simpan Catatan
                    </Button>
                  </div>
                ) : (
                  <p className="rounded-lg bg-muted/50 p-3 text-sm text-gray-600">
                    {detail.review.reviewer_notes || "Belum diisi."}
                  </p>
                )}
              </div>

              {/* Tanda tangan & finalisasi */}
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                {detail.is_owner && !detail.review.employee_sign_date ? (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => patchReview({ action: "sign" })}>
                    Tanda Tangan (Karyawan)
                  </Button>
                ) : null}
                {detail.can_rate && !detail.review.reviewer_sign_date ? (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => patchReview({ action: "sign" })}>
                    Tanda Tangan (Reviewer)
                  </Button>
                ) : null}
                {detail.review.employee_sign_date ? (
                  <span className="text-xs text-emerald-600">✓ Karyawan ttd {detail.review.employee_sign_date}</span>
                ) : null}
                {detail.review.reviewer_sign_date ? (
                  <span className="text-xs text-emerald-600">✓ Reviewer ttd {detail.review.reviewer_sign_date}</span>
                ) : null}
                {detail.can_finalize && detail.review.status !== "final" ? (
                  <Button size="sm" className="ml-auto" disabled={busy} onClick={() => patchReview({ action: "finalize" })}>
                    Finalkan (HRD)
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
