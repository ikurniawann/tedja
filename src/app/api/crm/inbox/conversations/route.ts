import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireCrmInboxAgent } from "@/lib/crm/server";

/**
 * EPIC-012 Fase C — daftar percakapan inbox WhatsApp CS.
 * Peran: super_admin / admin / pos_supervisor (isi chat = PII sensitif).
 */
export async function GET(request: NextRequest) {
  const guard = await requireCrmInboxAgent();
  if (guard.error) return guard.error;

  try {
    const params = request.nextUrl.searchParams;
    const status = params.get("status");
    const assigned = params.get("assigned");
    const search = params.get("search")?.trim();

    const values: unknown[] = [];
    const filters: string[] = [];

    if (status && status !== "all") {
      values.push(status);
      filters.push(`v.status = $${values.length}`);
    }
    if (assigned === "me") {
      values.push(guard.user.id);
      filters.push(`v.assigned_user_id = $${values.length}`);
    } else if (assigned === "unassigned") {
      filters.push(`v.assigned_user_id IS NULL`);
    }
    if (search) {
      values.push(`%${search.replace(/[%_]/g, "")}%`);
      filters.push(`(v.phone LIKE $${values.length} OR c.name ILIKE $${values.length})`);
    }

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT v.id, v.phone, v.status, v.assigned_user_id, v.unread_count,
              v.last_message_at, v.last_message_preview,
              c.id AS customer_id, c.name AS customer_name,
              c.membership_tier, c.member_type,
              u.full_name AS assigned_name
         FROM crm.wa_conversations v
         LEFT JOIN pos.pos_customers c ON c.id = v.customer_id
         LEFT JOIN configuration.users u ON u.id = v.assigned_user_id
        ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
        ORDER BY v.last_message_at DESC NULLS LAST
        LIMIT 100`,
      values
    );

    const { rows: totals } = await pool.query(
      `SELECT COALESCE(SUM(unread_count), 0)::int AS total_unread,
              COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int AS total_active
         FROM crm.wa_conversations`
    );

    return NextResponse.json({
      success: true,
      data: { conversations: rows, totals: totals[0] },
    });
  } catch (error) {
    console.error("Error fetching WA conversations:", error);
    return NextResponse.json(
      { success: false, error: "Gagal memuat percakapan" },
      { status: 500 }
    );
  }
}
