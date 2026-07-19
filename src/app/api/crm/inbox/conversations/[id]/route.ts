import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { requireCrmInboxAgent } from "@/lib/crm/server";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { messagePreview } from "@/lib/whatsapp/inbound";

/**
 * EPIC-012 Fase C — detail percakapan (pesan + konteks member) & aksi agent.
 */

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), message: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal("assign_me") }),
  z.object({ action: z.literal("unassign") }),
  z.object({
    action: z.literal("set_status"),
    status: z.enum(["open", "in_progress", "waiting_customer", "resolved"]),
  }),
  z.object({ action: z.literal("mark_read") }),
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireCrmInboxAgent();
  if (guard.error) return guard.error;

  try {
    const { id } = await params;
    const pool = getPool();

    const { rows: convRows } = await pool.query(
      `SELECT v.id, v.phone, v.status, v.assigned_user_id, v.unread_count,
              v.last_message_at, v.customer_id,
              u.full_name AS assigned_name
         FROM crm.wa_conversations v
         LEFT JOIN configuration.users u ON u.id = v.assigned_user_id
        WHERE v.id = $1`,
      [id]
    );
    const conversation = convRows[0];
    if (!conversation) {
      return NextResponse.json(
        { success: false, error: "Percakapan tidak ditemukan" },
        { status: 404 }
      );
    }

    const [{ rows: messages }, memberContext] = await Promise.all([
      pool.query(
        `SELECT m.id, m.direction, m.message_type, m.body, m.media_type, m.status,
                m.error_reason, m.wa_from_me, m.created_at,
                u.full_name AS sent_by_name
           FROM crm.wa_messages m
           LEFT JOIN configuration.users u ON u.id = m.sent_by_user_id
          WHERE m.conversation_id = $1
          ORDER BY m.created_at ASC
          LIMIT 300`,
        [id]
      ),
      loadMemberContext(pool, conversation.customer_id),
    ]);

    return NextResponse.json({
      success: true,
      data: { conversation, messages, member: memberContext },
    });
  } catch (error) {
    console.error("Error fetching WA conversation detail:", error);
    return NextResponse.json(
      { success: false, error: "Gagal memuat percakapan" },
      { status: 500 }
    );
  }
}

async function loadMemberContext(
  pool: ReturnType<typeof getPool>,
  customerId: string | null
) {
  if (!customerId) return null;

  const [{ rows: customers }, { rows: orders }, { rows: redemptions }] =
    await Promise.all([
      pool.query(
        `SELECT c.id, c.name, c.phone, c.member_type, c.visit_count,
                c.total_xp::float AS total_xp,
                c.ark_coin_balance::float AS ark_coin_balance,
                t.name AS tier_name
           FROM pos.pos_customers c
           LEFT JOIN LATERAL (
             SELECT name FROM crm.crm_membership_tiers
              WHERE is_active AND min_lifetime_xp <= COALESCE(c.total_xp, 0)
              ORDER BY rank DESC LIMIT 1
           ) t ON true
          WHERE c.id = $1`,
        [customerId]
      ),
      pool.query(
        `SELECT id, order_number, total_amount::float AS total_amount,
                payment_method, status, created_at
           FROM pos.pos_orders
          WHERE customer_id = $1
          ORDER BY created_at DESC LIMIT 5`,
        [customerId]
      ),
      pool.query(
        `SELECT r.redemption_number, r.status, r.requested_at, w.name AS reward_name
           FROM crm.crm_redemptions r
           JOIN crm.crm_rewards w ON w.id = r.reward_id
          WHERE r.customer_id = $1
          ORDER BY r.requested_at DESC LIMIT 5`,
        [customerId]
      ),
    ]);

  const customer = customers[0];
  if (!customer) return null;

  return { ...customer, recent_orders: orders, recent_redemptions: redemptions };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireCrmInboxAgent();
  if (guard.error) return guard.error;

  try {
    const { id } = await params;
    const payload = actionSchema.parse(await request.json());
    const pool = getPool();

    const { rows: convRows } = await pool.query(
      `SELECT id, phone, status, assigned_user_id FROM crm.wa_conversations WHERE id = $1`,
      [id]
    );
    const conversation = convRows[0];
    if (!conversation) {
      return NextResponse.json(
        { success: false, error: "Percakapan tidak ditemukan" },
        { status: 404 }
      );
    }

    if (payload.action === "mark_read") {
      await pool.query(
        `UPDATE crm.wa_conversations SET unread_count = 0 WHERE id = $1`,
        [id]
      );
      return NextResponse.json({ success: true });
    }

    if (payload.action === "assign_me") {
      await pool.query(
        `UPDATE crm.wa_conversations
            SET assigned_user_id = $2,
                status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END
          WHERE id = $1`,
        [id, guard.user.id]
      );
      return NextResponse.json({ success: true });
    }

    if (payload.action === "unassign") {
      await pool.query(
        `UPDATE crm.wa_conversations SET assigned_user_id = NULL WHERE id = $1`,
        [id]
      );
      return NextResponse.json({ success: true });
    }

    if (payload.action === "set_status") {
      await pool.query(
        `UPDATE crm.wa_conversations SET status = $2 WHERE id = $1`,
        [id, payload.status]
      );
      return NextResponse.json({ success: true });
    }

    // action === "reply" — kirim lewat gateway, catat, perbarui percakapan.
    const result = await sendWhatsAppText(
      { target: conversation.phone, message: payload.message },
      { messageType: "chat", sentByUserId: guard.user.id, conversationId: id }
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.reason ?? "Gagal mengirim balasan" },
        { status: 502 }
      );
    }

    await pool.query(
      `UPDATE crm.wa_conversations
          SET last_message_at = now(),
              last_message_preview = $2,
              status = CASE WHEN status IN ('open','resolved') THEN 'in_progress' ELSE status END,
              assigned_user_id = COALESCE(assigned_user_id, $3)
        WHERE id = $1`,
      [id, messagePreview(payload.message, null), guard.user.id]
    );

    return NextResponse.json({ success: true, data: { messageId: result.messageId } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Payload tidak valid" },
        { status: 400 }
      );
    }
    console.error("Error executing WA conversation action:", error);
    return NextResponse.json(
      { success: false, error: "Gagal memproses aksi" },
      { status: 500 }
    );
  }
}
