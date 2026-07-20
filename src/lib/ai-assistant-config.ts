/**
 * Model AI Assistant — hanya OpenAI. Pilihan Ollama (Kimi/DeepSeek/Gemma/Qwen/
 * GLM) dihapus atas permintaan owner; id lamanya otomatis jatuh ke default lewat
 * `normalizeModel`, jadi sesi & localStorage lama tidak error.
 *
 * `supportsTemperature: false` untuk model yang menolak `temperature` selain 1 —
 * diverifikasi langsung ke API: gpt-5-mini dan gpt-5.5 mengembalikan HTTP 400
 * "Unsupported value: 'temperature' does not support 0.7 with this model",
 * sementara gpt-4o-mini, gpt-4.1-mini, gpt-4o, dan gpt-5.4-mini menerimanya.
 */
export const AI_ASSISTANT_MODELS = [
  {
    id: "openai:gpt-4o-mini",
    label: "GPT-4o mini",
    description: "Hemat dan cepat. Model yang sudah terbukti dipakai modul lain di sini.",
    logo: "4o",
    logoSrc: null,
    logoClassName: "from-emerald-200 via-teal-300 to-emerald-500 text-slate-950",
    supportsTemperature: true,
  },
  {
    id: "openai:gpt-4.1-mini",
    label: "GPT-4.1 mini",
    description: "Seimbang antara biaya dan kualitas jawaban.",
    logo: "4.1",
    logoSrc: null,
    logoClassName: "from-sky-200 via-cyan-300 to-blue-500 text-slate-950",
    supportsTemperature: true,
  },
  {
    id: "openai:gpt-4o",
    label: "GPT-4o",
    description: "Lebih kuat dari 4o mini, biayanya juga lebih tinggi.",
    logo: "4o",
    logoSrc: null,
    logoClassName: "from-violet-200 via-fuchsia-300 to-rose-400 text-slate-950",
    supportsTemperature: true,
  },
  {
    id: "openai:gpt-5.4-mini",
    label: "GPT-5.4 mini",
    description: "Generasi terbaru kelas mini.",
    logo: "5.4",
    logoSrc: null,
    logoClassName: "from-amber-200 via-orange-300 to-rose-400 text-slate-950",
    supportsTemperature: true,
  },
  {
    id: "openai:gpt-5.5",
    label: "GPT-5.5",
    description: "Model terbesar yang tersedia di akun ini. Paling mahal per jawaban.",
    logo: "5.5",
    logoSrc: null,
    logoClassName: "from-zinc-100 via-slate-300 to-zinc-500 text-slate-950",
    supportsTemperature: false,
  },
] as const;

export type AiAssistantModel = (typeof AI_ASSISTANT_MODELS)[number]["id"];

export const DEFAULT_AI_ASSISTANT_MODEL: AiAssistantModel = "openai:gpt-4o-mini";

/** Model berprefix ini dipanggil ke OpenAI, bukan Ollama. */
export const OPENAI_MODEL_PREFIX = "openai:";

export function isOpenAiAssistantModel(model: string): boolean {
  return model.startsWith(OPENAI_MODEL_PREFIX);
}

/** "openai:gpt-4o-mini" → "gpt-4o-mini" (id yang dikenal API OpenAI). */
export function stripOpenAiPrefix(model: string): string {
  return model.startsWith(OPENAI_MODEL_PREFIX)
    ? model.slice(OPENAI_MODEL_PREFIX.length)
    : model;
}

export const AI_ASSISTANT_SCOPES = [
  {
    id: "project_plus_general",
    label: "Project + General",
    description: "Data Talentpool tetap dipakai saat relevan, dan pertanyaan umum tetap dijawab.",
  },
  {
    id: "project_only",
    label: "Project Only",
    description: "Jawaban dibatasi ke data, module, dan konteks Talentpool.",
  },
  {
    id: "general",
    label: "General Chat",
    description: "Percakapan umum tanpa membawa data operasional Talentpool.",
  },
] as const;

export type AiAssistantScope = (typeof AI_ASSISTANT_SCOPES)[number]["id"];

export const DEFAULT_AI_ASSISTANT_SCOPE: AiAssistantScope = "project_plus_general";
/**
 * Versi `-v2`: pilihan model tersimpan di localStorage per browser, sehingga
 * user yang pernah membuka Arkiv OS akan terus memakai model Ollama lamanya dan
 * jatuh ke fallback meski default sudah pindah ke OpenAI. Menaikkan versi kunci
 * memaksa reset sekali ke default baru. Naikkan lagi bila default berpindah.
 */
export const AI_ASSISTANT_SETTINGS_STORAGE_KEY = "arkiv-ai-assistant-settings-v2";

export type AiAssistantSettings = {
  model: AiAssistantModel;
  scope: AiAssistantScope;
};

export const DEFAULT_AI_ASSISTANT_SETTINGS: AiAssistantSettings = {
  model: DEFAULT_AI_ASSISTANT_MODEL,
  scope: DEFAULT_AI_ASSISTANT_SCOPE,
};

export function resolveAiAssistantModel(value: unknown, fallback?: unknown): AiAssistantModel {
  const direct = normalizeModel(value);
  if (direct) return direct;

  const fallbackModel = normalizeModel(fallback);
  if (fallbackModel) return fallbackModel;

  return DEFAULT_AI_ASSISTANT_MODEL;
}

export function resolveAiAssistantScope(value: unknown, fallback?: unknown): AiAssistantScope {
  const direct = normalizeScope(value);
  if (direct) return direct;

  const fallbackScope = normalizeScope(fallback);
  if (fallbackScope) return fallbackScope;

  return DEFAULT_AI_ASSISTANT_SCOPE;
}

/** Id lama (model Ollama, atau varian yang sudah dihapus) → null → default. */
function normalizeModel(value: unknown): AiAssistantModel | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return AI_ASSISTANT_MODELS.some((model) => model.id === trimmed) ? (trimmed as AiAssistantModel) : null;
}

/** Model yang menolak temperature kustom harus dikirim tanpa field itu. */
export function modelSupportsTemperature(model: string): boolean {
  return AI_ASSISTANT_MODELS.find((m) => m.id === model)?.supportsTemperature ?? true;
}

function normalizeScope(value: unknown): AiAssistantScope | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return AI_ASSISTANT_SCOPES.some((scope) => scope.id === trimmed) ? (trimmed as AiAssistantScope) : null;
}
