import { NextRequest, NextResponse } from "next/server";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { emitCrmEvent } from "@/lib/crm/events";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import { findAccessibleSubject } from "@/lib/sales-funnel/access";
import {
  requireCompanyScope,
  requireSalesFunnelRole,
  resolveSalesVenue,
  validateAssignableOwner,
} from "@/lib/sales-funnel/server";
import {
  DEFAULT_REMINDER_CHANNELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_SUBJECT_TYPES,
  createTaskSchema,
  resolveTaskStatus,
  resolveTaskSubject,
  type TaskSubjectType,
} from "@/lib/sales-funnel/tasks";

// Agenda tidak dipaginasi (list harian/kalender) — pagar sama dengan kanban deals
const MAX_AGENDA_ROWS = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * EPIC-050 Fase 1: aktivitas = task. Kolom lama (lead_id/deal_id/done_at)
 * tetap dikembalikan agar klien lama (deal dialog, lead detail) tidak rusak;
 * kolom baru: subject_*, title, priority, status, recurrence, reminder_*.
 * subject_name diresolusi per jenis subjek untuk tampilan agenda/kalender.
 */
const ACTIVITY_COLUMNS = `
  a.id, a.lead_id, a.deal_id, a.subject_type, a.subject_id, a.activity_type,
  a.title, a.notes, a.due_at, a.done_at, a.status, a.priority, a.recurrence,
  a.reminder_at, a.reminder_channels, a.parent_task_id,
  a.owner_user_id, a.reminder_sent_at, a.created_at,
  u.full_name AS owner_name,
  d.title AS deal_title,
  COALESCE(dl.org_name, l.org_name, acc.name, con_acc.name, cust.name) AS org_name,
  COALESCE(dl.pic_name, l.pic_name, con.name, cust.name) AS pic_name,
  COALESCE(dl.pic_phone, l.pic_phone, con.phone, cust.phone) AS pic_phone,
  CASE a.subject_type
    WHEN 'deal' THEN d.title
    WHEN 'lead' THEN l.org_name
    WHEN 'account' THEN acc.name
    WHEN 'contact' THEN con.name
    WHEN 'member' THEN cust.name
    ELSE COALESCE(d.title, l.org_name)
  END AS subject_name`;

