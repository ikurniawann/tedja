import type {
  InterviewAnswerResult,
  InterviewPortalCurrentTurn,
  InterviewPortalData,
  InterviewProctorEventType,
} from "./types";

const base = (token: string) => `/api/interview/session/${token}`;

async function parse<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof json === "object" && json && "error" in json
        ? String((json as { error?: string }).error)
        : `Permintaan gagal (${res.status})`;
    throw new Error(message);
  }
  return json as T;
}

export const fetchInterviewSession = (token: string) =>
  fetch(base(token))
    .then((r) => parse<{ data: InterviewPortalData }>(r))
    .then((r) => r.data);

export const startInterviewSession = (token: string) =>
  fetch(`${base(token)}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ webcam_consent: true }),
  })
    .then((r) => parse<{ data: { turn: InterviewPortalCurrentTurn | null } }>(r))
    .then((r) => r.data);

/** Kirim jawaban suara (rekaman MediaRecorder). */
export const answerInterviewVoice = (token: string, turnId: string, audio: Blob) => {
  const form = new FormData();
  form.append("turn_id", turnId);
  form.append("mode", "voice");
  form.append("audio", audio, "answer.webm");
  return fetch(`${base(token)}/answer`, { method: "POST", body: form })
    .then((r) => parse<{ data: InterviewAnswerResult }>(r))
    .then((r) => r.data);
};

/** Kirim jawaban ketik (fallback bila mikrofon bermasalah). */
export const answerInterviewText = (token: string, turnId: string, text: string) => {
  const form = new FormData();
  form.append("turn_id", turnId);
  form.append("mode", "text");
  form.append("answer_text", text);
  return fetch(`${base(token)}/answer`, { method: "POST", body: form })
    .then((r) => parse<{ data: InterviewAnswerResult }>(r))
    .then((r) => r.data);
};

/** Fire-and-forget — kegagalan proctoring tidak boleh mengganggu interview. */
export const postInterviewProctorEvent = (
  token: string,
  eventType: InterviewProctorEventType,
  extra?: { meta?: Record<string, string | number | boolean>; snapshot?: string }
) =>
  fetch(`${base(token)}/proctor-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type: eventType, ...extra }),
    keepalive: true,
  }).catch(() => undefined);

/** Frame near-live utk Live Monitoring HRD — fire-and-forget. */
export const postInterviewLiveFrame = (token: string, frame: string) =>
  fetch(`${base(token)}/live-frame`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frame }),
  }).catch(() => undefined);

export interface LiveChatMessage {
  id: string;
  sender: "candidate" | "hr";
  sender_name: string | null;
  message: string;
  created_at: string;
}

export const fetchInterviewLiveChat = (token: string, after?: string) =>
  fetch(`${base(token)}/chat${after ? `?after=${encodeURIComponent(after)}` : ""}`)
    .then((r) => parse<{ data: LiveChatMessage[] }>(r))
    .then((r) => r.data);

export const sendInterviewLiveChat = (token: string, message: string) =>
  fetch(`${base(token)}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  }).then((r) => parse<{ data: LiveChatMessage }>(r)).then((r) => r.data);

/** Signaling WebRTC live monitoring — sisi kandidat. */
export const fetchInterviewWebrtcOffers = (token: string) =>
  fetch(`${base(token)}/webrtc`)
    .then((r) => parse<{ data: { offers: { offer_id: string; sdp: string }[] } }>(r))
    .then((r) => r.data.offers);

export const postInterviewWebrtcAnswer = (token: string, offerId: string, sdp: string) =>
  fetch(`${base(token)}/webrtc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offer_id: offerId, sdp }),
  }).then((r) => parse(r));

/** Unggah potongan rekaman video interview — dipanggil berurutan tiap 10 dtk. */
export const postRecordingChunk = (token: string, part: string, chunk: Blob) => {
  const form = new FormData();
  form.append("part", part);
  form.append("chunk", chunk, "chunk.webm");
  return fetch(`${base(token)}/recording-chunk`, {
    method: "POST",
    body: form,
    keepalive: chunk.size < 60_000, // flush terakhir saat tab ditutup
  }).catch(() => undefined);
};
