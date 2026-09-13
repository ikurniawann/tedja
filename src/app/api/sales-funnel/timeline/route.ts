import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { findAccessibleSubject } from "@/lib/sales-funnel/access";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";
import { TASK_SUBJECT_TYPES, type TaskSubjectType } from "@/lib/sales-funnel/tasks";
import { mergeTimeline, type TimelineSources } from "@/lib/sales-funnel/timeline";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * EPIC-050 Fase 1 (T-1.4) — GET /api/sales-funnel/timeline?subject_type=&subject_id=
 * Menggabungkan task/aktivitas, riwayat tahap deal, quotation, invoice, dan
 * pesan WA (dicocokkan lewat nomor telepon PIC/contact/member) untuk satu record.
 * Cakupan per jenis subjek:
 *   lead    → lead + deal-dealnya
 *   deal    → deal itu saja
 *   account → semua lead/deal/contact di bawahnya
 *   contact → lead yang menautkan contact + WA ke nomornya
 *   member  → task member + WA ke nomornya
 */
export async function GET(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  try {
    const url = new URL(request.url);
    const subjectType = url.searchParams.get("subject_type") ?? "";
    const subjectId = url.searchParams.get("subject_id") ?? "";
    const limit = Math.min(300, Math.max(10, Number(url.searchParams.get("limit")) || 100));
    if (!(TASK_SUBJECT_TYPES as readonly string[]).includes(subjectType) || !UUID_RE.test(subjectId)) {
      return NextResponse.json(
        { success: false, error: "subject_type & subject_id wajib" },
        { status: 400 }
      );
    }
    const type = subjectType as TaskSubjectType;
    const { forbidden, notFound } = await findAccessibleSubject(type, subjectId, user);
    if (forbidden || notFound) {
      return NextResponse.json(
        { success: false, error: forbidden ? "Insufficient permissions" : "Subjek tidak ditemukan" },
        { status: forbidden ? 403 : 404 }
      );
    }

    // ── Himpunan lead/deal yang tercakup subjek ──
    let leadWhere = "FALSE";
    let dealWhere = "FALSE";
    let taskExtra = "FALSE";
    const params: unknown[] = [subjectId];
    switch (type) {
      case "lead":
        leadWhere = "l.id = $1";
        dealWhere = "d.lead_id = $1";
        taskExtra = "(a.lead_id = $1 OR (a.subject_type = 'lead' AND a.subject_id = $1))";
        break;
      case "deal":
        dealWhere = "d.id = $1";
        taskExtra = "a.deal_id = $1";
        break;
      case "account":
        leadWhere = "l.account_id = $1";
        dealWhere = "d.lead_id IN (SELECT id FROM crm.crm_sales_leads WHERE account_id = $1 AND deleted_at IS NULL)";
        taskExtra = `((a.subject_type = 'account' AND a.subject_id = $1)
          OR (a.subject_type = 'contact' AND a.subject_id IN (SELECT id FROM crm.crm_contacts WHERE account_id = $1 AND deleted_at IS NULL)))`;
        break;
      case "contact":
        leadWhere = "l.contact_id = $1";
        dealWhere = "d.lead_id IN (SELECT id FROM crm.crm_sales_leads WHERE contact_id = $1 AND deleted_at IS NULL)";
        taskExtra = "(a.subject_type = 'contact' AND a.subject_id = $1)";
        break;
      case "member":
        taskExtra = "(a.subject_type = 'member' AND a.subject_id = $1)";
        break;
    }
    const dealIdsSql = `SELECT d.id FROM crm.crm_sales_deals d WHERE d.deleted_at IS NULL AND ${dealWhere}`;

    const sources: TimelineSources = {};
    sources.tasks = await query(
      `SELECT a.id, a.activity_type, a.title, a.notes, a.due_at, a.done_at, a.status,
              a.priority, a.created_at, u.full_name AS owner_name, d.title AS deal_title
       FROM crm.crm_sales_activities a
       LEFT JOIN configuration.users u ON u.id = a.owner_user_id
       LEFT JOIN crm.crm_sales_deals d ON d.id = a.deal_id
       WHERE a.deleted_at IS NULL
         AND (${taskExtra}
              OR a.deal_id IN (${dealIdsSql})
              OR a.lead_id IN (SELECT l.id FROM crm.crm_sales_leads l WHERE l.deleted_at IS NULL AND ${leadWhere}))
       ORDER BY COALESCE(a.done_at, a.due_at, a.created_at) DESC
       LIMIT 200`,
      params
    );
    if (type !== "member") {
      sources.stages = await query(
        `SELECT h.id, h.deal_id, d.title AS deal_title, s.name AS stage_name, h.entered_at,
                u.full_name AS actor_name
         FROM crm.crm_sales_deal_stage_history h
         JOIN crm.crm_sales_deals d ON d.id = h.deal_id
         JOIN crm.crm_sales_stages s ON s.id = h.stage_id
         LEFT JOIN configuration.users u ON u.id = h.created_by
         WHERE h.deal_id IN (${dealIdsSql})
         ORDER BY h.entered_at DESC LIMIT 100`,
        params
      );
      sources.quotations = await query(
        `SELECT q.id, q.deal_id, q.quote_number, q.status, q.total, q.created_at
         FROM crm.crm_sales_quotations q
         WHERE q.deleted_at IS NULL AND q.deal_id IN (${dealIdsSql})
         ORDER BY q.created_at DESC LIMIT 50`,
        params
      );
      sources.invoices = await query(
        `SELECT i.id, i.deal_id, i.invoice_number, i.label, i.status, i.amount, i.created_at
         FROM crm.crm_sales_invoices i
         WHERE i.deleted_at IS NULL AND i.deal_id IN (${dealIdsSql})
         ORDER BY i.created_at DESC LIMIT 50`,
        params
      );
      if (type === "account" || type === "contact") {
        sources.leads = await query(
          `SELECT l.id, l.org_name, l.status, l.created_at, u.full_name AS owner_name
           FROM crm.crm_sales_leads l LEFT JOIN configuration.users u ON u.id = l.owner_user_id
           WHERE l.deleted_at IS NULL AND ${leadWhere}
           ORDER BY l.created_at DESC LIMIT 50`,
          params
        );
      }
      if (type !== "deal") {
        sources.deals = await query(
          `SELECT d.id, d.title, s.name AS stage_name, d.created_at, u.full_name AS owner_name
           FROM crm.crm_sales_deals d
           JOIN crm.crm_sales_stages s ON s.id = d.stage_id
           LEFT JOIN configuration.users u ON u.id = d.owner_user_id
           WHERE d.deleted_at IS NULL AND ${dealWhere}
           ORDER BY d.created_at DESC LIMIT 50`,
          params
        );
      }
    }

    // ── Pesan WA lewat nomor telepon subjek ──
    let phones: string[] = [];
    if (type === "lead") {
      const row = await queryOne<{ pic_phone: string }>(
        `SELECT pic_phone FROM crm.crm_sales_leads WHERE id = $1`,
        [subjectId]
      );
      if (row?.pic_phone) phones = [row.pic_phone];
    } else if (type === "deal") {
      const row = await queryOne<{ pic_phone: string }>(
        `SELECT l.pic_phone FROM crm.crm_sales_deals d JOIN crm.crm_sales_leads l ON l.id = d.lead_id WHERE d.id = $1`,
        [subjectId]
      );
      if (row?.pic_phone) phones = [row.pic_phone];
    } else if (type === "contact") {
      const row = await queryOne<{ phone: string }>(`SELECT phone FROM crm.crm_contacts WHERE id = $1`, [subjectId]);
      if (row?.phone) phones = [row.phone];
    } else if (type === "account") {
      const rows = await query<{ phone: string }>(
        `SELECT phone FROM crm.crm_contacts WHERE account_id = $1 AND deleted_at IS NULL LIMIT 20`,
        [subjectId]
      );
      phones = rows.map((r) => r.phone);
    } else if (type === "member") {
      const row = await queryOne<{ phone: string | null }>(`SELECT phone FROM pos.pos_customers WHERE id = $1`, [subjectId]);
      if (row?.phone) phones = [row.phone];
    }
    if (phones.length > 0) {
      // Nomor di wa_messages bisa tersimpan 08…/62…; cocokkan pada 9 digit terakhir
      const suffixes = phones.map((p) => p.replace(/[^0-9]/g, "").slice(-9)).filter((s) => s.length >= 9);
      if (suffixes.length > 0) {
        sources.waMessages = await query(
          `SELECT m.id, m.direction, m.body, m.status, m.created_at, u.full_name AS sender_name
           FROM crm.wa_messages m
           LEFT JOIN configuration.users u ON u.id = m.sent_by_user_id
           WHERE right(regexp_replace(m.phone, '[^0-9]', '', 'g'), 9) = ANY($1::text[])
           ORDER BY m.created_at DESC LIMIT 100`,
          [suffixes]
        );
      }
    }

    return successResponse(mergeTimeline(sources, limit));
  } catch (err) {
    console.error("[sales-funnel] timeline error:", err);
    return NextResponse.json({ success: false, error: "Gagal memuat timeline" }, { status: 500 });
  }
}
