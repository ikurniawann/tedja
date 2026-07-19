"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Inbox, Loader2, MessageCircle, Search, WifiOff } from "lucide-react";
import type {
  ConversationStatus,
  InboxConversation,
  InboxMessage,
  InternalNote,
  MemberContext,
  ReplyTemplate,
} from "../types";
import type { CsCategory, CsPriority } from "@/lib/crm/cs-rules";
import { STATUS_LABELS, STATUS_STYLES } from "../types";
import { ChatPanel } from "./chat-panel";
import { MemberContextPanel } from "./member-context-panel";
import { ComplaintPanel } from "./complaint-panel";

/**
 * EPIC-012 Fase C — Inbox WhatsApp CS: daftar percakapan, thread chat, dan
 * konteks member. Polling 5 detik (pola halaman gateway).
 */

const POLL_MS = 5000;

const waktuRelatif = (iso: string | null) => {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}j`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
};

export function CrmInboxPage() {
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [totals, setTotals] = useState<{
    total_unread: number;
    total_active: number;
    total_breached?: number;
    total_complaints?: number;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [assignedFilter, setAssignedFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    conversation: InboxConversation;
    messages: InboxMessage[];
    member: MemberContext | null;
    notes: InternalNote[];
  } | null>(null);
  const [templates, setTemplates] = useState<ReplyTemplate[]>([]);
  const [gatewayDown, setGatewayDown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const loadConversations = useCallback(async () => {
    const sp = new URLSearchParams();
    if (statusFilter !== "all") sp.set("status", statusFilter);
    if (assignedFilter !== "all") sp.set("assigned", assignedFilter);
    if (search.trim()) sp.set("search", search.trim());

    try {
      const response = await fetch(`/api/crm/inbox/conversations?${sp.toString()}`, {
        cache: "no-store",
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Gagal memuat inbox");
      setConversations(json.data.conversations ?? []);
      setTotals(json.data.totals ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat inbox");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, assignedFilter, search]);

  const loadDetail = useCallback(async (conversationId: string, markRead: boolean) => {
    try {
      const response = await fetch(`/api/crm/inbox/conversations/${conversationId}`, {
        cache: "no-store",
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Gagal memuat percakapan");
      // Abaikan respons yang datang setelah user pindah percakapan.
      if (selectedRef.current !== conversationId) return;
      setDetail(json.data);

      if (markRead && json.data.conversation.unread_count > 0) {
        await fetch(`/api/crm/inbox/conversations/${conversationId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mark_read" }),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat percakapan");
    }
  }, []);

  // Muat awal + polling.
  useEffect(() => {
    setLoading(true);
    const debounce = setTimeout(() => void loadConversations(), 250);
    return () => clearTimeout(debounce);
  }, [loadConversations]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadConversations();
      if (selectedRef.current) void loadDetail(selectedRef.current, false);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [loadConversations, loadDetail]);

  useEffect(() => {
    fetch("/api/crm/inbox/templates", { cache: "no-store" })
      .then((response) => response.json())
      .then((json) => setTemplates(json.data ?? []))
      .catch(() => setTemplates([]));

    // Penanda gateway mati — inbox berhenti menerima tanpa ini.
    fetch("/api/settings/wa-gateway", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (json?.data) setGatewayDown(json.data.reachable === false || json.data.status?.connected === false);
      })
      .catch(() => undefined);
  }, []);

  function selectConversation(conversationId: string) {
    setSelectedId(conversationId);
    setDetail(null);
    void loadDetail(conversationId, true);
    // Optimis: hilangkan badge unread di daftar.
    setConversations((current) =>
      current.map((item) =>
        item.id === conversationId ? { ...item, unread_count: 0 } : item
      )
    );
  }

  async function handleReply(message: string): Promise<boolean> {
    if (!selectedId) return false;
    setBusy(true);
    try {
      const response = await fetch(`/api/crm/inbox/conversations/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reply", message }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Gagal mengirim balasan");
      await loadDetail(selectedId, false);
      await loadConversations();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim balasan");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleAction(
    action: "assign_me" | "unassign" | "set_status",
    status?: ConversationStatus
  ) {
    if (!selectedId) return;
    try {
      const response = await fetch(`/api/crm/inbox/conversations/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "set_status" ? { action, status } : { action }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Gagal memproses aksi");
      await loadDetail(selectedId, false);
      await loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memproses aksi");
    }
  }

  async function postAction(payload: Record<string, unknown>) {
    if (!selectedId) return;
    try {
      const response = await fetch(`/api/crm/inbox/conversations/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Gagal memproses aksi");
      await loadDetail(selectedId, false);
      await loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memproses aksi");
    }
  }

  const handleSetComplaint = (payload: {
    is_complaint: boolean;
    category?: CsCategory | null;
    priority?: CsPriority;
  }) => postAction({ action: "set_complaint", ...payload });

  const handleAddNote = (body: string) => postAction({ action: "add_note", body });

  const activeConversation = useMemo(
    () => detail?.conversation ?? conversations.find((item) => item.id === selectedId) ?? null,
    [detail, conversations, selectedId]
  );

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <Link href="/dashboard/crm" className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-900">
            <ArrowLeft className="size-3.5" /> CRM Dashboard
          </Link>
          <h1 className="mt-0.5 flex items-center gap-2 text-lg font-semibold text-slate-950">
            <Inbox className="size-5 text-violet-600" />
            Inbox WhatsApp
            {totals && totals.total_unread > 0 && (
              <span className="rounded-full bg-violet-600 px-2 py-0.5 text-xs font-semibold text-white">
                {totals.total_unread} belum dibaca
              </span>
            )}
            {totals && (totals.total_complaints ?? 0) > 0 && (
              <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
                {totals.total_complaints} komplain
              </span>
            )}
            {totals && (totals.total_breached ?? 0) > 0 && (
              <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                {totals.total_breached} lewat SLA
              </span>
            )}
          </h1>
        </div>
        {gatewayDown && (
          <div className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
            <WifiOff className="size-3.5" />
            Gateway WhatsApp tidak terhubung — pesan baru tidak masuk.
            <Link href="/dashboard/settings/wa-gateway" className="underline">Periksa</Link>
          </div>
        )}
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[320px_1fr_280px]">
        {/* Kolom 1 — daftar percakapan */}
        <div className={`flex min-h-0 flex-col border-r border-slate-200 bg-white ${selectedId ? "hidden lg:flex" : "flex"}`}>
          <div className="space-y-2 border-b border-slate-200 p-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari nomor atau nama..."
                className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs outline-none"
              >
                <option value="all">Semua status</option>
                <option value="open">Baru</option>
                <option value="in_progress">Ditangani</option>
                <option value="waiting_customer">Tunggu customer</option>
                <option value="resolved">Selesai</option>
              </select>
              <select
                value={assignedFilter}
                onChange={(event) => setAssignedFilter(event.target.value)}
                className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs outline-none"
              >
                <option value="all">Semua agent</option>
                <option value="me">Saya tangani</option>
                <option value="unassigned">Belum ditangani</option>
              </select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="size-5 animate-spin text-slate-400" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-slate-400">
                <MessageCircle className="size-7" />
                Belum ada percakapan. Pesan WhatsApp masuk akan muncul di sini.
              </div>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => selectConversation(conversation.id)}
                  className={`block w-full border-b border-slate-100 px-3 py-2.5 text-left transition hover:bg-slate-50 ${
                    selectedId === conversation.id ? "bg-violet-50/70" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-900">
                      {conversation.customer_name || `+${conversation.phone}`}
                    </span>
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {waktuRelatif(conversation.last_message_at)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-500">
                      {conversation.last_message_preview || "—"}
                    </span>
                    {conversation.unread_count > 0 && (
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
                        {conversation.unread_count > 9 ? "9+" : conversation.unread_count}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${STATUS_STYLES[conversation.status]}`}>
                      {STATUS_LABELS[conversation.status]}
                    </span>
                    {conversation.is_complaint && (
                      <span className="rounded-full border border-orange-200 bg-orange-50 px-1.5 py-px text-[10px] font-medium text-orange-700">
                        Komplain
                      </span>
                    )}
                    {conversation.sla_response_breached && (
                      <span className="rounded-full border border-red-200 bg-red-50 px-1.5 py-px text-[10px] font-semibold text-red-700">
                        Lewat SLA
                      </span>
                    )}
                    {conversation.assigned_name && (
                      <span className="truncate text-[10px] text-slate-400">
                        {conversation.assigned_name}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Kolom 2 — chat */}
        <div className={`min-h-0 ${selectedId ? "block" : "hidden lg:block"}`}>
          {activeConversation && detail ? (
            <div className="flex h-full flex-col">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="flex items-center gap-1 border-b border-slate-200 bg-white px-4 py-2 text-xs text-slate-500 lg:hidden"
              >
                <ArrowLeft className="size-3.5" /> Kembali ke daftar
              </button>
              <div className="min-h-0 flex-1">
                <ChatPanel
                  conversation={activeConversation}
                  messages={detail.messages}
                  templates={templates}
                  busy={busy}
                  onReply={handleReply}
                  onAction={handleAction}
                />
              </div>
            </div>
          ) : selectedId ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-400">
              <MessageCircle className="size-10" />
              Pilih percakapan untuk mulai membalas.
            </div>
          )}
        </div>

        {/* Kolom 3 — konteks member */}
        <div className="hidden min-h-0 overflow-y-auto border-l border-slate-200 bg-white lg:block">
          {detail ? (
            <>
              <MemberContextPanel member={detail.member} />
              <ComplaintPanel
                conversation={detail.conversation}
                notes={detail.notes ?? []}
                onSetComplaint={handleSetComplaint}
                onAddNote={handleAddNote}
              />
            </>
          ) : (
            <div className="p-6 text-center text-xs text-slate-400">
              Profil member tampil di sini.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
