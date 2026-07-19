import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiUser } from "@/lib/api/auth";
import { getPool } from "@/lib/db";
import { sendWhatsAppText } from "@/lib/whatsapp";

/**
 * EPIC-012 Fase A — riwayat pesan WhatsApp (siapa penerimanya, statusnya).
 * super_admin only: berisi nomor & isi pesan customer (PII).
 */

async function requireSuperAdmin() {
  const user = await getApiUser();
  if (!user) {
    return {
      error: NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      ),
      user: null,
    };
  }
  if (user.role !== "super_admin") {
    return {
      error: NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      ),
      user: null,
    };
  }
  return { error: null, user };
}

export async function GET(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard.error;

  try {
    const params = request.nextUrl.searchParams;
    const direction = params.get("direction");
    const messageType = params.get("type");
    const status = params.get("status");
    const search = params.get("search")?.trim();
    const rawLimit = params.get("limit");
    const parsedLimit = Number(rawLimit);
    const limit =
      rawLimit !== null && Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 200)
        : 100;

    const values: unknown[] = [];
    const filters: string[] = [];

    if (direction === "in" || direction === "out") {
      values.push(direction);
      filters.push(`m.direction = $${values.length}`);
    }
    if (messageType && messageType !== "all") {
      values.push(messageType);
      filters.push(`m.message_type = $${values.length}`);
    }
    if (status && status !== "all") {
      values.push(status);
      filters.push(`m.status = $${values.length}`);
    }
    if (search) {
      values.push(`%${search.replace(/[%_]/g, "")}%`);
      filters.push(`(m.phone LIKE $${values.length} OR c.name ILIKE $${values.length})`);
    }
    values.push(limit);

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT m.id, m.direction, m.message_type, m.phone, m.body, m.media_type,
              m.status, m.provider, m.provider_message_id, m.error_reason,
              m.wa_from_me, m.created_at,
              c.name AS customer_name
         FROM crm.wa_messages m
         LEFT JOIN pos.pos_customers c ON c.id = m.customer_id
        ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
        ORDER BY m.created_at DESC
        LIMIT $${values.length}`,
      values
    );

    const { rows: summary } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE direction = 'out')::int AS total_out,
              COUNT(*) FILTER (WHERE direction = 'in')::int AS total_in,
              COUNT(*) FILTER (WHERE status = 'failed')::int AS total_failed
         FROM crm.wa_messages`
    );

    return NextResponse.json({
      success: true,
      data: { messages: rows, summary: summary[0] },
    });
  } catch (error) {
    console.error("Error fetching WA message history:", error);
    return NextResponse.json(
      { success: false, error: "Gagal memuat riwayat pesan" },
      { status: 500 }
    );
  }
}

const resendSchema = z.object({ id: z.string().uuid() });

/** Kirim ulang pesan yang gagal. OTP dikecualikan — kodenya sudah basi. */
export async function POST(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard.error;

  try {
    const payload = resendSchema.parse(await request.json());
    const pool = getPool();

    const { rows } = await pool.query(
      `SELECT id, phone, body, message_type, status, conversation_id
         FROM crm.wa_messages WHERE id = $1`,
      [payload.id]
    );
    const original = rows[0];
    if (!original) {
      return NextResponse.json({ success: false, error: "Pesan tidak ditemukan" }, { status: 404 });
    }
    if (original.status !== "failed") {
      return NextResponse.json(
        { success: false, error: "Hanya pesan berstatus gagal yang bisa dikirim ulang" },
        { status: 409 }
      );
    }
    if (original.message_type === "otp" || !original.body) {
      return NextResponse.json(
        { success: false, error: "OTP tidak bisa dikirim ulang — minta member request ulang dari portal" },
        { status: 409 }
      );
    }

    const result = await sendWhatsAppText(
      { target: original.phone, message: original.body },
      {
        messageType: original.message_type,
        sentByUserId: guard.user.id,
        conversationId: original.conversation_id,
      }
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.reason ?? "Pengiriman ulang gagal" },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, data: { messageId: result.messageId } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: "Payload tidak valid" }, { status: 400 });
    }
    console.error("Error resending WA message:", error);
    return NextResponse.json({ success: false, error: "Gagal mengirim ulang" }, { status: 500 });
  }
}
