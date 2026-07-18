// ============================================================
// API Route: Announcement Feed (karyawan)
// GET — pengumuman published yang menyasar karyawan login (global atau
//       departemennya), dalam jendela tayang, + penanda sudah dibaca.
// ============================================================

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";

export async function GET() {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!actor.employeeId) {
      // Akun tak tertaut karyawan → tidak ada feed personal
      return NextResponse.json({ data: [], unread: 0 });
    }

    const rows = await query(
      `SELECT a.id, a.title, a.cover_image_url, a.video_provider, a.tags,
              a.is_pinned, a.publish_at, a.created_at,
              (r.employee_id IS NOT NULL) AS is_read
       FROM hris.announcements a
       JOIN hris.employees e ON e.id = $1
       LEFT JOIN hris.announcement_reads r
         ON r.announcement_id = a.id AND r.employee_id = $1
       WHERE a.status = 'published'
         AND (a.publish_at IS NULL OR a.publish_at <= now())
         AND (a.expires_at IS NULL OR a.expires_at > now())
         AND (
           a.target_scope = 'global'
           OR EXISTS (
             SELECT 1 FROM hris.announcement_departments ad
             WHERE ad.announcement_id = a.id AND ad.department_id = e.department_id
           )
         )
       ORDER BY a.is_pinned DESC, COALESCE(a.publish_at, a.created_at) DESC
       LIMIT 100`,
      [actor.employeeId]
    );

    const unread = rows.filter((row) => row.is_read === false).length;
    return NextResponse.json({ data: rows, unread });
  } catch (error) {
    console.error("Error fetching announcement feed:", error);
    return NextResponse.json({ error: "Gagal mengambil pengumuman" }, { status: 500 });
  }
}
