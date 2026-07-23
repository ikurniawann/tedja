"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  EyeOff,
  Link2,
  Loader2,
  MessageSquareReply,
  RefreshCw,
  Send,
  ShieldAlert,
  Star,
} from "lucide-react";
import { RATING_LABELS, formatReviewWait } from "../helpers";
import { GoogleConnectPanel } from "./google-connect-panel";

/**
 * EPIC-013 Fase A — Google Review: baca & balas dari dashboard.
 *
 * Catatan penting yang harus terlihat agent: satu ulasan hanya boleh punya
 * SATU balasan — mengirim lagi MENGGANTI balasan sebelumnya di Google, bukan
 * menambah. UI menegaskan ini agar tidak dikira ruang chat.
 */

interface GoogleReview {
  id: string;
  reviewer_name: string;
  reviewer_photo_url: string | null;
  star_rating: number;
  comment: string | null;
  review_created_at: string;
  reply_comment: string | null;
  reply_updated_at: string | null;
  status: "baru" | "dibalas" | "diabaikan";
  is_complaint: boolean;
  first_reply_seconds: number | null;
  replied_by_name: string | null;
  sla_breached: boolean;
  waiting_seconds: number;
}

interface Summary {
  total: number;
  belum_dibalas: number;
  komplain_terbuka: number;
  rata_rating: string | null;
  rata_waktu_balas: string | null;
}

const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

