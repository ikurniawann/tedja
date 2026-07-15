import type { OfferPortalData, OfferRespondAction } from "./types";

const base = (token: string) => `/api/offer/session/${token}`;

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

export const fetchOffer = (token: string) =>
  fetch(base(token))
    .then((r) => parse<{ data: { offer: OfferPortalData } }>(r))
    .then((r) => r.data.offer);

export const respondOffer = (token: string, action: OfferRespondAction, note?: string) =>
  fetch(`${base(token)}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, note: note || undefined }),
  }).then((r) => parse(r));
