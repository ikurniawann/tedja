"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BrainCircuit,
  BotMessageSquare,
  Loader2,
  MessageCircle,
  Send,
  VideoOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLiveSessions } from "../queries";
import {
  fetchLiveMonitorChat,
  fetchWebrtcAnswer,
  liveFrameUrl,
  postWebrtcOffer,
  sendLiveMonitorChat,
  type LiveMonitorChatMessage,
  type LiveSessionType,
} from "../api";
import { startWebrtcViewer } from "@/lib/recruitment/webrtc-client";

const FRAME_REFRESH_MS = 3_000;
const CHAT_POLL_MS = 4_000;

const TYPE_META = {
  psikotes: { label: "Psikotes", icon: <BrainCircuit className="size-4" /> },
  interview: { label: "Interview AI", icon: <BotMessageSquare className="size-4" /> },
} as const;

/**
 * Detail Live Monitoring satu sesi: live cam besar (frame refresh 3 dtk)
 * + live chat dua arah dgn kandidat (polling 4 dtk).
 */
export function LiveMonitorDetailPage({
  type,
  sessionId,
}: {
  type: LiveSessionType;
  sessionId: string;
}) {
  const router = useRouter();
  const { data: sessions } = useLiveSessions();
  const session =
    sessions?.find((s) => s.session_type === type && s.session_id === sessionId) ?? null;

  const [tick, setTick] = useState(0);
  const [frameFailed, setFrameFailed] = useState(false);
  const [messages, setMessages] = useState<LiveMonitorChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  // WebRTC viewer: video smooth real-time; gagal → fallback frame polling
  const [rtcStatus, setRtcStatus] = useState<"connecting" | "connected" | "failed">("connecting");
  const [rtcAttempt, setRtcAttempt] = useState(0);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const stop = startWebrtcViewer({
      postOffer: (offerId, sdp) => postWebrtcOffer(type, sessionId, offerId, sdp),
      fetchAnswer: (offerId) => fetchWebrtcAnswer(type, sessionId, offerId),
      onStream: (stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      },
      onStatus: setRtcStatus,
    });
    return stop;
  }, [type, sessionId, rtcAttempt]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
      setFrameFailed(false);
    }, FRAME_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const mergeMessages = useCallback((incoming: LiveMonitorChatMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const known = new Set(prev.map((m) => m.id));
      const fresh = incoming.filter((m) => !known.has(m.id));
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
  }, []);

  // polling chat
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const last = messages[messages.length - 1]?.created_at;
        const next = await fetchLiveMonitorChat(type, sessionId, last);
        if (!cancelled) mergeMessages(next);
      } catch {
        // coba lagi di tick berikutnya
      }
    };
    void poll();
    const timer = setInterval(poll, CHAT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, sessionId, mergeMessages]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const saved = await sendLiveMonitorChat(type, sessionId, text);
      setInput("");
      mergeMessages([saved]);
    } catch {
      // biarkan input utuh
    } finally {
      setSending(false);
    }
  };

  const meta = TYPE_META[type];

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/hris/live-monitoring")} className="gap-1">
          <ArrowLeft className="size-4" /> Live Monitoring
        </Button>
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            {session?.candidate_name ?? "Kandidat"}
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
              {meta.icon} {meta.label}
            </span>
          </h1>
          {session?.position_title && (
            <p className="text-xs text-gray-500">{session.position_title}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Live cam — video WebRTC real-time; fallback frame polling */}
        <Card className="overflow-hidden p-0 lg:col-span-2">
          <div className="relative aspect-[4/3] w-full bg-gray-900">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={muted}
              className={`h-full w-full object-contain ${rtcStatus === "connected" ? "" : "hidden"}`}
            />
            {rtcStatus !== "connected" &&
              (!frameFailed ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={liveFrameUrl(type, sessionId, tick)}
                  alt="Live cam kandidat"
                  onError={() => setFrameFailed(true)}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-500">
                  <VideoOff className="size-10" />
                  <p className="text-sm">
                    Belum ada frame — kandidat mungkin baru memulai / kamera off
                  </p>
                </div>
              ))}
            <span
              className={`absolute left-3 top-3 flex items-center gap-1.5 rounded px-2 py-1 text-xs font-semibold text-white ${
                rtcStatus === "connected" ? "bg-red-600" : "bg-gray-700"
              }`}
            >
              <span
                className={`size-2 rounded-full bg-white ${rtcStatus === "connected" ? "animate-pulse" : ""}`}
              />
              {rtcStatus === "connected"
                ? "LIVE · video real-time"
                : rtcStatus === "connecting"
                  ? "Menghubungkan video langsung…"
                  : "Mode frame (video langsung gagal)"}
            </span>
            <div className="absolute right-3 top-3 flex gap-2">
              {rtcStatus === "connected" && (
                <button
                  type="button"
                  onClick={() => setMuted((m) => !m)}
                  className="rounded bg-black/60 px-2 py-1 text-xs font-medium text-white hover:bg-black/80"
                >
                  {muted ? "🔇 Aktifkan suara" : "🔊 Suara aktif"}
                </button>
              )}
              {rtcStatus === "failed" && (
                <button
                  type="button"
                  onClick={() => {
                    setRtcStatus("connecting");
                    setRtcAttempt((n) => n + 1);
                  }}
                  className="rounded bg-black/60 px-2 py-1 text-xs font-medium text-white hover:bg-black/80"
                >
                  Coba video langsung lagi
                </button>
              )}
            </div>
          </div>
        </Card>

        {/* Live chat */}
        <Card className="flex h-[480px] flex-col p-0">
          <div className="flex items-center gap-1.5 border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-800">
            <MessageCircle className="size-4 text-emerald-500" /> Live Chat dengan Kandidat
          </div>
          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <p className="pt-10 text-center text-xs text-gray-400">
                Belum ada pesan. Sapa kandidat atau jawab pertanyaannya di sini.
              </p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm ${
                    m.sender === "hr"
                      ? "ml-auto bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  <p className="text-[10px] font-semibold opacity-70">
                    {m.sender === "hr" ? (m.sender_name ?? "HRD") : (m.sender_name ?? "Kandidat")}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{m.message}</p>
                  <p className="mt-0.5 text-right text-[9px] opacity-60">
                    {new Date(m.created_at).toLocaleTimeString("id-ID", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              ))
            )}
          </div>
          <div className="flex items-center gap-1.5 border-t border-gray-100 p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              maxLength={1000}
              placeholder="Tulis pesan ke kandidat…"
              className="h-9 flex-1 rounded-md border border-gray-200 px-2.5 text-sm outline-none focus:ring-1 focus:ring-blue-300"
            />
            <Button type="button" size="icon" onClick={handleSend} disabled={sending || !input.trim()}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