const ACTIVITY_JOINS = `
  FROM crm.crm_sales_activities a
  LEFT JOIN configuration.users u ON u.id = a.owner_user_id
  LEFT JOIN crm.crm_sales_deals d ON d.id = a.deal_id
  LEFT JOIN crm.crm_sales_leads dl ON dl.id = d.lead_id
  LEFT JOIN crm.crm_sales_leads l ON l.id = a.lead_id
  LEFT JOIN crm.crm_accounts acc ON a.subject_type = 'account' AND acc.id = a.subject_id
  LEFT JOIN crm.crm_contacts con ON a.subject_type = 'contact' AND con.id = a.subject_id
  LEFT JOIN crm.crm_accounts con_acc ON con_acc.id = con.account_id
  LEFT JOIN pos.pos_customers cust ON a.subject_type = 'member' AND cust.id = a.subject_id`;

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export async function GET(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const url = new URL(request.url);
    const dealId = url.searchParams.get("deal_id");
    const leadId = url.searchParams.get("lead_id");
    const subjectTypeRaw = url.searchParams.get("subject_type") ?? "";
    const subjectId = url.searchParams.get("subject_id") ?? "";
    const view = url.searchParams.get("view") ?? "";
    const status = url.searchParams.get("status") ?? "";
    const priority = url.searchParams.get("priority") ?? "";
    const owner = url.searchParams.get("owner_user_id") ?? "";
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";

    // ── Timeline satu subjek: akses dicek lewat induknya ──
    const subject = resolveTaskSubject({
      deal_id: dealId,
      lead_id: leadId,
      subject_type: (TASK_SUBJECT_TYPES as readonly string[]).includes(subjectTypeRaw)
        ? (subjectTypeRaw as TaskSubjectType)
        : undefined,
      subject_id: UUID_RE.test(subjectId) ? subjectId : null,
    });
    if (subject) {
      const { forbidden, notFound } = await findAccessibleSubject(
        subject.subject_type,
        subject.subject_id,
        user
      );
      if (forbidden || notFound) {
        return NextResponse.json(
          { success: false, error: forbidden ? "Insufficient permissions" : "Subjek tidak ditemukan" },
          { status: forbidden ? 403 : 404 }
        );
      }
      // lead/deal: kolom lama; account/contact/member: subject_*
      const where =
        subject.subject_type === "deal"
          ? "a.deal_id = $1"
          : subject.subject_type === "lead"
            ? "(a.lead_id = $1 OR (a.subject_type = 'lead' AND a.subject_id = $1))"
            : `(a.subject_type = '${subject.subject_type}' AND a.subject_id = $1)`;
      const rows = await query(
        `SELECT ${ACTIVITY_COLUMNS} ${ACTIVITY_JOINS}
         WHERE a.deleted_at IS NULL AND ${where}
         ORDER BY COALESCE(a.due_at, a.created_at) DESC
         LIMIT ${MAX_AGENDA_ROWS}`,
        [subject.subject_id]
      );
      return successResponse(rows);
    }

    // ── Agenda / kalender: scope bisnis + kepemilikan ──
    const scope = await getApiUserScope();
    const scopeError = requireCompanyScope(user, scope);
    if (scopeError) return scopeError;

    const conditions: string[] = ["a.deleted_at IS NULL"];
    const params: unknown[] = [];
    const add = (fragment: string, value: unknown) => {
      params.push(value);
      conditions.push(fragment.replace("?", `$${params.length}`));
    };
    if (scope?.companyId) add("a.company_id = ?", scope.companyId);
    if (scope?.businessScope === "branch" && scope.branchId) {
      add("a.branch_id = ?", scope.branchId);
    }
    // Role sales hanya melihat agenda miliknya ATAU tanpa penanggung jawab
    if (user.role === "sales") {
      add("(a.owner_user_id = ? OR a.owner_user_id IS NULL)", user.id);
    }
    if (owner && UUID_RE.test(owner)) add("a.owner_user_id = ?", owner);
    if (status && (TASK_STATUSES as readonly string[]).includes(status)) {
      add("a.status = ?", status);
    } else if (status === "open_all") {
      conditions.push("a.status IN ('open', 'in_progress')");
    }
    if (priority && (TASK_PRIORITIES as readonly string[]).includes(priority)) {
      add("a.priority = ?", priority);
    }

    if (view === "today") {
      // Belum selesai & jatuh tempo s/d akhir hari ini (termasuk terlambat)
      conditions.push("a.status IN ('open', 'in_progress')");
      conditions.push("a.due_at IS NOT NULL");
      conditions.push("a.due_at < (CURRENT_DATE + 1)::timestamptz");
    } else if (view === "upcoming") {
      conditions.push("a.status IN ('open', 'in_progress')");
      conditions.push("(a.due_at IS NULL OR a.due_at >= (CURRENT_DATE + 1)::timestamptz)");
    } else if (view === "range") {
      if (!isIsoDate(from) || !isIsoDate(to)) {
        return NextResponse.json(
          { success: false, error: "view=range membutuhkan from & to (YYYY-MM-DD)" },
          { status: 400 }
        );
      }
      add("a.due_at >= ?::date::timestamptz", from);
      add("a.due_at < (?::date + 1)::timestamptz", to);
    }

    const rows = await query(
      `SELECT ${ACTIVITY_COLUMNS} ${ACTIVITY_JOINS}
       WHERE ${conditions.join(" AND ")}
       ORDER BY a.due_at ASC NULLS LAST,
                CASE a.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                a.created_at DESC
       LIMIT ${MAX_AGENDA_ROWS}`,
      params
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[sales-funnel] list activities error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat aktivitas" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const parsed = createTaskSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;
    const subject = resolveTaskSubject(body);
    if (!subject) {
      return NextResponse.json(
        { success: false, error: "Task harus terkait lead, deal, account, contact, atau member" },
        { status: 400 }
      );
    }

    // Task mewarisi venue dari subjeknya; member (global) memakai venue user
    const { venue, forbidden, notFound, memberGlobal } = await findAccessibleSubject(
      subject.subject_type,
      subject.subject_id,
      user
    );
    if (forbidden || notFound) {
      return NextResponse.json(
        { success: false, error: forbidden ? "Insufficient permissions" : "Subjek tidak ditemukan" },
        { status: forbidden ? 403 : 404 }
      );
    }
    let companyId = venue?.company_id ?? null;
    let branchId = venue?.branch_id ?? null;
    if (memberGlobal) {
      const scope = await getApiUserScope();
      const scopeError = requireCompanyScope(user, scope);
      if (scopeError) return scopeError;
      const resolved = await resolveSalesVenue(scope);
      companyId = resolved.companyId;
      branchId = resolved.branchId;
    }
    if (!companyId || !branchId) {
      return NextResponse.json(
        { success: false, error: "Venue belum dikonfigurasi — lengkapi scope bisnis user atau venue default CRM" },
        { status: 400 }
      );
    }

    // Role sales tidak boleh mengalihkan kepemilikan ke user lain
    if (user.role === "sales" && body.owner_user_id && body.owner_user_id !== user.id) {
      return NextResponse.json(
        { success: false, error: "Role sales hanya boleh menjadi penanggung jawab sendiri" },
        { status: 403 }
      );
    }
    if (body.owner_user_id) {
      const ownerError = await validateAssignableOwner(body.owner_user_id, companyId);
      if (ownerError) {
        return NextResponse.json({ success: false, error: ownerError }, { status: 400 });
      }
    }

    const status = resolveTaskStatus(body) ?? "open";
    const doneAt = status === "done" ? new Date().toISOString() : null;
    const rows = await query(
      `INSERT INTO crm.crm_sales_activities
         (company_id, branch_id, lead_id, deal_id, subject_type, subject_id,
          activity_type, title, notes, due_at, done_at, status, priority,
          recurrence, reminder_at, reminder_channels, owner_user_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16::jsonb, $17, $18)
       RETURNING id, activity_type, title, due_at, done_at, status, priority`,
      [
        companyId,
        branchId,
        subject.subject_type === "lead" ? subject.subject_id : null,
        subject.subject_type === "deal" ? subject.subject_id : null,
        subject.subject_type,
        subject.subject_id,
        body.activity_type,
        body.title || null,
        body.notes || null,
        body.due_at ?? null,
        doneAt,
        status,
        body.priority,
        body.recurrence ? JSON.stringify(body.recurrence) : null,
        body.reminder_at ?? body.due_at ?? null,
        JSON.stringify(body.reminder_channels ?? DEFAULT_REMINDER_CHANNELS),
        body.owner_user_id || (user.role === "sales" ? user.id : null),
        user.id,
      ]
    );
    // EPIC-050 Fase 2: event bus (task selesai saat dibuat = task.done)
    await emitCrmEvent({
      event_type: status === "done" ? "task.done" : "task.created",
      subject_type: "task",
      subject_id: String(rows[0].id),
      company_id: companyId,
      branch_id: branchId,
      actor_user_id: user.id,
      payload: { activity_type: body.activity_type, subject_type: subject.subject_type, subject_id: subject.subject_id },
    });
    return createdResponse(rows[0], "Task dicatat");
  } catch (err) {
    console.error("[sales-funnel] create activity error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mencatat aktivitas" },
      { status: 500 }
    );
  }
}
