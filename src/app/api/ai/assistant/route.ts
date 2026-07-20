import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  type AiAssistantModel,
  type AiAssistantScope,
  isOpenAiAssistantModel,
  resolveAiAssistantModel,
  resolveAiAssistantScope,
  stripOpenAiPrefix,
} from "@/lib/ai-assistant-config";
import { SETTING_KEYS, getSettings } from "@/lib/settings/app-settings";
import { appendFile, mkdir } from "fs/promises";
import path from "path";

type ChatMessage = { role: "user" | "assistant"; content: string };
type Intent = "all" | "hris" | "procurement" | "pos" | "inventory" | "performance" | "payroll" | "integration" | "master";
type DetailRow = Record<string, unknown>;
type DbQueryResult = { data?: unknown[] | null; error?: unknown; count?: number | null };
type DbQuery = PromiseLike<DbQueryResult> & {
  eq(column: string, value: unknown): DbQuery;
  gte(column: string, value: unknown): DbQuery;
  lt(column: string, value: unknown): DbQuery;
  in(column: string, values: readonly unknown[]): DbQuery;
  order(column: string, options?: { ascending?: boolean }): DbQuery;
  limit(count: number): DbQuery;
  select(columns?: string): DbQuery;
  single(): PromiseLike<{ data?: Record<string, unknown> | null; error?: unknown }>;
};
type DbAdmin = {
  from(table: string): {
    select(columns?: string, options?: Record<string, unknown>): DbQuery;
    insert(values: unknown): DbQuery;
    update(values: unknown): DbQuery;
    delete(): DbQuery;
  };
};
type LlmResult = {
  answer: string;
  mode: string;
  model: string;
  status: "live" | "fallback";
  provider?: "ollama" | "openai" | "internal";
  fallbackReason?: string;
  error?: string;
};
type Summary = {
  generatedAt: string;
  hris: Record<string, number>;
  performance: Record<string, number>;
  payroll: Record<string, number>;
  procurement: Record<string, number>;
  pos: Record<string, number>;
  inventory: Record<string, number>;
  master: Record<string, number>;
  integration: Record<string, number>;
  modules: Record<string, { label: string; metrics: Record<string, number> }>;
  details: Partial<Record<Intent, DetailRow[]>>;
};

