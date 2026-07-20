import { NextRequest, NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import { TTS_PREVIEW_TEXT, isTtsProviderId } from "@/lib/tts/catalog";
import { TtsNotConfiguredError, synthesizeSpeech } from "@/lib/tts/synthesize";

/**
 * POST /api/settings/tts/preview — dengarkan kombinasi provider/voice/model
 * SEBELUM disimpan, memakai kalimat pembuka wawancara yang sesungguhnya.
 *
 * Body opsional: { provider, voice, model, text }.
 * Tanpa body → memakai konfigurasi tersimpan.
 */

/** Teks bebas dibatasi agar tombol preview tidak jadi corong TTS gratis. */
const MAX_PREVIEW_CHARS = 300;

export async function POST(request: NextRequest) {
  try {
    await requireApiRole(["super_admin", "admin"]);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.provider !== undefined && !isTtsProviderId(body.provider)) {
      return NextResponse.json({ error: "Provider tidak dikenal" }, { status: 400 });
    }

    const rawText = typeof body.text === "string" ? body.text.trim() : "";
    const text = (rawText || TTS_PREVIEW_TEXT).slice(0, MAX_PREVIEW_CHARS);

    const result = await synthesizeSpeech(text, {
      provider: isTtsProviderId(body.provider) ? body.provider : undefined,
      voice: typeof body.voice === "string" ? body.voice : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    });

    return NextResponse.json({
      data: {
        audio_base64: result.buffer.toString("base64"),
        provider: result.provider,
        voice: result.voice,
        model: result.model,
        text,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof TtsNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // Pesan provider diteruskan apa adanya: inilah gunanya preview — kalau key
    // salah atau voice tidak ada, admin harus melihat alasannya, bukan "gagal".
    const message = error instanceof Error ? error.message : "Gagal membuat preview";
    console.error("[settings/tts/preview] gagal:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
