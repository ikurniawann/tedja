import { NextRequest, NextResponse } from "next/server";
import { xlsxResponse } from "@/lib/reports/xlsx";
import {
  buildReportSheets, loadAccessibleReport, parseStoredDefinition, reportFileName, requireReportUser, runReportDefinition,
} from "@/lib/crm/report-builder-server";

/** EPIC-050 T-4.1 — ekspor report tersimpan ke XLSX (sheet Data + Info). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireReportUser();
  if (error) return error;
  const { id } = await params;
  const report = await loadAccessibleReport(id, user, scope);
  if (!report) return NextResponse.json({ success: false, error: "Report tidak ditemukan" }, { status: 404 });
  const definition = parseStoredDefinition(report.dataset, report.definition);
  const result = await runReportDefinition(definition, user, scope);
  const now = new Date();
  return xlsxResponse(buildReportSheets(report, definition, result, now), reportFileName(report.name, now));
}
