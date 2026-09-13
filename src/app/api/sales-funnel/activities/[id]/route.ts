import { NextRequest, NextResponse } from "next/server";
import { successResponse, noContentResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { findAccessibleActivity } from "@/lib/sales-funnel/access";
import { requireSalesFunnelRole, validateAssignableOwner } from "@/lib/sales-funnel/server";
import {
  isTaskOpen,
  recurrenceSchema,
  resolveTaskStatus,
  spawnNextTask,
  updateTaskSchema,
} from "@/lib/sales-funnel/tasks";

type TaskRow = {
  id: string;
  company_id: string;
  branch_id: string;
  lead_id: string | null;
  deal_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  activity_type: string;
  title: string | null;
  notes: string | null;
  due_at: string | null;
  reminder_at: string | null;
  reminder_channels: unknown;
  status: string;
  priority: string;
  recurrence: unknown;
  owner_user_id: string | null;
  parent_task_id: string | null;
  created_by: string | null;
};

/**
 * Task berulang yang diselesaikan → buat kemunculan berikutnya (EPIC-050 T-1.5).
 * Tautan seri lewat parent_task_id (root seri). Idempoten: tidak membuat
 * duplikat bila kemunculan berikutnya (due sama, root sama) sudah ada.
 */
async function spawnRecurringSuccessor(task: TaskRow): Promise<string | null> {
  const parsed = recurrenceSchema.safeParse(task.recurrence);
  if (!parsed.success || !task.due_at) return null;
  const next = spawnNextTask({
    due_at: task.due_at,
    reminder_at: task.reminder_at,
    recurrence: parsed.data,
  });
  if (!next) return null;
  const rootId = task.parent_task_id ?? task.id;
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM crm.crm_sales_activities
     WHERE deleted_at IS NULL AND (parent_task_id = $1 OR id = $1)
       AND due_at = $2 LIMIT 1`,
    [rootId, next.due_at.toISOString()]
  );
  if (existing) return existing.id;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO crm.crm_sales_activities
       (company_id, branch_id, lead_id, deal_id, subject_type, subject_id,
        activity_type, title, notes, due_at, status, priority, recurrence,
        reminder_at, reminder_channels, owner_user_id, parent_task_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', $11, $12::jsonb,
             $13, $14::jsonb, $15, $16, $17)
     RETURNING id`,
    [
      task.company_id,
      task.branch_id,
      task.lead_id,
      task.deal_id,
      task.subject_type,
      task.subject_id,
      task.activity_type,
      task.title,
      task.notes,
      next.due_at.toISOString(),
      task.priority,
      JSON.stringify(parsed.data),
      next.reminder_at ? next.reminder_at.toISOString() : null,
      JSON.stringify(task.reminder_channels ?? ["wa", "in_app"]),
      task.owner_user_id,
      rootId,
      task.created_by,
    ]
  );
  return row?.id ?? null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const { id } = await params;
    const { activity, forbidden } = await findAccessibleActivity(id, user);
    if (forbidden) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    if (!activity) {
      return NextResponse.json(
        { success: false, error: "Aktivitas tidak ditemukan" },
        { status: 404 }
      );
    }
    const parsed = updateTaskSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { is_done, status: statusInput, recurrence, reminder_channels, owner_user_id, ...fields } =
      parsed.data;

    if (owner_user_id !== undefined) {
      if (user.role === "sales" && owner_user_id && owner_user_id !== user.id) {
        return NextResponse.json(
          { success: false, error: "Role sales hanya boleh menjadi penanggung jawab sendiri" },
          { status: 403 }
        );
      }
      if (owner_user_id) {
        const ownerError = await validateAssignableOwner(owner_user_id, activity.company_id);
        if (ownerError) {
          return NextResponse.json({ success: false, error: ownerError }, { status: 400 });
        }
      }
    }

    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    const push = (column: string, value: unknown, cast = "") => {
      values.push(value);
      sets.push(`${column} = $${values.length}${cast}`);
    };
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      push(key, value);
    }
    if (owner_user_id !== undefined) push("owner_user_id", owner_user_id);
    if (recurrence !== undefined) {
      push("recurrence", recurrence ? JSON.stringify(recurrence) : null, "::jsonb");
    }
    if (reminder_channels !== undefined) {
      push("reminder_channels", JSON.stringify(reminder_channels), "::jsonb");
    }
    // Reminder yang dimajukan/dimundurkan boleh dikirim ulang
    if (fields.reminder_at !== undefined || fields.due_at !== undefined) {
      sets.push("reminder_sent_at = NULL", "in_app_notified_at = NULL");
    }
    const status = resolveTaskStatus({ status: statusInput, is_done });
    if (status) {
      push("status", status);
      push("done_at", status === "done" ? new Date().toISOString() : null);
    }
    if (values.length === 0) {
      return NextResponse.json(
        { success: false, error: "Tidak ada field yang diubah" },
        { status: 400 }
      );
    }
    values.push(id);
    const row = await queryOne<TaskRow>(
      `UPDATE crm.crm_sales_activities SET ${sets.join(", ")}
       WHERE id = $${values.length}
       RETURNING id, company_id, branch_id, lead_id, deal_id, subject_type,
                 subject_id, activity_type, title, notes, due_at, reminder_at,
                 reminder_channels, status, priority, recurrence, owner_user_id,
                 parent_task_id, created_by, done_at`,
      values
    );

    let nextTaskId: string | null = null;
    if (row && status === "done" && row.recurrence && !isTaskOpen(row.status as never)) {
      nextTaskId = await spawnRecurringSuccessor(row);
    }
    return successResponse(
      { ...row, next_task_id: nextTaskId },
      nextTaskId ? "Task selesai — kemunculan berikutnya dijadwalkan" : "Task diperbarui"
    );
  } catch (err) {
    console.error("[sales-funnel] update activity error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui aktivitas" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const { id } = await params;
    const { activity, forbidden } = await findAccessibleActivity(id, user);
    if (forbidden) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    if (!activity) {
      return NextResponse.json(
        { success: false, error: "Aktivitas tidak ditemukan" },
        { status: 404 }
      );
    }
    await query(
      `UPDATE crm.crm_sales_activities SET deleted_at = now(), updated_at = now()
       WHERE id = $1`,
      [id]
    );
    return noContentResponse();
  } catch (err) {
    console.error("[sales-funnel] delete activity error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus aktivitas" },
      { status: 500 }
    );
  }
}
