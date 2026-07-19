"use client";

import { useState } from "react";
import { ChartBarIcon, UsersIcon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SkeletonCard } from "@/components/ui/skeleton-table";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { useKpiHistory, useKpiTeam } from "../queries";
import { useSaveKpiRubric } from "../mutations";
import type { KpiScorecardRow } from "../types";
import { ScorecardBreakdown } from "./scorecard-breakdown";

const MONTH_LABELS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const num = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const periodLabel = (row: KpiScorecardRow) =>
  `${MONTH_LABELS[row.period_month - 1]} ${row.period_year}`;

/**
 * ESS → KPI Saya: riwayat skor bulanan pribadi (Fase C) + section
 * "Tim Saya" utk atasan langsung menilai rubrik bawahannya (Fase E/MSS).
 */
export function EssKpiPage() {
  const { toasts, showToast, removeToast } = useToast();
  const [detail, setDetail] = useState<KpiScorecardRow | null>(null);
  const [teamDetail, setTeamDetail] = useState<KpiScorecardRow | null>(null);
  const [rubricValue, setRubricValue] = useState("");
  const [rubricNotes, setRubricNotes] = useState("");

  const historyQuery = useKpiHistory("me", 12);
  const rows = historyQuery.data?.data ?? [];
  const indicators = historyQuery.data?.indicators ?? [];
  const latest = rows[0] ?? null;
  const latestScore = latest ? num(latest.score) : null;

  const now = new Date();
  const teamQuery = useKpiTeam({
    period_year: now.getFullYear(),
    period_month: now.getMonth() + 1,
  });
  const teamRows = teamQuery.data?.data ?? [];
  const teamIndicators = teamQuery.data?.indicators ?? [];
  const rubricMutation = useSaveKpiRubric();

  async function saveTeamRubric() {
    if (!teamDetail || !rubricValue) {
      showToast("Pilih nilai rubrik 1-5", "error");
      return;
    }
    try {
      await rubricMutation.mutateAsync({
        employee_id: teamDetail.employee_id,
        period_month: teamDetail.period_month,
        period_year: teamDetail.period_year,
        value: Number(rubricValue),
        notes: rubricNotes || undefined,
      });
      setRubricValue("");
      setRubricNotes("");
      setTeamDetail(null);
      showToast("Penilaian tersimpan — skor diperbarui", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Gagal menyimpan penilaian",
        "error"
      );
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <ChartBarIcon className="h-6 w-6" /> KPI Saya
        </h1>
        <p className="text-sm text-muted-foreground">
          Skor kinerja bulanan Anda (0–100), dihitung dari data operasional +
          penilaian atasan.
        </p>
      </div>

      {historyQuery.isLoading && <SkeletonCard />}

      {!historyQuery.isLoading && rows.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Belum ada scorecard KPI untuk akun Anda.
          </CardContent>
        </Card>
      )}

      {latest && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Skor Terakhir — {periodLabel(latest)}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-6">
            <span className="text-5xl font-bold">
              {latestScore === null ? "—" : latestScore.toLocaleString("id-ID")}
            </span>
            <div className="space-y-1">
              <Badge
                variant="outline"
                className={
                  latest.status === "final"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-gray-200 bg-gray-100 text-gray-700"
                }
              >
                {latest.status === "final" ? "Final" : "Draft"}
              </Badge>
              <p className="text-xs text-muted-foreground">
                {latestScore === null
                  ? "Belum ada data terkumpul periode ini."
                  : "Klik riwayat di bawah untuk rincian per indikator."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Riwayat 12 Bulan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {rows.map((row) => {
              const score = num(row.score);
              return (
                <button
                  key={row.id}
                  onClick={() => setDetail(row)}
                  className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition hover:bg-muted/40"
                >
                  <span className="font-medium">{periodLabel(row)}</span>
                  <span className="flex items-center gap-3">
                    <span className="h-2 w-32 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-2 rounded-full bg-emerald-500"
                        style={{ width: `${Math.min(100, score ?? 0)}%` }}
                      />
                    </span>
                    <span className="w-12 text-right font-semibold">
                      {score === null ? "—" : score.toLocaleString("id-ID")}
                    </span>
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}

      {teamRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersIcon className="h-4 w-4" /> Tim Saya — Penilaian Bulan Ini
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Sebagai atasan langsung, Anda menilai rubrik (1–5) anggota tim.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {teamRows.map((row) => {
              const score = num(row.score);
              return (
                <button
                  key={row.id}
                  onClick={() => setTeamDetail(row)}
                  className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition hover:bg-muted/40"
                >
                  <span>
                    <span className="font-medium">
                      {row.employee?.full_name ?? "-"}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {row.employee?.department?.name ?? ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Badge
                      variant="outline"
                      className={
                        row.status === "final"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-gray-200 bg-gray-100 text-gray-700"
                      }
                    >
                      {row.status === "final" ? "Final" : "Draft"}
                    </Badge>
                    <span className="w-12 text-right font-semibold">
                      {score === null ? "—" : score.toLocaleString("id-ID")}
                    </span>
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>KPI {detail ? periodLabel(detail) : ""}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <ScorecardBreakdown scorecard={detail} indicators={indicators} />
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setDetail(null)}>
                  Tutup
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!teamDetail}
        onOpenChange={(open) => !open && setTeamDetail(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {teamDetail?.employee?.full_name} —{" "}
              {teamDetail ? periodLabel(teamDetail) : ""}
            </DialogTitle>
          </DialogHeader>
          {teamDetail && (
            <div className="space-y-4">
              <ScorecardBreakdown
                scorecard={teamDetail}
                indicators={teamIndicators}
              />
              {teamDetail.status === "draft" ? (
                <div className="space-y-2 border-t pt-4">
                  <Label>Penilaian Anda (rubrik 1–5)</Label>
                  <div className="flex gap-2">
                    <Select value={rubricValue} onValueChange={setRubricValue}>
                      <SelectTrigger className="w-24">
                        <SelectValue placeholder="Nilai" />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5].map((value) => (
                          <SelectItem key={value} value={String(value)}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      onClick={saveTeamRubric}
                      disabled={rubricMutation.isPending}
                    >
                      {rubricMutation.isPending ? "Menyimpan..." : "Simpan Penilaian"}
                    </Button>
                  </div>
                  <Textarea
                    value={rubricNotes}
                    onChange={(event) => setRubricNotes(event.target.value)}
                    placeholder="Catatan penilaian (opsional)"
                  />
                </div>
              ) : (
                <p className="border-t pt-4 text-xs text-muted-foreground">
                  Scorecard sudah final — penilaian tidak bisa diubah.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
