import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireCrmReportRole } from "@/lib/crm/reports";
import { parseIntervalXp } from "@/lib/crm/collectibles";

/**
 * Laporan "jatah menganggur" (EPIC-014 Task 2).
 *
 * Jatah tidak pernah berhenti bertambah, jadi katalog artwork harus terus
 * diisi. Laporan ini menunjukkan member dengan jatah belum terpakai supaya
 * kebutuhan artwork baru terlihat SEBELUM jadi keluhan member veteran.
 */
export async function GET() {
  const denied = await requireCrmReportRole();
  if (denied) return denied;

  try {
    const pool = getPool();
    const settingRes = await pool.query(
      `SELECT value FROM crm.crm_settings WHERE key = 'collectible_interval_xp'`
    );
    const intervalXp = parseIntervalXp(settingRes.rows[0]?.value);

    // Sisa jatah dihitung di SQL dengan rumus yang sama dengan modul bersama:
    // greatest(0, floor(total_xp / interval) - terpakai).
    const { rows } = await pool.query(
      `SELECT c.id AS customer_id, c.name, c.phone, c.total_xp::int AS total_xp,
              floor(c.total_xp / $1)::int AS quota,
              COALESCE(e.used, 0)::int AS used,
              greatest(0, floor(c.total_xp / $1)::int - COALESCE(e.used, 0))::int AS idle
         FROM pos.pos_customers c
         LEFT JOIN (
           SELECT customer_id, count(*)::int AS used
             FROM crm.crm_member_entitlements
            GROUP BY customer_id
         ) e ON e.customer_id = c.id
        WHERE c.total_xp >= $1
        ORDER BY greatest(0, floor(c.total_xp / $1)::int - COALESCE(e.used, 0)) DESC, c.total_xp DESC
        LIMIT 100`,
      [intervalXp]
    );

    const totalIdle = rows.reduce((sum, r) => sum + Number(r.idle), 0);
    const catalogRes = await pool.query(
      `SELECT count(*)::int AS aktif FROM crm.crm_collectible_avatars
        WHERE is_active AND (ends_at IS NULL OR ends_at >= now())`
    );

    return NextResponse.json({
      success: true,
      data: {
        interval_xp: intervalXp,
        total_idle: totalIdle,
        active_artworks: Number(catalogRes.rows[0]?.aktif ?? 0),
        members: rows,
      },
    });
  } catch (error) {
    console.error("Error building idle entitlement report:", error);
    return NextResponse.json({ success: false, error: "Gagal memuat laporan" }, { status: 500 });
  }
}
