// ============================================================
// API Route: Mark Announcement Read (karyawan)
// POST — tandai pengumuman sudah dibaca oleh karyawan login (idempoten).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_req: NextRequest, { params }: RouteParams) {
  try {
    const actor = await getWorkforceActor();
    if (!actor?.employeeId) {
      return NextResponse.json({ error: "Akun tidak tertaut karyawan" }, { status: 403 });
    }
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });
    }

    // Hanya tandai bila pengumuman memang menyasar & published (hindari
    // menandai baca pengumuman yang tak berhak dilihat).
    await query(
      `INSERT INTO hris.announcement_reads (announcement_id, employee_id)
       SELECT a.id, $2
       FROM hris.announcements a
       JOIN hris.employees e ON e.id = $2
       WHERE a.id = $1
         AND a.status = 'published'
         AND (
           a.target_scope = 'global'
           OR EXISTS (
             SELECT 1 FROM hris.announcement_departments ad
             WHERE ad.announcement_id = a.id AND ad.department_id = e.department_id
           )
         )
       ON CONFLICT (announcement_id, employee_id) DO NOTHING`,
      [id, actor.employeeId]
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error marking announcement read:", error);
    return NextResponse.json({ error: "Gagal menandai dibaca" }, { status: 500 });
  }
}
