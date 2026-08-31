import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";

/**
 * PATCH /api/hris/dept-tasks/occurrences/[id] — aksi pada satu kemunculan
 * task departemen:
 *   action 'done'    — penanggung jawab (assignee; atau anggota departemen
 *                      bila task tanpa assignee) menandai selesai.
 *   action 'approve' / 'reject' — review HRD; hanya kemunculan berstatus
 *                      'done'. Rejected boleh ditandai 'done' ulang.
 * Status ini bahan indikator KPI task_completion (approved ÷ jatuh tempo).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PatchBody {
  action?: "done" | "approve" | "reject";
  notes?: string | null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });
    }
    const body = (await req.json()) as PatchBody;
    const action = body.action;
    if (action !== "done" && action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "Aksi tidak dikenal" }, { status: 400 });
    }

    const occ = await queryOne<{
      id: string;
      status: string;
      task_id: string;
      department_id: string;
      assignee_employee_id: string | null;
    }>(
      `SELECT o.id, o.status, o.task_id, t.department_id, t.assignee_employee_id
       FROM hris.department_task_occurrences o
       JOIN hris.department_tasks t ON t.id = o.task_id
       WHERE o.id = $1`,
      [id]
    );
    if (!occ) return NextResponse.json({ error: "Kemunculan task tidak ditemukan" }, { status: 404 });

    const myName = actor.employeeId
      ? (
          await queryOne<{ full_name: string }>(
            `SELECT full_name FROM hris.employees WHERE id = $1`,
            [actor.employeeId]
          )
        )?.full_name ?? "—"
      : "HRD";

    if (action === "done") {
      if (occ.status === "approved") {
        return NextResponse.json({ error: "Sudah disetujui HRD — tidak bisa diubah" }, { status: 400 });
      }
      if (!actor.isHr) {
        if (!actor.employeeId) {
          return NextResponse.json({ error: "Akun ini tidak terhubung ke data karyawan" }, { status: 403 });
        }
        if (occ.assignee_employee_id) {
          if (occ.assignee_employee_id !== actor.employeeId) {
            return NextResponse.json(
              { error: "Hanya penanggung jawab task ini yang boleh menandai selesai" },
              { status: 403 }
            );
          }
        } else {
          const inDept = await queryOne<{ id: string }>(
            `SELECT id FROM hris.employees WHERE id = $1 AND department_id = $2 AND is_active`,
            [actor.employeeId, occ.department_id]
          );
          if (!inDept) {
            return NextResponse.json(
              { error: "Hanya anggota departemen ini yang boleh menandai selesai" },
              { status: 403 }
            );
          }
        }
      }
      await queryOne(
        `UPDATE hris.department_task_occurrences
         SET status = 'done', done_at = now(), done_by = $2, done_by_name = $3,
             review_notes = NULL, reviewed_by = NULL, reviewed_by_name = NULL,
             reviewed_at = NULL, updated_at = now()
         WHERE id = $1 RETURNING id`,
        [id, actor.employeeId, myName]
      );
      return NextResponse.json({ message: "Task ditandai selesai — menunggu review HRD" });
    }

    // approve / reject — review HRD
    if (!actor.isHr) {
      return NextResponse.json({ error: "Hanya HRD yang boleh mereview task" }, { status: 403 });
    }
    if (occ.status !== "done" && !(action === "reject" && occ.status === "approved")) {
      return NextResponse.json(
        { error: "Hanya task berstatus selesai yang bisa direview" },
        { status: 400 }
      );
    }
    await queryOne(
      `UPDATE hris.department_task_occurrences
       SET status = $2, review_notes = $3, reviewed_by = $4,
           reviewed_by_name = $5, reviewed_at = now(), updated_at = now()
       WHERE id = $1 RETURNING id`,
      [
        id,
        action === "approve" ? "approved" : "rejected",
        body.notes?.trim() || null,
        actor.userId,
        myName,
      ]
    );
    return NextResponse.json({
      message: action === "approve" ? "Task disetujui" : "Task ditolak — penanggung jawab bisa memperbaiki",
    });
  } catch (error) {
    console.error("[dept-tasks/occurrence] PATCH failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
