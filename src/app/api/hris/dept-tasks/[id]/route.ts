import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";

/**
 * PATCH /api/hris/dept-tasks/[id] — nonaktifkan task (is_active=false).
 * Kemunculan lama tetap tersimpan (riwayat & KPI periode berjalan utuh);
 * kemunculan baru berhenti dibuat. HR bebas; non-HR harus atasan di
 * departemen task tersebut.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });

    const task = await queryOne<{ id: string; department_id: string }>(
      `SELECT id, department_id FROM hris.department_tasks WHERE id = $1 AND is_active`,
      [id]
    );
    if (!task) return NextResponse.json({ error: "Task tidak ditemukan" }, { status: 404 });

    if (!actor.isHr) {
      if (!actor.employeeId) {
        return NextResponse.json({ error: "Akun tidak terhubung ke karyawan" }, { status: 403 });
      }
      const boleh = await queryOne<{ ok: boolean }>(
        `SELECT (e.department_id = $2 AND EXISTS (
           SELECT 1 FROM hris.employees s WHERE s.reporting_to = e.id AND s.is_active
         )) AS ok
         FROM hris.employees e WHERE e.id = $1`,
        [actor.employeeId, task.department_id]
      );
      if (!boleh?.ok) {
        return NextResponse.json(
          { error: "Hanya HRD atau atasan departemen ini yang boleh menonaktifkan task" },
          { status: 403 }
        );
      }
    }

    await queryOne(
      `UPDATE hris.department_tasks SET is_active = false, updated_at = now()
       WHERE id = $1 RETURNING id`,
      [id]
    );
    return NextResponse.json({ message: "Task dinonaktifkan" });
  } catch (error) {
    console.error("[dept-tasks/[id]] PATCH failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
