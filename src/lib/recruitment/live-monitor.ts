import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { loadSessionByToken } from "./psikotes-session";
import { loadInterviewSessionByToken } from "./interview-session";

/**
 * Live Monitoring (EPIC-005): kandidat yang sedang psikotes/interview AI
 * mengirim frame webcam kecil tiap beberapa detik (UPSERT 1 baris/sesi) —
 * HRD memantau near-live tanpa WebRTC. Live chat dua arah via polling.
 * Handler publik di sini dipakai route token psikotes & interview supaya
 * tidak duplikat.
 */

export type LiveSessionType = "psikotes" | "interview";

const FRAME_DATA_URL_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const MAX_FRAME_CHARS = 400_000; // ~300 KB base64
const MAX_MESSAGE_CHARS = 1000;
const CHAT_LIMIT = 100;

export interface LiveSessionRef {
  id: string;
  candidate_name: string;
  status: string;
}

/** Muat sesi via token utk endpoint publik live-frame/chat. */
export async function resolveLiveSession(
  type: LiveSessionType,
  token: string
): Promise<LiveSessionRef | null> {
  if (type === "psikotes") {
    const s = await loadSessionByToken(token);
    return s ? { id: s.id, candidate_name: s.candidate_name, status: s.status } : null;
  }
  const s = await loadInterviewSessionByToken(token);
  return s ? { id: s.id, candidate_name: s.candidate_name, status: s.status } : null;
}

/** POST live-frame kandidat: {frame: dataURL jpeg} → UPSERT frame terbaru. */
export async function handleLiveFrame(
  req: NextRequest,
  type: LiveSessionType,
  session: LiveSessionRef
): Promise<NextResponse> {
  if (session.status !== "in_progress") {
    return NextResponse.json({ error: "Sesi tidak sedang berjalan" }, { status: 409 });
  }
  const body = await req.json().catch(() => null);
  const frame = typeof body === "object" && body !== null ? (body as { frame?: unknown }).frame : null;
  if (typeof frame !== "string" || frame.length > MAX_FRAME_CHARS || !FRAME_DATA_URL_RE.test(frame)) {
    return NextResponse.json({ error: "Frame tidak valid" }, { status: 400 });
  }
  const base64 = frame.slice(frame.indexOf(",") + 1);
  await queryOne(
    `INSERT INTO recruitment.live_monitor_frames (session_type, session_id, frame_base64, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (session_type, session_id)
     DO UPDATE SET frame_base64 = EXCLUDED.frame_base64, updated_at = now()
     RETURNING session_id`,
    [type, session.id, base64]
  );
  return NextResponse.json({ data: { ok: true } });
}

export interface LiveChatMessage {
  id: string;
  sender: "candidate" | "hr";
  sender_name: string | null;
  message: string;
  created_at: string;
}

/** Ambil pesan chat satu sesi (dipakai kandidat & HR). */
export async function fetchChatMessages(
  type: LiveSessionType,
  sessionId: string,
  afterIso?: string | null
): Promise<LiveChatMessage[]> {
  if (afterIso) {
    return query<LiveChatMessage>(
      `SELECT id, sender, sender_name, message, created_at
       FROM recruitment.live_chat_messages
       WHERE session_type = $1 AND session_id = $2 AND created_at > $3
       ORDER BY created_at
       LIMIT ${CHAT_LIMIT}`,
      [type, sessionId, afterIso]
    );
  }
  const rows = await query<LiveChatMessage>(
    `SELECT id, sender, sender_name, message, created_at
     FROM recruitment.live_chat_messages
     WHERE session_type = $1 AND session_id = $2
     ORDER BY created_at DESC
     LIMIT ${CHAT_LIMIT}`,
    [type, sessionId]
  );
  return rows.reverse();
}

/** Simpan pesan chat (validasi panjang di sini). */
export async function insertChatMessage(input: {
  type: LiveSessionType;
  sessionId: string;
  sender: "candidate" | "hr";
  senderName: string | null;
  message: string;
}): Promise<LiveChatMessage | null> {
  const message = input.message.trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) return null;
  return queryOne<LiveChatMessage>(
    `INSERT INTO recruitment.live_chat_messages
       (session_type, session_id, sender, sender_name, message)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, sender, sender_name, message, created_at`,
    [input.type, input.sessionId, input.sender, input.senderName, message]
  );
}

/** Handler GET/POST chat sisi kandidat (identitas = token sesi). */
export async function handleCandidateChat(
  req: NextRequest,
  type: LiveSessionType,
  session: LiveSessionRef
): Promise<NextResponse> {
  if (req.method === "GET") {
    const after = req.nextUrl.searchParams.get("after");
    const messages = await fetchChatMessages(type, session.id, after);
    return NextResponse.json({ data: messages });
  }
  // kandidat boleh bertanya sejak menerima link (sent) sampai sesi berjalan
  if (session.status !== "in_progress" && session.status !== "sent") {
    return NextResponse.json({ error: "Sesi sudah berakhir" }, { status: 409 });
  }
  const body = await req.json().catch(() => null);
  const message =
    typeof body === "object" && body !== null ? (body as { message?: unknown }).message : null;
  if (typeof message !== "string") {
    return NextResponse.json({ error: "Pesan tidak valid" }, { status: 400 });
  }
  const saved = await insertChatMessage({
    type,
    sessionId: session.id,
    sender: "candidate",
    senderName: session.candidate_name,
    message,
  });
  if (!saved) return NextResponse.json({ error: "Pesan kosong" }, { status: 400 });
  return NextResponse.json({ data: saved }, { status: 201 });
}
