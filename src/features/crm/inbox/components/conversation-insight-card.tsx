"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

/**
 * EPIC-029 — ringkasan AI satu percakapan di panel chat.
 *
 * Hanya MEMBACA cache saat percakapan dibuka (tidak memanggil OpenAI otomatis);
 * analisa baru dijalankan hanya ketika agent menekan tombolnya, supaya membuka
 * inbox tidak menagih token diam-diam.
 */

type Insight = {
  summary: string;
  topic: string;
  sentiment: "positif" | "netral" | "negatif";
  is_complaint: boolean;
  keywords: string[];
  analyzed_at?: string | null;
};

const SENTIMENT_LABEL: Record<Insight["sentiment"], string> = {
  positif: "Positif",
  netral: "Netral",
  negatif: "Negatif",
};

const SENTIMENT_STYLE: Record<Insight["sentiment"], string> = {
  positif: "border-emerald-200 bg-emerald-50 text-emerald-700",
  netral: "border-slate-200 bg-slate-50 text-slate-600",
  negatif: "border-rose-200 bg-rose-50 text-rose-700",
};

export function ConversationInsightCard({ conversationId }: { conversationId: string }) {
  const [insight, setInsight] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/crm/inbox/analytics?conversation_id=${encodeURIComponent(conversationId)}`,
        { cache: "no-store" }
      );
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Gagal memuat ringkasan");
      setInsight((json.data.insight as Insight | null) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat ringkasan");
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    setInsight(null);
    void muat();
  }, [muat]);

  async function ringkas() {
    setAnalyzing(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/crm/inbox/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // force: analisa ulang walau cache masih sah — tombol ini ditekan justru
        // ketika agent ingin ringkasan yang terbaru.
        body: JSON.stringify({ conversation_id: conversationId, force: true }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.data?.error || json.error || "Gagal meringkas percakapan");
      }
      if (json.data.status === "empty") {
        setNotice("Percakapan ini belum punya pesan teks untuk diringkas.");
      }
      setInsight((json.data.insight as Insight | null) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal meringkas percakapan");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="border-b border-slate-200 bg-violet-50/40 px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-800">
          <Sparkles className="size-3.5" />
          Ringkasan AI
          {loading && <Loader2 className="size-3 animate-spin text-violet-400" />}
        </div>
        <button
          type="button"
          onClick={() => void ringkas()}
          disabled={analyzing}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-violet-300 bg-white px-2 text-[11px] font-medium text-violet-700 transition hover:bg-violet-100 disabled:opacity-50"
        >
          {analyzing ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          {analyzing ? "Meringkas..." : insight ? "Ringkas ulang" : "Ringkas dengan AI"}
        </button>
      </div>

      {error && <p className="mt-1.5 text-xs text-red-700">{error}</p>}
      {notice && <p className="mt-1.5 text-xs text-slate-600">{notice}</p>}

      {!loading && !insight && !error && !notice && (
        <p className="mt-1.5 text-xs text-slate-500">
          Belum ada ringkasan untuk percakapan ini.
        </p>
      )}

      {insight && (
        <div className="mt-1.5 space-y-1.5">
          <p className="text-xs leading-relaxed text-slate-700">
            {insight.summary || "Ringkasan kosong."}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {insight.topic && (
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                {insight.topic}
              </span>
            )}
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${SENTIMENT_STYLE[insight.sentiment]}`}
            >
              {SENTIMENT_LABEL[insight.sentiment]}
            </span>
            {insight.is_complaint && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                Terindikasi komplain
              </span>
            )}
          </div>
          {insight.keywords.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {insight.keywords.map((keyword) => (
                <span
                  key={keyword}
                  className="rounded-sm bg-violet-100 px-1.5 py-0.5 text-[11px] text-violet-800"
                >
                  {keyword}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
