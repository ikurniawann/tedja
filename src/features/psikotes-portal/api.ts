import type { PortalSessionData, PortalTestStartData, ProctorEventType } from "./types";

const base = (token: string) => `/api/psikotes/session/${token}`;

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

export const fetchPortalSession = (token: string) =>
  fetch(base(token)).then((r) => parse<{ data: PortalSessionData }>(r)).then((r) => r.data);

export const startPortalSession = (token: string, webcamConsent: boolean) =>
  fetch(`${base(token)}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ webcam_consent: webcamConsent }),
  }).then((r) => parse(r));

export const startPortalTest = (token: string, testId: string) =>
  fetch(`${base(token)}/tests/${testId}/start`, { method: "POST" })
    .then((r) => parse<{ data: PortalTestStartData }>(r))
    .then((r) => r.data);

export const savePortalAnswers = (token: string, testId: string, answers: Record<string, string>) =>
  fetch(`${base(token)}/tests/${testId}/answers`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  }).then((r) => parse(r));

export const finishPortalTest = (token: string, testId: string, answers?: Record<string, string>) =>
  fetch(`${base(token)}/tests/${testId}/finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(answers ? { answers } : {}),
    // auto-submit saat waktu habis harus tetap terkirim walau tab ditutup
    keepalive: true,
  }).then((r) => parse(r));

export const uploadPortalDrawing = (token: string, testId: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return fetch(`${base(token)}/tests/${testId}/upload`, { method: "POST", body: form }).then((r) =>
    parse(r)
  );
};

export const finishPortalSession = (token: string) =>
  fetch(`${base(token)}/finish`, { method: "POST", keepalive: true }).then((r) => parse(r));

/** Fire-and-forget — kegagalan proctoring tidak boleh mengganggu tes. */
export const postProctorEvent = (
  token: string,
  eventType: ProctorEventType,
  extra?: { meta?: Record<string, string | number | boolean>; snapshot?: string }
) =>
  fetch(`${base(token)}/proctor-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type: eventType, ...extra }),
    keepalive: true,
  }).catch(() => undefined);

/** Frame near-live utk Live Monitoring HRD — fire-and-forget. */
export const postLiveFrame = (token: string, frame: string) =>
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

export const fetchLiveChat = (token: string, after?: string) =>
  fetch(`${base(token)}/chat${after ? `?after=${encodeURIComponent(after)}` : ""}`)
    .then((r) => parse<{ data: LiveChatMessage[] }>(r))
    .then((r) => r.data);

export const sendLiveChat = (token: string, message: string) =>
  fetch(`${base(token)}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  }).then((r) => parse<{ data: LiveChatMessage }>(r)).then((r) => r.data);

/** Signaling WebRTC live monitoring — sisi kandidat. */
export const fetchWebrtcOffers = (token: string) =>
  fetch(`${base(token)}/webrtc`)
    .then((r) => parse<{ data: { offers: { offer_id: string; sdp: string }[] } }>(r))
    .then((r) => r.data.offers);

export const postWebrtcAnswer = (token: string, offerId: string, sdp: string) =>
  fetch(`${base(token)}/webrtc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offer_id: offerId, sdp }),
  }).then((r) => parse(r));
