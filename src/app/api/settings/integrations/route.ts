import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  DEEPSEEK_DEFAULTS,
  OPENAI_DEFAULTS,
  SETTING_KEYS,
  getSettings,
  maskSecret,
  setSetting,
} from "@/lib/settings/app-settings";

/**
 * GET  /api/settings/integrations — konfigurasi integrasi (API key dimask).
 * PUT  /api/settings/integrations — simpan konfigurasi DeepSeek/OpenAI.
 *      Field DeepSeek tetap flat (api_key/model/base_url) demi kompatibilitas;
 *      OpenAI dikirim sebagai objek `openai: {api_key, model, base_url}`.
 */

const PROVIDER_KEYS = {
  deepseek: {
    apiKey: SETTING_KEYS.DEEPSEEK_API_KEY,
    model: SETTING_KEYS.DEEPSEEK_MODEL,
    baseUrl: SETTING_KEYS.DEEPSEEK_BASE_URL,
  },
  openai: {
    apiKey: SETTING_KEYS.OPENAI_API_KEY,
    model: SETTING_KEYS.OPENAI_MODEL,
    baseUrl: SETTING_KEYS.OPENAI_BASE_URL,
  },
} as const;

export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.settingsIntegrations);
    const s = await getSettings([
      SETTING_KEYS.DEEPSEEK_API_KEY,
      SETTING_KEYS.DEEPSEEK_MODEL,
      SETTING_KEYS.DEEPSEEK_BASE_URL,
      SETTING_KEYS.OPENAI_API_KEY,
      SETTING_KEYS.OPENAI_MODEL,
      SETTING_KEYS.OPENAI_BASE_URL,
    ]);
    return NextResponse.json({
      data: {
        deepseek: {
          api_key_masked: maskSecret(s[SETTING_KEYS.DEEPSEEK_API_KEY]),
          has_api_key: Boolean(s[SETTING_KEYS.DEEPSEEK_API_KEY]),
          model: s[SETTING_KEYS.DEEPSEEK_MODEL] || DEEPSEEK_DEFAULTS.model,
          base_url: s[SETTING_KEYS.DEEPSEEK_BASE_URL] || DEEPSEEK_DEFAULTS.baseUrl,
        },
        openai: {
          api_key_masked: maskSecret(s[SETTING_KEYS.OPENAI_API_KEY]),
          has_api_key: Boolean(s[SETTING_KEYS.OPENAI_API_KEY]),
          model: s[SETTING_KEYS.OPENAI_MODEL] || OPENAI_DEFAULTS.model,
          base_url: s[SETTING_KEYS.OPENAI_BASE_URL] || OPENAI_DEFAULTS.baseUrl,
        },
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[settings/integrations] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Terapkan {api_key, model, base_url} parsial utk satu provider.
 *  Return pesan error atau null bila valid. */
async function applyProviderConfig(
  provider: keyof typeof PROVIDER_KEYS,
  input: { api_key?: unknown; model?: unknown; base_url?: unknown }
): Promise<string | null> {
  const keys = PROVIDER_KEYS[provider];
  const { api_key, model, base_url } = input;

  if (api_key !== undefined) {
    if (api_key !== null && typeof api_key !== "string") return "api_key tidak valid";
    // string kosong = hapus key; string berisi = simpan; undefined = tidak diubah
    await setSetting(keys.apiKey, api_key ? api_key.trim() : null);
  }
  if (model !== undefined) {
    if (typeof model !== "string" || !model.trim()) return "model tidak valid";
    await setSetting(keys.model, model.trim());
  }
  if (base_url !== undefined) {
    if (typeof base_url !== "string" || !/^https?:\/\//.test(base_url.trim())) {
      return "base_url tidak valid";
    }
    await setSetting(keys.baseUrl, base_url.trim().replace(/\/+$/, ""));
  }
  return null;
}

export async function PUT(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsIntegrations);
    const body = await request.json();
    const { api_key, model, base_url, openai } = body ?? {};

    // Field flat = DeepSeek (bentuk payload lama, tetap didukung)
    const deepseekError = await applyProviderConfig("deepseek", { api_key, model, base_url });
    if (deepseekError) return NextResponse.json({ error: deepseekError }, { status: 400 });

    if (openai !== undefined) {
      if (openai === null || typeof openai !== "object") {
        return NextResponse.json({ error: "openai tidak valid" }, { status: 400 });
      }
      const openaiError = await applyProviderConfig("openai", openai);
      if (openaiError) {
        return NextResponse.json({ error: `openai: ${openaiError}` }, { status: 400 });
      }
    }

    return NextResponse.json({ message: "Konfigurasi tersimpan" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[settings/integrations] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
