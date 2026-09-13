import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { emitCrmEvent } from "@/lib/crm/events";
import { getApiUserScope } from "@/lib/api/scope";
import { query, queryOne, withTransaction } from "@/lib/db";
import {
  DEAL_EVENT_TYPES,
  isValidCalendarDate,
  requireCompanyScope,
  requireSalesFunnelRole,
  validateAssignableOwner,
} from "@/lib/sales-funnel/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Deal yang sudah ditutup (menang/kalah) hanya tampil 90 hari terakhir agar
// kanban tidak tumbuh tanpa batas; riwayat lengkap = wilayah laporan Fase E.
const CLOSED_WINDOW_DAYS = 90;
// Pagar terakhir bila deal terbuka menumpuk bertahun-tahun — kanban bukan
// tempat riwayat; deal terlama di luar batas ini tinggal dicari via filter.
const MAX_KANBAN_DEALS = 500;

const DEAL_COLUMNS = `
  d.id, d.company_id, d.branch_id, d.lead_id, d.title, d.event_type,
  d.event_date, d.is_event_date_fixed, d.pax_estimate, d.stage_id,
  d.value_estimate, d.value_final, d.owner_user_id, d.lost_reason_id,
  d.entered_stage_at, d.closed_at, d.created_at, d.updated_at,
  l.org_name, l.org_type, l.pic_name, l.pic_phone, l.customer_id,
  s.code AS stage_code, s.is_won, s.is_lost, s.stuck_threshold_days,
  u.full_name AS owner_name, lr.name AS lost_reason_name`;

const createDealSchema = z.object({
  lead_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  event_type: z.enum(DEAL_EVENT_TYPES).default("lainnya"),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("")),
  is_event_date_fixed: z.boolean().default(false),
  pax_estimate: z.number().int().min(1).max(100000).optional().nullable(),
  value_estimate: z.number().min(0).max(99_999_999_999).optional().nullable(),
  owner_user_id: z.string().uuid().optional().nullable(),
});

