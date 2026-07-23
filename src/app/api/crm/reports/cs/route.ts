import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { apiErrorResponse } from "@/lib/crm/server";
import { requireCrmReportRole, resolveReportPeriod } from "@/lib/crm/reports";

/**
 * EPIC-012 Fase E — laporan customer service.
 *
 * Peran mengikuti laporan CRM lain (super_admin/admin/direksi). Respons
 * sengaja TIDAK memuat isi chat maupun nomor customer — hanya angka agregat,
 * supaya laporan bisa dibuka manajemen tanpa membuka PII percakapan.
 */
export async function GET(request: NextRequest) {
  const guard = await requireCrmReportRole();
  if (guard) return guard;

  const { searchParams } = new URL(request.url);
  const period = resolveReportPeriod(searchParams.get("from"), searchParams.get("to"));
  if (!period) {
    return NextResponse.json(
      { success: false, error: "Periode tidak valid (format YYYY-MM-DD, from <= to, maksimal 366 hari)" },
      { status: 400 }
    );
  }

  try {
    const periodParams = [period.fromIso, period.toIso];

    const [summaryRow, dailyRows, categoryRows, csatRows, agentRows, channelRows] =
      await Promise.all([
      queryOne(
        `SELECT
           COUNT(*)::int AS total_conversations,
           COUNT(*) FILTER (WHERE is_complaint)::int AS total_complaints,
           COUNT(*) FILTER (WHERE status = 'resolved')::int AS total_resolved,
           COUNT(*) FILTER (WHERE sla_response_breached)::int AS total_sla_breached,
           AVG(first_response_seconds) FILTER (WHERE first_response_seconds IS NOT NULL)
             AS avg_first_response_seconds,
           AVG(resolution_seconds) FILTER (WHERE resolution_seconds IS NOT NULL)
             AS avg_resolution_seconds,
           AVG(csat_score) FILTER (WHERE csat_score IS NOT NULL) AS avg_csat,
           COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::int AS csat_responses
         FROM crm.wa_conversations
        WHERE created_at >= $1 AND created_at < $2`,
        periodParams
      ),
      query(
        `SELECT (created_at AT TIME ZONE 'Asia/Jakarta')::date AS tanggal,
                COUNT(*)::int AS conversations,
                COUNT(*) FILTER (WHERE is_complaint)::int AS complaints,
                COUNT(*) FILTER (WHERE sla_response_breached)::int AS sla_breached
           FROM crm.wa_conversations
          WHERE created_at >= $1 AND created_at < $2
          GROUP BY 1
          ORDER BY 1`,
        periodParams
      ),
      query(
        `SELECT COALESCE(category, 'belum_dikategorikan') AS category,
                priority,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
                AVG(resolution_seconds) FILTER (WHERE resolution_seconds IS NOT NULL)
                  AS avg_resolution_seconds
           FROM crm.wa_conversations
          WHERE is_complaint AND created_at >= $1 AND created_at < $2
          GROUP BY 1, 2
          ORDER BY total DESC`,
        periodParams
      ),
      query(
        `SELECT csat_score AS score, COUNT(*)::int AS total
           FROM crm.wa_conversations
          WHERE csat_score IS NOT NULL AND created_at >= $1 AND created_at < $2
          GROUP BY 1
          ORDER BY 1`,
        periodParams
      ),
      query(
        `SELECT u.full_name AS agent_name,
                COUNT(*)::int AS handled,
                COUNT(*) FILTER (WHERE v.status = 'resolved')::int AS resolved,
                AVG(v.first_response_seconds) FILTER (WHERE v.first_response_seconds IS NOT NULL)
                  AS avg_first_response_seconds,
                AVG(v.csat_score) FILTER (WHERE v.csat_score IS NOT NULL) AS avg_csat
           FROM crm.wa_conversations v
           JOIN configuration.users u ON u.id = v.assigned_user_id
          WHERE v.created_at >= $1 AND v.created_at < $2
          GROUP BY u.full_name
          ORDER BY handled DESC
          LIMIT 20`,
        periodParams
      ),
      // Pecahan per kanal (EPIC-013 Fase B) — agar volume & mutu layanan
      // WhatsApp vs Instagram bisa dibandingkan.
      query(
        `SELECT channel,
                COUNT(*)::int AS conversations,
                COUNT(*) FILTER (WHERE is_complaint)::int AS complaints,
                COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
                AVG(first_response_seconds) FILTER (WHERE first_response_seconds IS NOT NULL)
                  AS avg_first_response_seconds,
                AVG(csat_score) FILTER (WHERE csat_score IS NOT NULL) AS avg_csat
           FROM crm.wa_conversations
          WHERE created_at >= $1 AND created_at < $2
          GROUP BY channel
          ORDER BY conversations DESC`,
        periodParams
      ),
    ]);

    const toNum = (value: unknown) =>
      value == null ? null : Math.round(Number(value) * 100) / 100;

    return NextResponse.json({
      success: true,
      data: {
        period: { from: period.fromIso, to: period.toIso },
        summary: {
          total_conversations: summaryRow?.total_conversations ?? 0,
          total_complaints: summaryRow?.total_complaints ?? 0,
          total_resolved: summaryRow?.total_resolved ?? 0,
          total_sla_breached: summaryRow?.total_sla_breached ?? 0,
          avg_first_response_seconds: toNum(summaryRow?.avg_first_response_seconds),
          avg_resolution_seconds: toNum(summaryRow?.avg_resolution_seconds),
          avg_csat: toNum(summaryRow?.avg_csat),
          csat_responses: summaryRow?.csat_responses ?? 0,
        },
        daily: dailyRows.map((row) => ({
          tanggal: row.tanggal,
          conversations: row.conversations,
          complaints: row.complaints,
          sla_breached: row.sla_breached,
        })),
        categories: categoryRows.map((row) => ({
          category: row.category,
          priority: row.priority,
          total: row.total,
          resolved: row.resolved,
          avg_resolution_seconds: toNum(row.avg_resolution_seconds),
        })),
        csat_distribution: csatRows.map((row) => ({
          score: Number(row.score),
          total: row.total,
        })),
        channels: channelRows.map((row) => ({
          channel: row.channel,
          conversations: row.conversations,
          complaints: row.complaints,
          resolved: row.resolved,
          avg_first_response_seconds: toNum(row.avg_first_response_seconds),
          avg_csat: toNum(row.avg_csat),
        })),
        agents: agentRows.map((row) => ({
          agent_name: row.agent_name,
          handled: row.handled,
          resolved: row.resolved,
          avg_first_response_seconds: toNum(row.avg_first_response_seconds),
          avg_csat: toNum(row.avg_csat),
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching CS report:", error);
    return apiErrorResponse(error);
  }
}
