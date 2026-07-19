"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { KpiBreakdownRow, KpiIndicatorInfo, KpiScorecardRow } from "../types";

const num = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const fmtPct = (fraction: number | null): string =>
  fraction === null
    ? "—"
    : `${(fraction * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;

/** Rincian komposisi skor satu scorecard — dipakai dialog HRD & ESS. */
export function ScorecardBreakdown({
  scorecard,
  indicators,
}: {
  scorecard: KpiScorecardRow;
  indicators: KpiIndicatorInfo[];
}) {
  const nameByCode = new Map(indicators.map((i) => [i.code, i.name]));
  const rows: KpiBreakdownRow[] = scorecard.breakdown ?? [];
  const excluded = rows.filter((row) => row.attainment === null);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold">
          {num(scorecard.score)?.toLocaleString("id-ID") ?? "—"}
        </span>
        <span className="text-sm text-muted-foreground">/ 100</span>
        {num(scorecard.raw_score) !== null &&
          num(scorecard.raw_score)! > 100 && (
            <span className="text-xs text-muted-foreground">
              (raw {num(scorecard.raw_score)?.toLocaleString("id-ID")} — over-achievement)
            </span>
          )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Indikator</TableHead>
            <TableHead className="text-right">Bobot</TableHead>
            <TableHead className="text-right">Bobot Efektif</TableHead>
            <TableHead className="text-right">Pencapaian</TableHead>
            <TableHead className="text-right">Kontribusi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.code}
              className={row.attainment === null ? "opacity-50" : ""}
            >
              <TableCell>{nameByCode.get(row.code) ?? row.code}</TableCell>
              <TableCell className="text-right">{row.weight}</TableCell>
              <TableCell className="text-right">{row.effectiveWeight}</TableCell>
              <TableCell className="text-right">{fmtPct(row.attainment)}</TableCell>
              <TableCell className="text-right">
                {row.attainment === null ? "—" : row.contribution.toLocaleString("id-ID")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {excluded.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {excluded.length} indikator tanpa data periode ini (
          {excluded.map((row) => nameByCode.get(row.code) ?? row.code).join(", ")}
          ) — bobotnya didistribusikan ulang ke indikator lain.
        </p>
      )}
    </div>
  );
}
