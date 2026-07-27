import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { apiErrorResponse } from "@/lib/crm/server";
import { requireCrmReportRole, resolveReportPeriod } from "@/lib/crm/reports";
import { getConversationInsightReport } from "@/lib/crm/conversation-insights-server";
import { buildReportSheets, reportFileName } from "@/lib/crm/conversation-insights";

/**
 * EPIC-029 — laporan agregat analitik percakapan (JSON atau XLSX).
 *
 * Peran mengikuti laporan CRM lain (super_admin/admin/direksi). Seperti
 * `reports/cs/route.ts`, respons sengaja TIDAK memuat isi chat, ringkasan
 * per percakapan, nomor telepon, maupun nama customer — hanya angka agregat,
 * kata kunci, dan topik, supaya laporan bisa dibuka manajemen tanpa membuka
 * PII percakapan.
 *
 * `format=xlsx` mengembalikan file (3 sheet: Ringkasan, Kata Kunci, Topik) agar
 * bisa dibuka Excel atau di-import ke Google Sheet.
 */
export async function GET(request: NextRequest) {
  const guard = await requireCrmReportRole();
  if (guard) return guard;

  const { searchParams } = new URL(request.url);
  const period = resolveReportPeriod(searchParams.get("from"), searchParams.get("to"));
  if (!period) {
    return NextResponse.json(
      {
        success: false,
        error: "Periode tidak valid (format YYYY-MM-DD, from <= to, maksimal 366 hari)",
      },
      { status: 400 }
    );
  }

  const format = searchParams.get("format") === "xlsx" ? "xlsx" : "json";

  try {
    const report = await getConversationInsightReport(getPool(), period);

    if (format === "json") {
      return NextResponse.json({ success: true, data: report });
    }

    // Impor dinamis: `xlsx` hanya dimuat saat benar-benar ada permintaan export,
    // mengikuti pola `src/lib/attachments/extract.ts`.
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    for (const sheet of buildReportSheets(report)) {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
    }
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${reportFileName(report.period)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error, "Gagal menyusun laporan analitik percakapan");
  }
}