export function CrmReviewsPage() {
  const [reviews, setReviews] = useState<GoogleReview[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [integration, setIntegration] = useState<{ configured: boolean } | null>(null);
  const [statusFilter, setStatusFilter] = useState("baru");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error: string | null; message: string | null }>({
    error: null,
    message: null,
  });

  const load = useCallback(async () => {
    const sp = new URLSearchParams();
    if (statusFilter !== "all") sp.set("status", statusFilter);
    if (ratingFilter !== "all") sp.set("rating", ratingFilter);

    try {
      const response = await fetch(`/api/crm/reviews?${sp.toString()}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Gagal memuat ulasan");
      setReviews(json.data.reviews ?? []);
      setSummary(json.data.summary ?? null);
      setIntegration(json.data.integration ?? null);
      setFeedback((current) => ({ ...current, error: null }));
    } catch (error) {
      setFeedback({
        error: error instanceof Error ? error.message : "Gagal memuat ulasan",
        message: null,
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, ratingFilter]);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);

  async function act(body: Record<string, unknown>, id?: string) {
    if (id) setBusyId(id);
    setFeedback({ error: null, message: null });
    try {
      const response = await fetch("/api/crm/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Gagal memproses");
      return json.data ?? true;
    } catch (error) {
      setFeedback({
        error: error instanceof Error ? error.message : "Gagal memproses",
        message: null,
      });
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function sync() {
    setSyncing(true);
    const result = await act({ action: "sync" });
    setSyncing(false);
    if (result) {
      setFeedback({
        error: null,
        message: `Sinkronisasi selesai — ${result.inserted} ulasan baru, ${result.updated} diperbarui.`,
      });
      await load();
    }
  }

  async function sendReply(review: GoogleReview) {
    if (!draft || draft.id !== review.id || !draft.text.trim()) return;
    const result = await act({ action: "reply", id: review.id, comment: draft.text }, review.id);
    if (result) {
      setDraft(null);
      setFeedback({ error: null, message: "Balasan terkirim ke Google." });
      await load();
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/dashboard/crm" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900">
              <ArrowLeft className="size-4" /> CRM Dashboard
            </Link>
            <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold text-slate-950">
              <Star className="size-6 fill-amber-400 text-amber-400" />
              Google Review
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Balasan dikirim langsung ke Google dan tampil publik.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void sync()}
            disabled={syncing}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
            Tarik Ulasan
          </button>
        </div>

        {integration && !integration.configured && !showConnect && (
          <div className="flex flex-wrap items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <strong className="font-semibold">Integrasi Google belum terhubung.</strong> Ulasan
              belum bisa ditarik dan balasan belum bisa dikirim.
            </span>
            <button
              type="button"
              onClick={() => setShowConnect(true)}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-amber-600 px-3 text-xs font-semibold text-white transition hover:bg-amber-700"
            >
              <Link2 className="size-3.5" /> Hubungkan Sekarang
            </button>
          </div>
        )}

        {(showConnect || integration?.configured) && (
          <>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowConnect((current) => !current)}
                className="text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-800"
              >
                {showConnect ? "Sembunyikan pengaturan koneksi" : "Pengaturan koneksi Google"}
              </button>
            </div>
            {showConnect && <GoogleConnectPanel onSaved={load} />}
          </>
        )}

        {(feedback.error || feedback.message) && (
          <div
            className={`rounded-md border px-4 py-3 text-sm ${
              feedback.error
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {feedback.error || feedback.message}
          </div>
        )}

        {summary && (
          <div className="grid gap-3 sm:grid-cols-4">
            <SummaryCard label="Total ulasan" value={String(summary.total)} />
            <SummaryCard
              label="Belum dibalas"
              value={String(summary.belum_dibalas)}
              tone={summary.belum_dibalas > 0 ? "amber" : "default"}
            />
            <SummaryCard
              label="Komplain terbuka"
              value={String(summary.komplain_terbuka)}
              tone={summary.komplain_terbuka > 0 ? "red" : "default"}
            />
            <SummaryCard
              label="Rata-rata rating"
              value={summary.rata_rating ? `${Number(summary.rata_rating).toFixed(1)}/5` : "-"}
            />
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none"
            >
              <option value="baru">Belum dibalas</option>
              <option value="dibalas">Sudah dibalas</option>
              <option value="diabaikan">Diabaikan</option>
              <option value="all">Semua status</option>
            </select>
            <select
              value={ratingFilter}
              onChange={(event) => setRatingFilter(event.target.value)}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none"
            >
              <option value="all">Semua rating</option>
              {[5, 4, 3, 2, 1].map((star) => (
                <option key={star} value={star}>{star} bintang</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center py-14">
              <Loader2 className="size-6 animate-spin text-slate-400" />
            </div>
          ) : reviews.length === 0 ? (
            <div className="px-4 py-14 text-center text-sm text-slate-500">
              Belum ada ulasan pada filter ini.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {reviews.map((review) => (
                <article key={review.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">{review.reviewer_name}</span>
                        <Stars value={review.star_rating} />
                        {review.is_complaint && (
                          <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                            Komplain
                          </span>
                        )}
                        {review.status === "baru" && review.sla_breached && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                            <AlertTriangle className="size-3" /> Lewat SLA
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {tanggal(review.review_created_at)}
                        {review.status === "baru" && ` · menunggu ${formatReviewWait(review.waiting_seconds)}`}
                      </p>
                    </div>

                    {review.status === "baru" && (
                      <button
                        type="button"
                        onClick={() => void act({ action: "ignore", id: review.id }, review.id).then(load)}
                        disabled={busyId === review.id}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      >
                        <EyeOff className="size-3.5" /> Abaikan
                      </button>
                    )}
                  </div>

                  {review.comment ? (
                    <p className="whitespace-pre-wrap text-sm text-slate-700">{review.comment}</p>
                  ) : (
                    <p className="text-sm italic text-slate-400">
                      Rating tanpa teks ulasan ({RATING_LABELS[review.star_rating]}).
                    </p>
                  )}

                  {review.reply_comment ? (
                    <div className="rounded-lg border-l-2 border-emerald-400 bg-emerald-50/60 px-3 py-2">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                        <CheckCircle2 className="size-3" /> Balasan terkirim
                        {review.replied_by_name && ` · ${review.replied_by_name}`}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                        {review.reply_comment}
                      </p>
                      <button
                        type="button"
                        onClick={() => setDraft({ id: review.id, text: review.reply_comment ?? "" })}
                        className="mt-1.5 text-xs font-medium text-emerald-700 underline underline-offset-2"
                      >
                        Ubah balasan
                      </button>
                    </div>
                  ) : null}

                  {draft?.id === review.id ? (
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                      <textarea
                        rows={3}
                        autoFocus
                        value={draft.text}
                        onChange={(event) => setDraft({ id: review.id, text: event.target.value })}
                        placeholder="Tulis balasan yang akan tampil publik di Google..."
                        className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
                      />
                      <p className="text-[11px] text-slate-500">
                        Google hanya menyimpan <strong>satu balasan</strong> per ulasan — mengirim
                        lagi akan mengganti balasan sebelumnya, bukan menambah.
                      </p>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setDraft(null)}
                          className="h-8 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-100"
                        >
                          Batal
                        </button>
                        <button
                          type="button"
                          onClick={() => void sendReply(review)}
                          disabled={busyId === review.id || !draft.text.trim()}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-950 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          {busyId === review.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Send className="size-3.5" />
                          )}
                          Kirim ke Google
                        </button>
                      </div>
                    </div>
                  ) : (
                    review.status !== "dibalas" && (
                      <button
                        type="button"
                        onClick={() => setDraft({ id: review.id, text: "" })}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <MessageSquareReply className="size-3.5" /> Balas
                      </button>
                    )
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} dari 5 bintang`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`size-3.5 ${
            star <= value ? "fill-amber-400 text-amber-400" : "text-slate-300"
          }`}
        />
      ))}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "amber" | "red";
}) {
  const tones = {
    default: "text-slate-950",
    amber: "text-amber-700",
    red: "text-red-700",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`text-2xl font-semibold ${tones[tone]}`}>{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}
