import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import {
  CRM_REVIEW_APPROVER_ROLES,
  apiErrorResponse,
  requireCrmInboxAgent,
} from "@/lib/crm/server";
import { googleBusinessStatus } from "@/lib/crm/google-business-client";
import {
  approvePendingReply,
  getGoogleReviewSettings,
  rejectPendingReply,
  submitReply,
  syncGoogleReviews,
} from "@/lib/crm/google-reviews-server";
import { evaluateReviewSla } from "@/lib/crm/google-reviews";

/**
 * EPIC-013 Fase A — daftar & balas Google Review.
 * Peran mengikuti inbox CS (super_admin/admin/pos_supervisor): membalas
 * ulasan adalah pekerjaan CS yang tampil publik.
 *
 * Balasan untuk ulasan ber-rating <= 2 dari non-approver masuk antrean
 * persetujuan; hanya super_admin/admin yang boleh menyetujui/menolak.
 */

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reply"),
    id: z.string().uuid(),
    comment: z.string().trim().min(1).max(4000),
  }),
  z.object({ action: z.literal("approve_reply"), id: z.string().uuid() }),
  z.object({ action: z.literal("reject_reply"), id: z.string().uuid() }),
  z.object({ action: z.literal("ignore"), id: z.string().uuid() }),
  z.object({ action: z.literal("sync") }),
]);

export async function GET(request: NextRequest) {
  const guard = await requireCrmInboxAgent();
  if (guard.error) return guard.error;

  try {
    const params = request.nextUrl.searchParams;
    const status = params.get("status");
    const rating = Number(params.get("rating"));
    const location = params.get("location");

    const values: unknown[] = [];
    const filters: string[] = [];

    if (status && status !== "all") {
      values.push(status);
      filters.push(`r.status = $${values.length}`);
    }
    if (Number.isFinite(rating) && rating >= 1 && rating <= 5) {
      values.push(rating);
      filters.push(`r.star_rating = $${values.length}`);
    }
    if (location && location !== "all") {
      values.push(location);
      filters.push(`r.location_id = $${values.length}`);
    }

    const pool = getPool();
    const settings = await getGoogleReviewSettings(pool);

    const { rows } = await pool.query(
      `SELECT r.id, r.reviewer_name, r.reviewer_photo_url, r.star_rating, r.comment,
              r.review_created_at, r.reply_comment, r.reply_updated_at,
              r.status, r.is_complaint, r.first_reply_seconds, r.location_id,
              r.pending_reply_comment, r.reply_approval_status,
              u.full_name AS replied_by_name,
              pu.full_name AS pending_by_name
         FROM crm.google_reviews r
         LEFT JOIN configuration.users u ON u.id = r.replied_by_user_id
         LEFT JOIN configuration.users pu ON pu.id = r.pending_reply_user_id
        ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
        ORDER BY r.review_created_at DESC
        LIMIT 100`,
      values
    );

    const { rows: summaryRows } = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'baru')::int AS belum_dibalas,
              COUNT(*) FILTER (WHERE is_complaint AND status = 'baru')::int AS komplain_terbuka,
              COUNT(*) FILTER (WHERE reply_approval_status = 'pending_approval')::int
                AS menunggu_persetujuan,
              AVG(star_rating)::numeric(3,2) AS rata_rating,
              AVG(first_reply_seconds) FILTER (WHERE first_reply_seconds IS NOT NULL)
                AS rata_waktu_balas
         FROM crm.google_reviews`
    );

    // Daftar lokasi untuk filter — hanya berarti bila multi-lokasi.
    const { rows: locationRows } = await pool.query(
      `SELECT location_id, COUNT(*)::int AS total
         FROM crm.google_reviews
        WHERE location_id IS NOT NULL
        GROUP BY location_id
        ORDER BY location_id`
    );

    // SLA dihitung saat dibaca supaya perubahan konfigurasi langsung terasa
    // tanpa perlu menunggu job berikutnya.
    const now = new Date();
    const reviews = rows.map((row) => {
      const sla = evaluateReviewSla(
        row.review_created_at,
        settings.slaReplyMinutes,
        row.reply_updated_at ? new Date(row.reply_updated_at) : null,
        now
      );
      return { ...row, sla_breached: sla?.breached ?? false, waiting_seconds: sla?.waitingSeconds ?? 0 };
    });

    return NextResponse.json({
      success: true,
      data: {
        reviews,
        summary: summaryRows[0],
        locations: locationRows,
        settings,
        integration: await googleBusinessStatus(),
        viewer: {
          canApprove: CRM_REVIEW_APPROVER_ROLES.includes(guard.user.role),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching Google reviews:", error);
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireCrmInboxAgent();
  if (guard.error) return guard.error;

  try {
    const payload = actionSchema.parse(await request.json());
    const pool = getPool();
    const canApprove = CRM_REVIEW_APPROVER_ROLES.includes(guard.user.role);

    if (payload.action === "sync") {
      const summary = await syncGoogleReviews(pool);
      if (summary.error) {
        return NextResponse.json(
          { success: false, error: summary.error, notConfigured: summary.notConfigured },
          { status: summary.notConfigured ? 409 : 502 }
        );
      }
      return NextResponse.json({ success: true, data: summary });
    }

    if (payload.action === "ignore") {
      await pool.query(
        `UPDATE crm.google_reviews SET status = 'diabaikan' WHERE id = $1`,
        [payload.id]
      );
      return NextResponse.json({ success: true });
    }

    if (payload.action === "approve_reply" || payload.action === "reject_reply") {
      if (!canApprove) {
        return NextResponse.json(
          { success: false, error: "Hanya admin/super admin yang boleh menyetujui balasan" },
          { status: 403 }
        );
      }
      const result =
        payload.action === "approve_reply"
          ? await approvePendingReply(payload.id, guard.user.id, pool)
          : await rejectPendingReply(payload.id, guard.user.id, pool);
      if (!result.ok) {
        return NextResponse.json({ success: false, error: result.error }, { status: result.status });
      }
      return NextResponse.json({ success: true });
    }

    const result = await submitReply(
      payload.id,
      payload.comment,
      { id: guard.user.id, canApprove },
      pool
    );
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true, data: { pending: result.pending } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: "Payload tidak valid" }, { status: 400 });
    }
    console.error("Error acting on Google review:", error);
    return apiErrorResponse(error);
  }
}
