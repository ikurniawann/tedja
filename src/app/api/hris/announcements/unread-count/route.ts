// ============================================================
// API Route: Unread Announcement Count (badge sidebar)
// GET — jumlah pengumuman published yang menyasar karyawan & belum dibaca.
// ============================================================

import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";

export async function GET() {
  try {
    const actor = await getWorkforceActor();
    if (!actor?.employeeId) {
      return NextResponse.json({ unread: 0 });
    }

    const row = await queryOne<{ unread: string }>(
      `SELECT count(*) AS unread
       FROM hris.announcements a
       JOIN hris.employees e ON e.id = $1
       LEFT JOIN hris.announcement_reads r
         ON r.announcement_id = a.id AND r.employee_id = $1
       WHERE a.status = 'published'
         AND r.employee_id IS NULL
         AND (a.publish_at IS NULL OR a.publish_at <= now())
         AND (a.expires_at IS NULL OR a.expires_at > now())
         AND (
           a.target_scope = 'global'
           OR EXISTS (
             SELECT 1 FROM hris.announcement_departments ad
             WHERE ad.announcement_id = a.id AND ad.department_id = e.department_id
           )
         )`,
      [actor.employeeId]
    );

    return NextResponse.json({ unread: Number(row?.unread ?? 0) });
  } catch (error) {
    console.error("Error counting unread announcements:", error);
    return NextResponse.json({ unread: 0 });
  }
}
