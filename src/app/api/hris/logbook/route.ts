import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";
import {
  canEditEntryItems,
  canReviewEntry,
  canSubmitEntry,
  canDeleteEntry,
  getLogbookActor,
  resolveDepartmentScope,
  type LogbookActor,
} from "@/lib/hris/logbook";

/**
 * API Logbook Department (EPIC-009).
 * Semua method WAJIB terautentikasi; enforcement department dilakukan DI SERVER
 * via resolveDepartmentScope — non-full-access dikunci ke department sendiri.
 */

type TemplateItemInput = {
  title: string;
  description?: string | null;
  weight?: number;
  is_required?: boolean;
};

const NOTE_MAX_LENGTH = 20_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const unauthorized = () => errorResponse("Unauthorized", 401);
const forbidden = () =>
  errorResponse("Anda tidak berhak mengakses department ini", 403);

/**
 * Normalisasi field teks bebas (notes/review_notes): wajib string, dibatasi
 * NOTE_MAX_LENGTH. Return {ok:false} bila melebihi batas.
 */
function normalizeNote(
  raw: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  if (raw.length > NOTE_MAX_LENGTH) return { ok: false };
  return { ok: true, value: raw || null };
}

/** Ambil entry + kolom guard; null bila tak ada. */
async function getEntryForGuard(
  db: Awaited<ReturnType<typeof createServerPgClient>>,
  entryId: string
) {
  const { data } = await db
    .from("hris_logbook_entries")
    .select("id, status, department_id")
    .eq("id", entryId)
    .maybeSingle();
  return data as { id: string; status: string; department_id: string } | null;
}

function actorAllowsDepartment(actor: LogbookActor, departmentId: string) {
  return resolveDepartmentScope(actor, departmentId).allowed;
}

// ============================================================
// GET /api/hris/logbook?resource=me|departments|templates|summary|entries
// ============================================================

