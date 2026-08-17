import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { SETTING_KEYS, getSettings, maskSecret, setSetting } from "@/lib/settings/app-settings";
import {
  TTS_DEFAULT_PROVIDER,
  TTS_PROVIDERS,
  getTtsProvider,
  isTtsProviderId,
  resolveTtsModel,
  resolveTtsVoice,
} from "@/lib/tts/catalog";

/**
 * GET /api/settings/tts  — konfigurasi suara AI + katalog provider/voice.
 * PUT /api/settings/tts  — simpan provider, voice, model, dan kredensial.
 *
 * Rahasia (Azure key, ElevenLabs key) tidak pernah dikirim balik utuh, hanya
 * versi tersamar — pola sama dengan /api/settings/integrations.
 */

export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.settingsIntegrations);
    const s = await getSettings([
      SETTING_KEYS.TTS_PROVIDER,
      SETTING_KEYS.TTS_VOICE,
      SETTING_KEYS.TTS_MODEL,
      SETTING_KEYS.OPENAI_API_KEY,
      SETTING_KEYS.AZURE_SPEECH_KEY,
      SETTING_KEYS.AZURE_SPEECH_REGION,
      SETTING_KEYS.ELEVENLABS_API_KEY,
    ]);

    const provider = getTtsProvider(s[SETTING_KEYS.TTS_PROVIDER] ?? TTS_DEFAULT_PROVIDER).id;

    return NextResponse.json({
      data: {
        provider,
        voice: resolveTtsVoice(provider, s[SETTING_KEYS.TTS_VOICE]),
        model: resolveTtsModel(provider, s[SETTING_KEYS.TTS_MODEL]),
        catalog: TTS_PROVIDERS,
        credentials: {
          openai: { configured: Boolean(s[SETTING_KEYS.OPENAI_API_KEY]) },
          azure: {
            configured: Boolean(s[SETTING_KEYS.AZURE_SPEECH_KEY] && s[SETTING_KEYS.AZURE_SPEECH_REGION]),
            key_masked: maskSecret(s[SETTING_KEYS.AZURE_SPEECH_KEY]),
            region: s[SETTING_KEYS.AZURE_SPEECH_REGION] ?? "",
          },
          elevenlabs: {
            configured: Boolean(s[SETTING_KEYS.ELEVENLABS_API_KEY]),
            key_masked: maskSecret(s[SETTING_KEYS.ELEVENLABS_API_KEY]),
          },
        },
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[settings/tts] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsIntegrations);
    const body = (await request.json()) as Record<string, unknown>;

    if (body.provider !== undefined) {
      if (!isTtsProviderId(body.provider)) {
        return NextResponse.json({ error: "Provider tidak dikenal" }, { status: 400 });
      }
      await setSetting(SETTING_KEYS.TTS_PROVIDER, body.provider);
    }

    // Voice & model divalidasi terhadap provider yang BARU disimpan, supaya
    // kombinasi mustahil (mis. voice Azure di provider OpenAI) tidak tersimpan.
    const current = await getSettings([SETTING_KEYS.TTS_PROVIDER]);
    const activeProvider = getTtsProvider(current[SETTING_KEYS.TTS_PROVIDER]).id;

    if (body.voice !== undefined) {
      if (typeof body.voice !== "string") {
        return NextResponse.json({ error: "Voice tidak valid" }, { status: 400 });
      }
      await setSetting(SETTING_KEYS.TTS_VOICE, resolveTtsVoice(activeProvider, body.voice) || null);
    }

    if (body.model !== undefined) {
      if (typeof body.model !== "string") {
        return NextResponse.json({ error: "Model tidak valid" }, { status: 400 });
      }
      await setSetting(SETTING_KEYS.TTS_MODEL, resolveTtsModel(activeProvider, body.model));
    }

    for (const [field, key] of [
      ["azure_key", SETTING_KEYS.AZURE_SPEECH_KEY],
      ["azure_region", SETTING_KEYS.AZURE_SPEECH_REGION],
      ["elevenlabs_key", SETTING_KEYS.ELEVENLABS_API_KEY],
    ] as const) {
      const value = body[field];
      if (value === undefined) continue;
      if (value !== null && typeof value !== "string") {
        return NextResponse.json({ error: `${field} tidak valid` }, { status: 400 });
      }
      // string kosong / null = hapus, string berisi = simpan
      await setSetting(key, value ? String(value).trim() : null);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[settings/tts] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
