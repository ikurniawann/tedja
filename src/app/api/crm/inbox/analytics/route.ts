import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { apiErrorResponse, requireCrmInboxAgent } from "@/lib/crm/server";
import {
  MAX_PENDING_LIMIT,
  analyzeConversation,
  analyzePending,
  getStoredInsight,
} from "@/lib/crm/conversation-insights-server";

/**
 * EPIC-029 — analisa percakapan inbox dengan AI (ringkasan + kata kunci).
 *
 * Guard `requireCrmInboxAgent` (super_admin / admin / pos_supervisor) karena
 * respons endpoint ini memuat `summary` yang menyarikan isi chat — PII. Laporan
 * agregat bebas PII hidup di `/api/crm/reports/conversations`, dengan guard
 * role laporan yang berbeda.
 */

const bodySchema = z.union([
  z.object({ conversation_id: z.string().uuid(), force: z.boolean().optional() }),
  z.object({
    analyze_pending: z.literal(true),
    limit: z.number().int().positive().max(MAX_PENDING_LIMIT).optional(),
  }),
]);

/** Baca insight tersimpan satu percakapan — tanpa memanggil OpenAI. */
export async function GET(request: NextRequest) {
  const guard = await requireCrmInboxAgent();
  if (guard.error) return guard.error;

  const conversationId = request.nextUrl.searchParams.get("conversation_id");
  if (!conversationId) {
    return NextResponse.json(
      { success: false, error: "Parameter conversation_id wajib diisi" },
      { status: 400 }
    );
  }

  try {
    const insight = await getStoredInsight(getPool(), conversationId);
    return NextResponse.json({ success: true, data: { insight } });
  } catch (error) {
    return apiErrorResponse(error, "Gagal memuat ringkasan percakapan");
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireCrmInboxAgent();
  if (guard.error) return guard.error;

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Body tidak valid (kirim {conversation_id} atau {analyze_pending:true, limit?})",
      },
      { status: 400 }
    );
  }

  try {
    const pool = getPool();

    if ("analyze_pending" in payload) {
      const batch = await analyzePending(pool, { limit: payload.limit });
      return NextResponse.json({ success: true, data: batch });
    }

    const result = await analyzeConversation(pool, payload.conversation_id, {
      force: payload.force,
    });
    // Kegagalan analisa BUKAN error server: percakapannya ada, hanya AI-nya yang
    // tidak menjawab. 502 supaya UI bisa membedakannya dari bug/izin.
    const status = result.status === "failed" ? 502 : 200;
    return NextResponse.json({ success: result.status !== "failed", data: result }, { status });
  } catch (error) {
    return apiErrorResponse(error, "Gagal menganalisa percakapan");
  }
}
