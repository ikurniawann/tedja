import { query, queryOne } from "@/lib/db";

/**
 * Key-value app settings di configuration.app_settings.
 * Dipakai untuk konfigurasi integrasi yang bisa diubah dari dashboard
 * (mis. DeepSeek API key untuk analisis CV).
 */

export const SETTING_KEYS = {
  DEEPSEEK_API_KEY: "deepseek_api_key",
  DEEPSEEK_MODEL: "deepseek_model",
  DEEPSEEK_BASE_URL: "deepseek_base_url",
  OPENAI_API_KEY: "openai_api_key",
  OPENAI_MODEL: "openai_model",
  OPENAI_BASE_URL: "openai_base_url",
  // Profil legal perusahaan — dipakai dokumen kontrak kerja (PIHAK PERTAMA).
  // Kosong = dirender sebagai garis isian di PDF.
  COMPANY_LEGAL_NAME: "company_legal_name",
  COMPANY_ADDRESS: "company_address",
  COMPANY_CITY: "company_city",
  COMPANY_SIGNER_NAME: "company_signer_name",
  COMPANY_SIGNER_TITLE: "company_signer_title",
} as const;

export const DEEPSEEK_DEFAULTS = {
  model: "deepseek-chat",
  baseUrl: "https://api.deepseek.com",
};

/** OpenAI dipakai utk kemampuan vision (mis. deskripsi gambar psikotes) —
 *  DeepSeek text-only, jadi bagian "melihat gambar" dialihkan ke sini. */
export const OPENAI_DEFAULTS = {
  model: "gpt-4o-mini",
  baseUrl: "https://api.openai.com/v1",
};

export async function getSetting(key: string): Promise<string | null> {
  const row = await queryOne<{ value: string | null }>(
    "SELECT value FROM configuration.app_settings WHERE key = $1",
    [key]
  );
  return row?.value ?? null;
}

export async function getSettings(keys: string[]): Promise<Record<string, string | null>> {
  const rows = await query<{ key: string; value: string | null }>(
    "SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)",
    [keys]
  );
  const map: Record<string, string | null> = {};
  for (const k of keys) map[k] = null;
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  await query(
    `INSERT INTO configuration.app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
}

/** Masker untuk menampilkan API key tanpa membocorkan isinya. */
export function maskSecret(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}