export async function GET(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const scope = await getApiUserScope();
    const scopeError = requireCompanyScope(user, scope);
    if (scopeError) return scopeError;

    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const eventType = url.searchParams.get("event_type") ?? "";
    const owner = url.searchParams.get("owner_user_id") ?? "";

    const conditions: string[] = [
      "d.deleted_at IS NULL",
      `(d.closed_at IS NULL OR d.closed_at >= now() - interval '${CLOSED_WINDOW_DAYS} days')`,
    ];
    const params: unknown[] = [];
    const add = (fragment: string, value: unknown) => {
      params.push(value);
      conditions.push(fragment.replace("?", `$${params.length}`));
    };

    if (scope?.companyId) add("d.company_id = ?", scope.companyId);
    if (scope?.businessScope === "branch" && scope.branchId) {
      add("d.branch_id = ?", scope.branchId);
    }
    // Role sales hanya melihat deal miliknya ATAU tanpa owner (pola leads)
    if (user.role === "sales") {
      add("(d.owner_user_id = ? OR d.owner_user_id IS NULL)", user.id);
    }
    if (eventType && (DEAL_EVENT_TYPES as readonly string[]).includes(eventType)) {
      add("d.event_type = ?", eventType);
    }
    if (owner && UUID_RE.test(owner)) add("d.owner_user_id = ?", owner);
    if (q) {
      params.push(`%${q}%`);
      const idx = `$${params.length}`;
      conditions.push(
        `(d.title ILIKE ${idx} OR l.org_name ILIKE ${idx} OR l.pic_name ILIKE ${idx})`
      );
    }

    const rows = await query(
      `SELECT ${DEAL_COLUMNS}
       FROM crm.crm_sales_deals d
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
       JOIN crm.crm_sales_stages s ON s.id = d.stage_id
       LEFT JOIN configuration.users u ON u.id = d.owner_user_id
       LEFT JOIN crm.crm_sales_lost_reasons lr ON lr.id = d.lost_reason_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY d.entered_stage_at DESC
       LIMIT ${MAX_KANBAN_DEALS}`,
      params
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[sales-funnel] list deals error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat deals" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const parsed = createDealSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const scope = await getApiUserScope();
    const scopeError = requireCompanyScope(user, scope);
    if (scopeError) return scopeError;

    // Deal mewarisi venue dari lead-nya — validasi lead dalam scope user
    const lead = await queryOne<{
      id: string;
      company_id: string;
      branch_id: string;
      owner_user_id: string | null;
      status: string;
      org_name: string;
    }>(
      `SELECT id, company_id, branch_id, owner_user_id, status, org_name
       FROM crm.crm_sales_leads WHERE id = $1 AND deleted_at IS NULL`,
      [body.lead_id]
    );
    if (!lead) {
      return NextResponse.json(
        { success: false, error: "Lead tidak ditemukan" },
        { status: 404 }
      );
    }
    if (scope?.companyId && lead.company_id !== scope.companyId) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    if (
      scope?.businessScope === "branch" &&
      scope.branchId &&
      lead.branch_id !== scope.branchId
    ) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    if (
      user.role === "sales" &&
      lead.owner_user_id !== null &&
      lead.owner_user_id !== user.id
    ) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    if (body.event_date && !isValidCalendarDate(body.event_date)) {
      return NextResponse.json(
        { success: false, error: "Tanggal acara tidak valid" },
        { status: 400 }
      );
    }
    // Role sales tidak boleh mengalihkan kepemilikan ke user lain
    if (
      user.role === "sales" &&
      body.owner_user_id &&
      body.owner_user_id !== user.id
    ) {
      return NextResponse.json(
        { success: false, error: "Role sales hanya boleh menjadi penanggung jawab sendiri" },
        { status: 403 }
      );
    }
    if (body.owner_user_id) {
      const ownerError = await validateAssignableOwner(
        body.owner_user_id,
        lead.company_id
      );
      if (ownerError) {
        return NextResponse.json(
          { success: false, error: ownerError },
          { status: 400 }
        );
      }
    }

    // Deal baru selalu masuk tahap pertama pipeline (bukan menang/kalah)
    const firstStage = await queryOne<{ id: string }>(
      `SELECT id FROM crm.crm_sales_stages
       WHERE is_active = true AND is_won = false AND is_lost = false
       ORDER BY sort_order ASC LIMIT 1`
    );
    if (!firstStage) {
      return NextResponse.json(
        { success: false, error: "Tidak ada tahap pipeline aktif" },
        { status: 400 }
      );
    }

    // Satu transaksi: deal + riwayat tahap + status lead — jangan sampai
    // deal tersimpan tapi klien menerima 500 (retry = deal dobel) atau
    // funnel kehilangan baris riwayat (temuan gate Fase E).
    const row = await withTransaction(async (client) => {
      const inserted = await client.query<{ id: string; title: string; stage_id: string }>(
        `INSERT INTO crm.crm_sales_deals
           (company_id, branch_id, lead_id, title, event_type, event_date,
            is_event_date_fixed, pax_estimate, value_estimate, stage_id,
            owner_user_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id, title, stage_id`,
        [
          lead.company_id,
          lead.branch_id,
          lead.id,
          body.title,
          body.event_type,
          body.event_date || null,
          body.is_event_date_fixed,
          body.pax_estimate ?? null,
          body.value_estimate ?? null,
          firstStage.id,
          body.owner_user_id || (user.role === "sales" ? user.id : lead.owner_user_id),
          user.id,
        ]
      );
      const deal = inserted.rows[0];

      // Riwayat tahap (Fase E): deal baru tercatat masuk tahap pertama
      await client.query(
        `INSERT INTO crm.crm_sales_deal_stage_history
           (deal_id, stage_id, created_by)
         VALUES ($1, $2, $3)`,
        [deal.id, firstStage.id, user.id]
      );

      // Konversi lead→deal: lead baru/dihubungi otomatis qualified
      if (lead.status === "baru" || lead.status === "dihubungi") {
        await client.query(
          `UPDATE crm.crm_sales_leads
           SET status = 'qualified', updated_at = now()
           WHERE id = $1`,
          [lead.id]
        );
      }
      return deal;
    });

    // EPIC-050 Fase 2: event bus
    if (row?.id) {
      await emitCrmEvent({
        event_type: "deal.created",
        subject_type: "deal",
        subject_id: String(row.id),
        company_id: lead.company_id,
        branch_id: lead.branch_id,
        actor_user_id: user.id,
        payload: { title: row.title, event_type: body.event_type },
      });
    }
    return createdResponse(row, `Deal untuk ${lead.org_name} berhasil dibuat`);
  } catch (err) {
    console.error("[sales-funnel] create deal error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal membuat deal" },
      { status: 500 }
    );
  }
}