export async function GET(request: Request) {
  const actor = await getLogbookActor();
  if (!actor) return unauthorized();

  const db = await createServerPgClient();
  const { searchParams } = new URL(request.url);
  const resource = searchParams.get("resource") || "entries";

  if (resource === "me") {
    const [{ data: profile }, { data: employee }] = await Promise.all([
      db
        .from("users")
        .select("id, full_name, role, brand_id")
        .eq("id", actor.userId)
        .single(),
      db
        .from("employees")
        .select("id, department_id, department:departments(id,name,code)")
        .eq("user_id", actor.userId)
        .maybeSingle(),
    ]);
    return NextResponse.json({
      data: {
        ...profile,
        employee,
        can_review: actor.canReview,
        is_full_access: actor.isFullAccess,
      },
    });
  }

  if (resource === "departments") {
    // Sengaja tanpa scope department: daftar nama department (id/name/code,
    // sensitivitas rendah) dibutuhkan dropdown full-access; user lain hanya
    // menerima daftar nama tanpa data logbook apa pun.
    const { data, error } = await db
      .from("departments")
      .select("id, name, code, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (error) return errorResponse(error.message);
    return NextResponse.json({ data });
  }

  const scope = resolveDepartmentScope(actor, searchParams.get("department_id"));
  if (!scope.allowed) return forbidden();

  if (resource === "templates") {
    let query = db
      .from("hris_logbook_templates")
      .select(
        "*, department:departments(id,name,code), items:hris_logbook_template_items(*)"
      )
      .order("created_at", { ascending: false });
    if (scope.departmentId) query = query.eq("department_id", scope.departmentId);
    const includeInactive = searchParams.get("include_inactive") === "true";
    if (!includeInactive) query = query.eq("is_active", true);

    const { data, error } = await query;
    if (error) return errorResponse(error.message);
    return NextResponse.json({ data });
  }

  if (resource === "summary") {
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    let query = db
      .from("hris_logbook_entries")
      .select(
        "id, department_id, entry_date, status, completion_percentage, kpi_score, department:departments(id,name,code)"
      )
      .order("entry_date", { ascending: false });
    if (scope.departmentId) query = query.eq("department_id", scope.departmentId);
    if (from) query = query.gte("entry_date", from);
    if (to) query = query.lte("entry_date", to);

    const { data, error } = await query;
    if (error) return errorResponse(error.message);

    const summary = ((data || []) as any[]).reduce((acc: Record<string, any>, entry: any) => {
      const key = entry.department_id;
      if (!acc[key]) {
        acc[key] = {
          department: entry.department,
          total_entries: 0,
          submitted_entries: 0,
          reviewed_entries: 0,
          avg_completion: 0,
          avg_kpi_score: 0,
        };
      }
      acc[key].total_entries += 1;
      if (entry.status === "submitted") acc[key].submitted_entries += 1;
      if (entry.status === "reviewed") acc[key].reviewed_entries += 1;
      acc[key].avg_completion += Number(entry.completion_percentage || 0);
      acc[key].avg_kpi_score += Number(entry.kpi_score || 0);
      return acc;
    }, {});

    const rows = Object.values(summary).map((row: any) => ({
      ...row,
      avg_completion: row.total_entries
        ? Number((row.avg_completion / row.total_entries).toFixed(2))
        : 0,
      avg_kpi_score: row.total_entries
        ? Number((row.avg_kpi_score / row.total_entries).toFixed(2))
        : 0,
    }));

    return NextResponse.json({ data: rows });
  }

  // resource=entries (default) — dgn pagination server-side
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const offsetFrom = (page - 1) * limit;

  let countQuery = db
    .from("hris_logbook_entries")
    .select("*", { count: "exact", head: true });
  let query = db
    .from("hris_logbook_entries")
    .select(
      "*, department:departments(id,name,code), template:hris_logbook_templates(id,name,frequency), items:hris_logbook_entry_items(*)"
    )
    .order("entry_date", { ascending: false })
    .range(offsetFrom, offsetFrom + limit - 1);

  const status = searchParams.get("status");
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (scope.departmentId) {
    query = query.eq("department_id", scope.departmentId);
    countQuery = countQuery.eq("department_id", scope.departmentId);
  }
  if (status) {
    query = query.eq("status", status);
    countQuery = countQuery.eq("status", status);
  }
  if (date) {
    query = query.eq("entry_date", date);
    countQuery = countQuery.eq("entry_date", date);
  }
  if (from) {
    query = query.gte("entry_date", from);
    countQuery = countQuery.gte("entry_date", from);
  }
  if (to) {
    query = query.lte("entry_date", to);
    countQuery = countQuery.lte("entry_date", to);
  }

  const [{ data, error }, { count }] = await Promise.all([query, countQuery]);
  if (error) return errorResponse(error.message);
  return NextResponse.json({ data, count: count ?? 0, page, limit });
}

// ============================================================
// POST /api/hris/logbook  { action: create-template | create-entry }
// ============================================================

export async function POST(request: Request) {
  const actor = await getLogbookActor();
  if (!actor) return unauthorized();

  const db = await createServerPgClient();
  const body = await request.json();
  const action = body.action;

  if (action === "create-template") {
    // Non-full-access dipaksa ke department sendiri, apa pun isi body.
    const targetDepartment = actor.isFullAccess
      ? body.department_id
      : actor.departmentId;
    if (!targetDepartment || !body.name?.trim())
      return errorResponse("department_id dan nama template wajib diisi");
    if (!actorAllowsDepartment(actor, targetDepartment)) return forbidden();

    const items = (body.items || []).filter(
      (item: TemplateItemInput) => item.title?.trim()
    );
    if (!items.length)
      return errorResponse("Minimal satu checklist item harus diisi");

    const { data: template, error } = await db
      .from("hris_logbook_templates")
      .insert({
        department_id: targetDepartment,
        name: body.name.trim(),
        description: body.description || null,
        frequency: body.frequency || "daily",
        is_active: body.is_active ?? true,
        created_by: actor.userId,
      })
      .select()
      .single();
    if (error) return errorResponse(error.message);

    const { error: itemError } = await db.from("hris_logbook_template_items").insert(
      items.map((item: TemplateItemInput, index: number) => ({
        template_id: template.id,
        title: item.title.trim(),
        description: item.description || null,
        // Pertahankan bobot 0 eksplisit (item "tidak dinilai") — jangan
        // dikoersi ke 1; hanya nilai kosong/tak valid yang di-default-kan.
        weight:
          item.weight === undefined ||
          item.weight === null ||
          !Number.isFinite(Number(item.weight))
            ? 1
            : Math.max(0, Number(item.weight)),
        is_required: item.is_required ?? true,
        sort_order: index,
      }))
    );
    if (itemError) return errorResponse(itemError.message);

    return NextResponse.json({ data: template }, { status: 201 });
  }

  if (action === "create-entry") {
    if (!body.template_id || !body.entry_date)
      return errorResponse("template_id dan entry_date wajib diisi");
    if (!DATE_RE.test(body.entry_date))
      return errorResponse("Format entry_date harus YYYY-MM-DD");

    const { data: template, error: templateError } = await db
      .from("hris_logbook_templates")
      .select("*, items:hris_logbook_template_items(*)")
      .eq("id", body.template_id)
      .single();
    if (templateError) return errorResponse(templateError.message);
    if (!actorAllowsDepartment(actor, template.department_id)) return forbidden();
    if (!template.is_active)
      return errorResponse("Template sudah diarsipkan", 409);

    const entryNote = normalizeNote(body.notes);
    if (!entryNote.ok) return errorResponse("Catatan tidak valid/terlalu panjang");

    const { data: entry, error } = await db
      .from("hris_logbook_entries")
      .insert({
        template_id: template.id,
        department_id: template.department_id,
        entry_date: body.entry_date,
        title: body.title?.trim() || `${template.name} - ${body.entry_date}`,
        notes: entryNote.value,
      })
      .select()
      .single();
    if (error) {
      if (error.code === "23505")
        return errorResponse(
          "Logbook untuk template & tanggal ini sudah ada",
          409
        );
      return errorResponse(error.message);
    }

    const items = (template.items || []).sort(
      (a: any, b: any) => a.sort_order - b.sort_order
    );
    if (items.length) {
      const { error: itemError } = await db.from("hris_logbook_entry_items").insert(
        items.map((item: any) => ({
          entry_id: entry.id,
          template_item_id: item.id,
          title: item.title,
          description: item.description,
          weight: item.weight,
          is_required: item.is_required,
          sort_order: item.sort_order,
        }))
      );
      if (itemError) return errorResponse(itemError.message);
    }

    return NextResponse.json({ data: entry }, { status: 201 });
  }

  return errorResponse("Unknown action", 422);
}

// ============================================================
// PATCH /api/hris/logbook  { action: update-item | submit-entry | review-entry }
// ============================================================

export async function PATCH(request: Request) {
  const actor = await getLogbookActor();
  if (!actor) return unauthorized();

  const db = await createServerPgClient();
  const body = await request.json();

  if (body.action === "update-item") {
    if (!body.item_id) return errorResponse("item_id is required");

    const { data: item } = await db
      .from("hris_logbook_entry_items")
      .select("id, entry_id")
      .eq("id", body.item_id)
      .maybeSingle();
    if (!item) return errorResponse("Item tidak ditemukan", 404);

    const entry = await getEntryForGuard(db, item.entry_id);
    if (!entry) return errorResponse("Logbook tidak ditemukan", 404);
    if (!actorAllowsDepartment(actor, entry.department_id)) return forbidden();
    if (!canEditEntryItems(entry.status))
      return errorResponse(
        "Checklist hanya bisa diubah selama logbook masih draft",
        409
      );

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (typeof body.is_checked === "boolean") {
      patch.is_checked = body.is_checked;
      patch.checked_by = body.is_checked ? actor.userId : null;
      patch.checked_at = body.is_checked ? new Date().toISOString() : null;
    }
    if ("notes" in body) {
      const notes = typeof body.notes === "string" ? body.notes : "";
      if (notes.length > NOTE_MAX_LENGTH)
        return errorResponse("Catatan terlalu panjang");
      // Disimpan apa adanya; SEMUA render wajib lewat <SafeHtml> (sanitasi
      // DOMPurify allowlist) — konsisten dgn modul pengumuman.
      patch.notes = notes || null;
    }

    const { data, error } = await db
      .from("hris_logbook_entry_items")
      .update(patch)
      .eq("id", body.item_id)
      .select()
      .single();
    if (error) return errorResponse(error.message);
    return NextResponse.json({ data });
  }

  if (body.action === "submit-entry") {
    if (!body.entry_id) return errorResponse("entry_id is required");

    const entry = await getEntryForGuard(db, body.entry_id);
    if (!entry) return errorResponse("Logbook tidak ditemukan", 404);
    if (!actorAllowsDepartment(actor, entry.department_id)) return forbidden();
    if (!canSubmitEntry(entry.status))
      return errorResponse("Hanya logbook draft yang bisa disubmit", 409);

    const submitNote = normalizeNote(body.notes);
    if (!submitNote.ok) return errorResponse("Catatan tidak valid/terlalu panjang");

    const { data, error } = await db
      .from("hris_logbook_entries")
      .update({
        status: "submitted",
        notes: body.notes === undefined ? undefined : submitNote.value,
        submitted_by: actor.userId,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", body.entry_id)
      .select()
      .single();
    if (error) return errorResponse(error.message);
    return NextResponse.json({ data });
  }

  if (body.action === "review-entry") {
    if (!body.entry_id) return errorResponse("entry_id is required");
    if (!actor.canReview)
      return errorResponse("Anda tidak berhak me-review logbook", 403);

    const entry = await getEntryForGuard(db, body.entry_id);
    if (!entry) return errorResponse("Logbook tidak ditemukan", 404);
    // Scope department tetap dicek walau review roles saat ini subset
    // full-access — mencegah IDOR laten saat LOGBOOK_REVIEW_ROLES diperluas
    // ke head department (rencana owner).
    if (!actorAllowsDepartment(actor, entry.department_id)) return forbidden();
    if (!canReviewEntry(entry.status))
      return errorResponse(
        "Hanya logbook berstatus submitted yang bisa direview",
        409
      );

    const reviewNote = normalizeNote(body.review_notes);
    if (!reviewNote.ok) return errorResponse("Catatan review tidak valid/terlalu panjang");

    const status = body.status === "rejected" ? "rejected" : "reviewed";
    const { data, error } = await db
      .from("hris_logbook_entries")
      .update({
        status,
        review_notes: reviewNote.value,
        reviewed_by: actor.userId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", body.entry_id)
      .select()
      .single();
    if (error) return errorResponse(error.message);
    return NextResponse.json({ data });
  }

  return errorResponse("Unknown action", 422);
}

// ============================================================
// DELETE /api/hris/logbook?resource=entry|template&id=...
// ============================================================

export async function DELETE(request: Request) {
  const actor = await getLogbookActor();
  if (!actor) return unauthorized();

  const db = await createServerPgClient();
  const { searchParams } = new URL(request.url);
  const resource = searchParams.get("resource");
  const id = searchParams.get("id");
  if (!id) return errorResponse("id is required");

  if (resource === "entry") {
    const entry = await getEntryForGuard(db, id);
    if (!entry) return errorResponse("Logbook tidak ditemukan", 404);
    if (!actorAllowsDepartment(actor, entry.department_id)) return forbidden();
    if (!canDeleteEntry(entry.status))
      return errorResponse("Hanya logbook draft yang bisa dihapus", 409);

    // Item checklist ikut terhapus via FK ON DELETE CASCADE.
    const { error } = await db
      .from("hris_logbook_entries")
      .delete()
      .eq("id", id);
    if (error) return errorResponse(error.message);
    return NextResponse.json({ message: "Logbook dihapus" });
  }

  if (resource === "template") {
    const { data: template } = await db
      .from("hris_logbook_templates")
      .select("id, department_id")
      .eq("id", id)
      .maybeSingle();
    if (!template) return errorResponse("Template tidak ditemukan", 404);
    if (!actorAllowsDepartment(actor, template.department_id)) return forbidden();

    const { count } = await db
      .from("hris_logbook_entries")
      .select("*", { count: "exact", head: true })
      .eq("template_id", id);

    if ((count ?? 0) > 0) {
      // Sudah dipakai entry (FK SET NULL akan memutus riwayat) → arsipkan.
      const { error } = await db
        .from("hris_logbook_templates")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) return errorResponse(error.message);
      return NextResponse.json({
        message: "Template diarsipkan (sudah dipakai logbook)",
        archived: true,
      });
    }

    // Belum dipakai → hapus permanen (item template cascade).
    const { error } = await db
      .from("hris_logbook_templates")
      .delete()
      .eq("id", id);
    if (error) return errorResponse(error.message);
    return NextResponse.json({ message: "Template dihapus", archived: false });
  }

  return errorResponse("Unknown resource", 422);
}
