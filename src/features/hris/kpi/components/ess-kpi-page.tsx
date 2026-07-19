"use client";

import { useState } from "react";
import { ChartBarIcon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SkeletonCard } from "@/components/ui/skeleton-table";
import { useKpiHistory } from "../queries";
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

/** ESS → KPI Saya: riwayat skor bulanan pribadi (EPIC-010 Fase C). */
export function EssKpiPage() {
  const [detail, setDetail] = useState<KpiScorecardRow | null>(null);
  const historyQuery = useKpiHistory("me", 12);
  const rows = historyQuery.data?.data ?? [];
  const indicators = historyQuery.data?.indicators ?? [];
  const latest = rows[0] ?? null;
  const latestScore = latest ? num(latest.score) : null;

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
    </div>
  );
}
