import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { loadGobizConfig } from "@/lib/gobiz/config";
import { parseGofoodWebhook } from "@/lib/gobiz/mapping";
import { processGofoodEvent, recordGofoodEvent } from "@/lib/gobiz/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/gobiz/webhook/[token] — penerima event GoBiz (EPIC-049).
 *
 * Autentikasi: token acak di path (dibuat di Settings → Integrasi → GoBiz dan
 * didaftarkan ke GoBiz lewat notification-subscriptions). Dokumentasi GoBiz
 * tidak merinci algoritma X-Go-Signature, jadi token URL adalah gerbang utama;
 * header X-Go-Idempotency-Key + event_id disimpan utk idempotency (GoBiz tidak
 * menjamin exactly-once). Balasan selalu {success:true} agar GoBiz tidak
 * retry berulang utk event yang memang kita abaikan.
 */

function tokenMatches(expected: string, given: string) {
  if (!expected || !given || expected.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const config = await loadGobizConfig();
  if (!tokenMatches(config.webhookToken, String(token || ""))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const event = parseGofoodWebhook(json);
  if (!event) {
    console.warn("[gobiz webhook] payload tidak dikenali:", JSON.stringify(json).slice(0, 500));
    return NextResponse.json({ success: true, data: {}, ignored: true, reason: "unrecognized_payload" });
  }

  const idempotencyKey = request.headers.get("x-go-idempotency-key");
  try {
    const eventRowId = await recordGofoodEvent(event, idempotencyKey);
    if (!eventRowId) {
      return NextResponse.json({ success: true, data: {}, ignored: true, reason: "duplicate_event" });
    }
    const result = await processGofoodEvent(event, eventRowId);
    return NextResponse.json({ success: true, data: { result } });
  } catch (error) {
    // Event sudah tercatat (result=error) → bisa diproses ulang dari halaman GoFood.
    console.error(`[gobiz webhook] ${event.header.event_name} ${event.header.event_id} gagal:`, error);
    return NextResponse.json({ success: true, data: {}, processed: false });
  }
}
