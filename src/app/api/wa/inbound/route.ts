import { NextRequest, NextResponse } from "next/server";
import { normalizeInbound, type GatewayInboundPayload } from "@/lib/whatsapp/inbound";
import { recordGatewayMessage } from "@/lib/whatsapp/store";

/**
 * EPIC-012 Fase B — penerima event pesan dari wa-gateway (Baileys
 * messages.upsert). Dipanggil HANYA oleh gateway di mesin yang sama; token
 * bersama WA_GATEWAY_TOKEN dipakai dua arah (app→gateway utk kirim,
 * gateway→app utk event masuk).
 */
export async function POST(request: NextRequest) {
  const token = process.env.WA_GATEWAY_TOKEN;
  if (!token || request.headers.get("x-gateway-token") !== token) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let payloads: GatewayInboundPayload[];
  try {
    const json = await request.json();
    payloads = Array.isArray(json?.messages) ? json.messages : [];
  } catch {
    return NextResponse.json({ success: false, error: "JSON tidak valid" }, { status: 400 });
  }

  let stored = 0;
  let skipped = 0;

  for (const payload of payloads) {
    const normalized = normalizeInbound(payload);
    if (!normalized) {
      skipped += 1;
      continue;
    }

    try {
      const result = await recordGatewayMessage(normalized);
      if (result.stored) stored += 1;
      else skipped += 1;
    } catch (error) {
      // Satu pesan gagal tidak boleh menggagalkan sisanya; gateway tidak
      // mengulang batch yang sudah dijawab 200.
      console.error(
        "[wa-inbound] Gagal merekam pesan:",
        error instanceof Error ? error.message : error
      );
    }
  }

  return NextResponse.json({ success: true, stored, skipped });
}
