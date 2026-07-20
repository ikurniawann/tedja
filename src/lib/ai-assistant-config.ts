export const AI_ASSISTANT_MODELS = [
  {
    // Prefix `openai:` menandai model yang dilayani langsung oleh OpenAI,
    // bukan lewat Ollama. Sisanya tetap melalui Ollama seperti sebelumnya.
    id: "openai:gpt-4o-mini",
    label: "OpenAI GPT-4o mini",
    logo: "AI",
    logoSrc: null,
    logoClassName: "from-emerald-200 via-teal-300 to-emerald-500 text-slate-950",
  },
  {
    id: "kimi-k2.5:cloud",
    label: "Kimi K2.5 Cloud",
    logo: "K",
    logoSrc: "/logollm/kimi.png",
    logoClassName: "from-violet-300 via-fuchsia-400 to-rose-400 text-slate-950",
  },
  {
    id: "deepseek-v4-flash:cloud",
    label: "DeepSeek V4 Flash",
    logo: "DS",
    logoSrc: "/logollm/deepseek.png",
    logoClassName: "from-sky-300 via-cyan-300 to-blue-500 text-slate-950",
  },
  {
    id: "gemma4:e2b",
    label: "Gemma 4 E2B",
    logo: "G",
    logoSrc: "/logollm/gemma4.png",
    logoClassName: "from-blue-300 via-emerald-300 to-yellow-300 text-slate-950",
  },
  {
    id: "qwen3.5:cloud",
    label: "Qwen 3.5 Cloud",
    logo: "Q",
    logoSrc: "/logollm/qwen.png",
    logoClassName: "from-cyan-200 via-blue-400 to-indigo-500 text-white",
  },
  {
    id: "glm-5:cloud",
    label: "GLM 5 Cloud",
    logo: "GLM",
    logoSrc: "/logollm/glm.png",
    logoClassName: "from-zinc-100 via-slate-300 to-zinc-500 text-slate-950",
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

function normalizeModel(value: unknown): AiAssistantModel | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "gemma4:31b-cloud") return "gemma4:e2b";
  return AI_ASSISTANT_MODELS.some((model) => model.id === trimmed) ? (trimmed as AiAssistantModel) : null;
}

function normalizeScope(value: unknown): AiAssistantScope | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return AI_ASSISTANT_SCOPES.some((scope) => scope.id === trimmed) ? (trimmed as AiAssistantScope) : null;
}