export async function GET(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("session_id");
    const list = searchParams.get("list") === "true";

    const admin = createPgClient();

    if (list || !sessionId) {
      const { data: sessions, error } = await admin
        .from("ai_assistant_sessions")
        .select("id, title, created_at, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return NextResponse.json({ sessions: sessions ?? [] });
    }

    // Verify the session belongs to the requesting user before returning its
    // messages — admin client bypasses RLS, so ownership must be checked here.
    const { data: ownedSession } = await admin
      .from("ai_assistant_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .single();
    if (!ownedSession) {
      return NextResponse.json({ error: "Session tidak ditemukan" }, { status: 404 });
    }

    const { data: messages, error } = await admin
      .from("ai_assistant_messages")
      .select("id, role, content, meta, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ messages: messages ?? [] });
  } catch (error) {
    console.error("AI assistant GET error:", error);
    return NextResponse.json({ error: "Gagal memuat history" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const {
      data: { user },
    } = await db.auth.getUser();

    if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("session_id");
    if (!sessionId) return NextResponse.json({ error: "session_id required" }, { status: 400 });

    const admin = createPgClient();

    const { error } = await admin
      .from("ai_assistant_sessions")
      .delete()
      .eq("id", sessionId)
      .eq("user_id", user.id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("AI assistant DELETE error:", error);
    return NextResponse.json({ error: "Gagal menghapus session" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let prompt = "";
  let intent: Intent = "all";

  try {
    const body = (await request.json()) as {
      message?: string;
      history?: ChatMessage[];
      session_id?: string;
      model?: string;
      scope?: string;
    };
    prompt = body.message ?? "Summary semua module";
    let sessionId = body.session_id;
    const history = (body.history ?? []).slice(-8);
    const model = resolveAiAssistantModel(body.model, process.env.OLLAMA_MODEL);
    const scope = resolveAiAssistantScope(body.scope);
    const includeProjectData = scope !== "general";

    const db = await createServerPgClient();
    const {
      data: { user },
    } = await db.auth.getUser();

    if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });

    const { data: profile } = await db
      .from("users")
      .select("role, full_name")
      .eq("id", user.id)
      .single();

    const admin = createPgClient();

    intent = includeProjectData ? detectIntent(prompt) : "all";
    const summary = includeProjectData
      ? await buildSystemSummary(admin as unknown as DbAdmin, intent)
      : createEmptySystemSummary();
    const fallbackAnswer = includeProjectData
      ? generateSummaryAnswer(prompt, summary, profile?.full_name ?? user.email ?? "User", intent)
      : "AI Assistant belum bisa menghubungi model yang dipilih saat ini. Coba lagi sebentar atau pilih model lain di Arkiv OS Settings.";

    // Create session if none exists (first user message in a fresh chat)
    if (!sessionId) {
      const { data: newSession, error: se } = await admin
        .from("ai_assistant_sessions")
        .insert({ user_id: user.id, title: prompt.slice(0, 120) })
        .select("id")
        .single();
      if (!se && typeof newSession?.id === "string") sessionId = newSession.id;
    } else {
      // Update session timestamp on activity — scope to the owner so one user
      // cannot touch another user's session by passing a stolen session_id.
      await admin
        .from("ai_assistant_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", sessionId)
        .eq("user_id", user.id);
    }

    const persistedHistory = sessionId ? await loadSessionHistory(admin as unknown as DbAdmin, sessionId) : [];
    const mergedHistory = compactChatHistory([...persistedHistory, ...history]);

    const llmResult = await generateWithOllama({
      message: prompt,
      history: mergedHistory,
      summary,
      fallbackAnswer,
      userName: profile?.full_name ?? user.email ?? "User",
      intent,
      scope,
      model,
    });

    // Persist messages
    if (sessionId) {
      const rows: { session_id: string; role: string; content: string; meta?: unknown }[] = [
        { session_id: sessionId, role: "user", content: prompt },
        {
          session_id: sessionId,
          role: "assistant",
          content: llmResult.answer,
          meta: { mode: llmResult.mode, model: llmResult.model, status: llmResult.status, intent, scope },
        },
      ];
      await admin.from("ai_assistant_messages").insert(rows);
    }

    await appendAssistantMarkdown({
      userId: user.id,
      userEmail: user.email ?? "unknown",
      userName: profile?.full_name ?? user.email ?? "User",
      sessionId,
      prompt,
      answer: llmResult.answer,
      model: llmResult.model,
      scope,
    });

    await auditAiRequest(admin as unknown as DbAdmin, {
      user_id: user.id,
      user_email: user.email,
      prompt,
      intent,
      mode: llmResult.mode,
      model: llmResult.model,
      latency_ms: Date.now() - startedAt,
      error: llmResult.error,
    });

    return NextResponse.json({
      answer: llmResult.answer,
      summary,
      session_id: sessionId,
      meta: {
        mode: llmResult.mode,
        model: llmResult.model,
        intent,
        scope,
        status: llmResult.status,
        fallbackReason: llmResult.fallbackReason,
        user: user.email,
      },
    });
  } catch (error) {
    console.error("AI assistant error:", error);
    return NextResponse.json({ error: "Gagal memproses AI Assistant" }, { status: 500 });
  }
}

function detectIntent(message: string): Intent {
  const lower = message.toLowerCase();
  if (lower.includes("kpi") || lower.includes("performance") || lower.includes("review") || lower.includes("penilaian")) return "performance";
  if (lower.includes("payroll") || lower.includes("gaji") || lower.includes("salary") || lower.includes("benefit") || lower.includes("loan")) return "payroll";
  if (lower.includes("integration") || lower.includes("integrasi") || lower.includes("webhook") || lower.includes("api") || lower.includes("ai assistant")) return "integration";
  if (lower.includes("master") || lower.includes("department") || lower.includes("departemen") || lower.includes("position") || lower.includes("jabatan")) return "master";
  if (lower.includes("hr") || lower.includes("kandidat") || lower.includes("candidate") || lower.includes("employee") || lower.includes("karyawan") || lower.includes("attendance") || lower.includes("absen") || lower.includes("leave") || lower.includes("cuti")) return "hris";
  if (lower.includes("procurement") || lower.includes("purchasing") || lower.includes("po") || lower.includes("pr") || lower.includes("supplier")) return "procurement";
  if (lower.includes("pos") || lower.includes("sales") || lower.includes("order") || lower.includes("reservasi")) return "pos";
  if (lower.includes("stock") || lower.includes("stok") || lower.includes("inventory") || lower.includes("bahan")) return "inventory";
  return "all";
}

function compactChatHistory(history: ChatMessage[]): ChatMessage[] {
  const compacted: ChatMessage[] = [];
  let budget = 5000;

  for (const item of history.slice(-12).reverse()) {
    const maxLength = item.role === "assistant" ? 900 : 700;
    const content = item.content.replace(/\s+/g, " ").trim().slice(0, maxLength);
    if (!content) continue;

    budget -= content.length;
    if (budget < 0) break;
    compacted.push({ role: item.role, content });
  }

  return compacted.reverse();
}

async function safeCount(
  admin: DbAdmin,
  table: string,
  filter?: (query: DbQuery) => DbQuery,
): Promise<number> {
  try {
    let query = admin.from(table).select("id", { count: "exact", head: true }) as unknown as DbQuery;
    if (filter) query = filter(query);
    const { count, error } = await query;
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function safeRows(
  admin: DbAdmin,
  table: string,
  columns: string,
  options?: {
    filter?: (query: DbQuery) => DbQuery;
    order?: { column: string; ascending?: boolean };
    limit?: number;
  },
): Promise<DetailRow[]> {
  try {
    let query = admin.from(table).select(columns) as unknown as DbQuery;
    if (options?.filter) query = options.filter(query);
    if (options?.order) query = query.order(options.order.column, { ascending: options.order.ascending ?? false });
    if (options?.limit) query = query.limit(options.limit);
    const { data, error } = await query;
    if (error || !data) return [];
    return data as DetailRow[];
  } catch {
    return [];
  }
}

async function buildSystemSummary(admin: DbAdmin, intent: Intent): Promise<Summary> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const [
    candidatesTotal,
    candidatesToday,
    candidatesNew,
    employeesTotal,
    attendanceToday,
    leavesTotal,
    jobOpeningsTotal,
    performanceReviewsTotal,
    employeeKpisTotal,
    kpiTemplatesTotal,
    developmentPlansTotal,
    payrollRunsTotal,
    payrollDetailsTotal,
    employeeSalaryTotal,
    benefitsTotal,
    loansTotal,
    purchaseRequestsTotal,
    purchaseOrdersTotal,
    purchaseOrdersPending,
    suppliersTotal,
    rawMaterialsTotal,
    inventoryItems,
    lowStockItems,
    inventoryMovementsTotal,
    productsTotal,
    posOrdersTotal,
    posReservationsTotal,
    posCustomersTotal,
    posShiftsTotal,
    departmentsTotal,
    positionsTotal,
    employmentStatusesTotal,
    usersTotal,
    notificationsTotal,
    aiAssistantLogsTotal,
  ] = await Promise.all([
    safeCount(admin, "candidates"),
    safeCount(admin, "candidates", (q) => q.gte("created_at", todayIso)),
    safeCount(admin, "candidates", (q) => q.eq("status", "applied")),
    safeCount(admin, "employees"),
    safeCount(admin, "attendance", (q) => q.gte("created_at", todayIso)),
    safeCount(admin, "leaves"),
    safeCount(admin, "job_openings"),
    safeCount(admin, "performance_reviews"),
    safeCount(admin, "employee_kpis"),
    safeCount(admin, "kpi_templates"),
    safeCount(admin, "development_plans"),
    safeCount(admin, "payroll_runs"),
    safeCount(admin, "payroll_details"),
    safeCount(admin, "employee_salary"),
    safeCount(admin, "benefits"),
    safeCount(admin, "loans"),
    safeCount(admin, "purchase_requests"),
    safeCount(admin, "purchase_orders"),
    safeCount(admin, "purchase_orders", (q) => q.in("status", ["draft", "pending", "pending_approval", "sent", "pending_head", "pending_finance", "pending_direksi"])),
    safeCount(admin, "suppliers"),
    safeCount(admin, "raw_materials"),
    safeCount(admin, "inventory"),
    safeCount(admin, "inventory", (q) => q.lt("current_stock", 1)),
    safeCount(admin, "inventory_movements"),
    safeCount(admin, "products"),
    safeCount(admin, "pos_orders"),
    safeCount(admin, "pos_reservations"),
    safeCount(admin, "pos_customers"),
    safeCount(admin, "pos_shifts"),
    safeCount(admin, "departments"),
    safeCount(admin, "positions"),
    safeCount(admin, "employment_statuses"),
    safeCount(admin, "users"),
    safeCount(admin, "notifications"),
    safeCount(admin, "ai_assistant_logs"),
  ]);

  const details: Summary["details"] = {};
  if (intent === "all" || intent === "hris") {
    details.hris = await safeRows(admin, "candidates", "id, full_name, status, source, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "performance") {
    details.performance = await safeRows(admin, "performance_reviews", "id, period_label, status, grand_total_score, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "payroll") {
    details.payroll = await safeRows(admin, "payroll_runs", "id, period_start, period_end, status, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "procurement") {
    details.procurement = await safeRows(admin, "purchase_orders", "id, po_number, status, total_amount, created_at", {
      filter: (q) => q.in("status", ["draft", "pending", "pending_approval", "sent", "pending_head", "pending_finance", "pending_direksi"]),
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "inventory") {
    details.inventory = await safeRows(admin, "inventory", "id, current_stock, minimum_stock, raw_material_id, updated_at", {
      filter: (q) => q.lt("current_stock", 1),
      order: { column: "updated_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "pos") {
    details.pos = await safeRows(admin, "pos_orders", "id, order_number, status, total_amount, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "integration") {
    details.integration = await safeRows(admin, "ai_assistant_logs", "id, user_email, intent, model, latency_ms, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "master") {
    details.master = await safeRows(admin, "departments", "id, name, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }

  const hris = { candidatesTotal, candidatesToday, candidatesNew, employeesTotal, attendanceToday, leavesTotal, jobOpeningsTotal };
  const performance = { performanceReviewsTotal, employeeKpisTotal, kpiTemplatesTotal, developmentPlansTotal };
  const payroll = { payrollRunsTotal, payrollDetailsTotal, employeeSalaryTotal, benefitsTotal, loansTotal };
  const procurement = { purchaseRequestsTotal, purchaseOrdersTotal, purchaseOrdersPending, suppliersTotal, rawMaterialsTotal };
  const inventory = { inventoryItems, lowStockItems, inventoryMovementsTotal, productsTotal };
  const pos = { posOrdersTotal, posReservationsTotal, posCustomersTotal, posShiftsTotal };
  const master = { departmentsTotal, positionsTotal, employmentStatusesTotal, usersTotal };
  const integration = { notificationsTotal, aiAssistantLogsTotal };

  return {
    generatedAt: new Date().toISOString(),
    hris,
    performance,
    payroll,
    procurement,
    pos,
    inventory,
    master,
    integration,
    modules: {
      hris: { label: "HRIS", metrics: hris },
      performance: { label: "Performance", metrics: performance },
      payroll: { label: "Payroll", metrics: payroll },
      procurement: { label: "Procurement", metrics: procurement },
      inventory: { label: "Inventory", metrics: inventory },
      pos: { label: "POS", metrics: pos },
      master: { label: "Master Data", metrics: master },
      integration: { label: "Integration", metrics: integration },
    },
    details,
  };
}

function createEmptySystemSummary(): Summary {
  const empty: Record<string, number> = {};
  return {
    generatedAt: new Date().toISOString(),
    hris: empty,
    performance: empty,
    payroll: empty,
    procurement: empty,
    pos: empty,
    inventory: empty,
    master: empty,
    integration: empty,
    modules: {},
    details: {},
  };
}

/**
 * Panggil OpenAI Chat Completions untuk model berprefix `openai:`.
 *
 * Sumber kredensial berurutan: env `OPENAI_API_KEY` lebih dulu (praktis untuk
 * override per-deployment), lalu setting `openai_api_key` di database — tempat
 * key OpenAI proyek ini sebenarnya tinggal, diatur lewat Settings → Integrasi.
 */
async function callOpenAiChat(
  model: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const s = await getSettings([SETTING_KEYS.OPENAI_API_KEY, SETTING_KEYS.OPENAI_BASE_URL]);
  const apiKey = process.env.OPENAI_API_KEY?.trim() || s[SETTING_KEYS.OPENAI_API_KEY];
  if (!apiKey) {
    throw new Error(
      "API key OpenAI belum tersedia (env OPENAI_API_KEY maupun Settings → Integrasi kosong)"
    );
  }
  const baseUrl = (s[SETTING_KEYS.OPENAI_BASE_URL] || "https://api.openai.com/v1").replace(/\/$/, "");
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT || "120000");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: stripOpenAiPrefix(model), temperature: 0.7, messages }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const answer = normalizePlainTextAnswer(json.choices?.[0]?.message?.content);
  if (!answer) throw new Error("OpenAI mengembalikan jawaban kosong");
  return answer;
}

async function generateWithOllama({
  message,
  history,
  summary,
  fallbackAnswer,
  userName,
  intent,
  scope,
  model,
}: {
  message: string;
  history: ChatMessage[];
  summary: Summary;
  fallbackAnswer: string;
  userName: string;
  intent: Intent;
  scope: AiAssistantScope;
  model: AiAssistantModel;
}): Promise<LlmResult> {
  const useOpenAi = isOpenAiAssistantModel(model);
  const baseUrl = (process.env.AI_ASSISTANT_OLLAMA_API_BASE || "http://127.0.0.1:11434")
    .trim()
    .replace(/^http:\/\/localhost(?=:|\/|$)/, "http://127.0.0.1")
    .replace(/\/$/, "");
  const apiKey = process.env.OLLAMA_API_KEY?.trim();
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT || "120000");
  const includeProjectData = scope !== "general";
  const scopeInstruction = buildScopeInstruction(scope);

  const systemPrompt = [
    "Kamu adalah Arkiv OS AI Assistant untuk semua user Arkiv OS.",
    scopeInstruction,
    "Jawab dalam Bahasa Indonesia yang ramah, jelas, natural, dan actionable.",
    "Gunakan bahasa awam seperti asisten operasional, bukan bahasa developer.",
    "Jangan menyebut JSON, API, query, schema, database, payload, object, array, model, prompt, system, atau istilah teknis internal kecuali user secara eksplisit meminta penjelasan teknis.",
    "Jika user bertanya data bisnis Arkiv OS, gunakan data internal yang tersedia dan jangan mengarang angka.",
    "Jika data yang diperlukan tidak tersedia, cukup katakan data tersebut belum tersedia di sistem dan sarankan module atau filter yang perlu dibuka.",
    "Jika menjawab angka atau ringkasan, jelaskan artinya dalam konteks bisnis secara singkat.",
    "Ingat konteks percakapan dari history yang diberikan.",
    "Gunakan teks polos saja. Jangan gunakan markdown untuk bold, italic, heading, blockquote, atau tabel.",
  ].join(" ");
  const userPrompt = [
    `Nama user: ${userName}`,
    `Mode konteks: ${scope}`,
    `Model: ${model}`,
    `Intent terdeteksi: ${intent}`,
    `Pertanyaan user: ${message}`,
    includeProjectData ? `\nKonteks internal Arkiv OS yang tersedia jika relevan:\n${JSON.stringify(summary, null, 2)}` : "\nKonteks operasional Arkiv OS tidak dikirim untuk mode General Chat.",
  ].join("\n");
  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    { role: "user", content: userPrompt },
  ];

  const errors: string[] = [];

  // Model berprefix `openai:` dilayani langsung oleh OpenAI. Ollama tidak
  // disentuh sama sekali di jalur ini — termasuk fallback-nya, karena kegagalan
  // OpenAI lebih berguna dilaporkan apa adanya daripada disamarkan jadi
  // "Ollama tidak tersedia".
  if (useOpenAi) {
    try {
      const answer = await callOpenAiChat(model, messages);
      return { answer, mode: "openai_chat_completions_live", model, provider: "openai", status: "live" };
    } catch (error) {
      const detail = formatProviderError(error, "openai");
      console.warn("AI assistant OpenAI fallback:", detail);
      return {
        answer: fallbackAnswer,
        mode: "openai_unavailable_fallback",
        model,
        provider: "internal",
        status: "fallback",
        fallbackReason: "OpenAI sedang tidak tersedia. Saya memakai fallback internal sementara.",
        error: detail,
      };
    }
  }

  if (!baseUrl) {
    return {
      answer: fallbackAnswer,
      mode: "rule_based_summary_v1",
      model: "none",
      provider: "internal",
      status: "fallback",
      fallbackReason: "OLLAMA_API_BASE belum dikonfigurasi",
    };
  }

  const headers = buildOllamaHeaders(baseUrl, apiKey);
  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, stream: false, options: { temperature: 0.7, num_ctx: 4096, num_gpu: 1 }, messages }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`/api/chat ${response.status}: ${await response.text()}`);
    const json = await response.json() as { message?: { content?: string }; response?: string };
    const answer = normalizePlainTextAnswer(json.message?.content || json.response);
    if (!answer) throw new Error("/api/chat response kosong");
    return { answer, mode: "ollama_api_chat_live", model, provider: "ollama", status: "live" };
  } catch (error) {
    errors.push(formatProviderError(error, "/api/chat"));
  }

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, temperature: 0.7, messages }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`/v1/chat/completions ${response.status}: ${await response.text()}`);
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const answer = normalizePlainTextAnswer(json.choices?.[0]?.message?.content);
    if (!answer) throw new Error("/v1/chat/completions response kosong");
    return { answer, mode: "ollama_chat_completions_live", model, provider: "ollama", status: "live" };
  } catch (error) {
    errors.push(formatProviderError(error, "/v1"));
  }

  console.warn("AI assistant Ollama fallback:", errors.join(" | "));

  return {
    answer: fallbackAnswer,
    mode: "ollama_unavailable_fallback",
    model,
    provider: "internal",
    status: "fallback",
    fallbackReason: "Ollama sedang tidak tersedia. Saya memakai fallback internal sementara.",
    error: errors.join(" | "),
  };
}

function buildScopeInstruction(scope: AiAssistantScope): string {
  if (scope === "project_only") {
    return [
      "Mode Project Only aktif.",
      "Jawab hanya berdasarkan konteks Talentpool/Arkiv OS, history percakapan, dan data internal yang diberikan.",
      "Jika user bertanya pengetahuan umum atau hal di luar project, jelaskan singkat bahwa mode Project Only sedang aktif dan minta user mengganti mode di Arkiv OS Settings.",
    ].join(" ");
  }

  if (scope === "general") {
    return [
      "Mode General Chat aktif.",
      "Jawab seperti assistant umum dengan knowledge model.",
      "Jangan mengklaim sedang membaca data operasional Talentpool karena data project tidak dikirim pada mode ini.",
    ].join(" ");
  }

  return [
    "Mode Project + General aktif.",
    "Untuk pertanyaan operasional Talentpool/Arkiv OS, prioritaskan data internal yang diberikan.",
    "Untuk ide, strategi, copywriting, SOP, analisis, coding, dan pertanyaan umum, jawab bebas dengan knowledge model tanpa memaksa data dashboard.",
  ].join(" ");
}

function normalizePlainTextAnswer(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/^\s*>\s?/gm, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .trim();
}

function buildOllamaHeaders(baseUrl: string, apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(baseUrl);
  if (apiKey && !isLocal) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function formatProviderError(error: unknown, endpoint: string): string {
  if (!(error instanceof Error)) return `${endpoint}: unknown error`;
  const cause = error.cause as { code?: string; address?: string; port?: number; message?: string } | undefined;
  const causeText = cause ? ` cause=${JSON.stringify({ code: cause.code, address: cause.address, port: cause.port, message: cause.message })}` : "";
  return `${endpoint}: ${error.name}: ${error.message}${causeText}`;
}

async function loadSessionHistory(admin: DbAdmin, sessionId: string): Promise<ChatMessage[]> {
  try {
    const { data } = await admin
      .from("ai_assistant_messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true })
      .limit(40);
    return ((data ?? []) as Array<{ role?: string; content?: unknown }>)
      .filter((item): item is ChatMessage => (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
      .map((item) => ({ role: item.role, content: item.content }));
  } catch {
    return [];
  }
}

async function appendAssistantMarkdown(payload: {
  userId: string;
  userEmail: string;
  userName: string;
  sessionId?: string;
  prompt: string;
  answer: string;
  model: string;
  scope: AiAssistantScope;
}) {
  if (process.env.VERCEL === "1") return;

  try {
    const logsDir = path.join(process.cwd(), "assistant-memory");
    await mkdir(logsDir, { recursive: true });
    const safeUser = payload.userEmail.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = path.join(logsDir, `${safeUser}.assistant.md`);
    const block = [
      `\n\n---`,
      `date: ${new Date().toISOString()}`,
      `user: ${payload.userName} <${payload.userEmail}>`,
      `user_id: ${payload.userId}`,
      `session_id: ${payload.sessionId ?? "none"}`,
      `model: ${payload.model}`,
      `scope: ${payload.scope}`,
      `\n## User`,
      payload.prompt,
      `\n## Assistant`,
      payload.answer,
    ].join("\n");
    await appendFile(filePath, block, "utf8");
  } catch (error) {
    console.warn("assistant.md write skipped:", error instanceof Error ? error.message : error);
  }
}

async function auditAiRequest(admin: DbAdmin, payload: Record<string, unknown>) {
  try {
    await admin.from("ai_assistant_logs").insert(payload);
  } catch (error) {
    console.warn("AI audit log skipped:", error instanceof Error ? error.message : error);
  }
}

function generateSummaryAnswer(message: string, summary: Summary, name: string, intent: Intent): string {
  const lower = message.toLowerCase();
  const sections: string[] = [];
  const includeAll = intent === "all" || !lower || lower.includes("semua") || lower.includes("summary") || lower.includes("ringkas") || lower.includes("overview");

  if (includeAll) {
    sections.push(`Halo ${name}, berikut ringkasan Arkiv OS saat ini:`);
    sections.push(formatHris(summary));
    sections.push(formatPerformance(summary));
    sections.push(formatPayroll(summary));
    sections.push(formatProcurement(summary));
    sections.push(formatInventory(summary));
    sections.push(formatPos(summary));
    sections.push(formatMaster(summary));
    sections.push(formatIntegration(summary));
    sections.push(formatDetails(summary));
    sections.push("Prioritas: cek kandidat baru, review performance, PO pending, inventory low stock, dan aktivitas POS terbaru.");
    return sections.filter(Boolean).join("\n\n");
  }

  if (intent === "hris") return [formatHris(summary), formatDetails(summary, "hris")].filter(Boolean).join("\n\n");
  if (intent === "performance") return [formatPerformance(summary), formatDetails(summary, "performance")].filter(Boolean).join("\n\n");
  if (intent === "payroll") return [formatPayroll(summary), formatDetails(summary, "payroll")].filter(Boolean).join("\n\n");
  if (intent === "procurement") return [formatProcurement(summary), formatDetails(summary, "procurement")].filter(Boolean).join("\n\n");
  if (intent === "pos") return [formatPos(summary), formatDetails(summary, "pos")].filter(Boolean).join("\n\n");
  if (intent === "inventory") return [formatInventory(summary), formatDetails(summary, "inventory")].filter(Boolean).join("\n\n");
  if (intent === "master") return [formatMaster(summary), formatDetails(summary, "master")].filter(Boolean).join("\n\n");
  if (intent === "integration") return [formatIntegration(summary), formatDetails(summary, "integration")].filter(Boolean).join("\n\n");

  return [
    formatHris(summary),
    formatPerformance(summary),
    formatPayroll(summary),
    formatProcurement(summary),
    formatInventory(summary),
    formatPos(summary),
    formatMaster(summary),
    formatIntegration(summary),
  ].join("\n\n");
}

function formatHris(summary: Summary) {
  return `HRIS: ${summary.hris.candidatesTotal ?? 0} total kandidat, ${summary.hris.candidatesToday ?? 0} kandidat masuk hari ini, ${summary.hris.candidatesNew ?? 0} kandidat status new, ${summary.hris.employeesTotal ?? 0} karyawan, ${summary.hris.attendanceToday ?? 0} attendance hari ini, ${summary.hris.leavesTotal ?? 0} leave request, ${summary.hris.jobOpeningsTotal ?? 0} job opening.`;
}

function formatPerformance(summary: Summary) {
  return `Performance: ${summary.performance.performanceReviewsTotal ?? 0} review, ${summary.performance.employeeKpisTotal ?? 0} employee KPI, ${summary.performance.kpiTemplatesTotal ?? 0} template KPI, ${summary.performance.developmentPlansTotal ?? 0} development plan.`;
}

function formatPayroll(summary: Summary) {
  return `Payroll: ${summary.payroll.payrollRunsTotal ?? 0} payroll run, ${summary.payroll.payrollDetailsTotal ?? 0} payroll detail, ${summary.payroll.employeeSalaryTotal ?? 0} salary record, ${summary.payroll.benefitsTotal ?? 0} benefit, ${summary.payroll.loansTotal ?? 0} loan.`;
}

function formatProcurement(summary: Summary) {
  return `Procurement: ${summary.procurement.purchaseRequestsTotal ?? 0} PR, ${summary.procurement.purchaseOrdersTotal ?? 0} PO, ${summary.procurement.purchaseOrdersPending ?? 0} PO perlu perhatian, ${summary.procurement.suppliersTotal ?? 0} supplier, ${summary.procurement.rawMaterialsTotal ?? 0} raw material.`;
}

function formatPos(summary: Summary) {
  return `POS: ${summary.pos.posOrdersTotal ?? 0} order, ${summary.pos.posReservationsTotal ?? 0} reservasi, ${summary.pos.posCustomersTotal ?? 0} customer, ${summary.pos.posShiftsTotal ?? 0} shift.`;
}

function formatInventory(summary: Summary) {
  return `Inventory: ${summary.inventory.inventoryItems ?? 0} item inventory, ${summary.inventory.lowStockItems ?? 0} item low/empty stock, ${summary.inventory.inventoryMovementsTotal ?? 0} movement, ${summary.inventory.productsTotal ?? 0} product.`;
}

function formatMaster(summary: Summary) {
  return `Master Data: ${summary.master.departmentsTotal ?? 0} department, ${summary.master.positionsTotal ?? 0} position, ${summary.master.employmentStatusesTotal ?? 0} employment status, ${summary.master.usersTotal ?? 0} user.`;
}

function formatIntegration(summary: Summary) {
  return `Integration: ${summary.integration.notificationsTotal ?? 0} notification, ${summary.integration.aiAssistantLogsTotal ?? 0} AI assistant log.`;
}

function formatDetails(summary: Summary, only?: Intent) {
  const lines: string[] = [];
  const add = (label: string, rows?: DetailRow[]) => {
    if (!rows?.length) return;
    lines.push(`${label}: ${rows.slice(0, 5).map((row) => Object.values(row).filter(Boolean).slice(0, 4).join(" | ")).join("; ")}`);
  };
  if (!only || only === "hris") add("Kandidat terbaru", summary.details.hris);
  if (!only || only === "performance") add("Performance review terbaru", summary.details.performance);
  if (!only || only === "payroll") add("Payroll run terbaru", summary.details.payroll);
  if (!only || only === "procurement") add("PO pending terbaru", summary.details.procurement);
  if (!only || only === "inventory") add("Inventory low stock", summary.details.inventory);
  if (!only || only === "pos") add("POS order terbaru", summary.details.pos);
  if (!only || only === "master") add("Master data terbaru", summary.details.master);
  if (!only || only === "integration") add("AI assistant activity", summary.details.integration);
  return lines.join("\n");
}
