import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Helper bersama endpoint publik offer (/api/offer/session/[token]) —
 * pola sama dgn psikotes/interview-session: kandidat anonim, identitas =
 * token offer; rate limit di-key ke offer.
 */

export const OFFER_TOKEN_RE = /^[a-f0-9]{48,128}$/i;

/** Fallback masa hidup offer bila expires_at NULL (jangan pernah abadi). */
const MAX_OFFER_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export interface OfferRow {
  id: string;
  candidate_id: string;
  version: number;
  token: string;
  status: "sent" | "negotiating" | "accepted" | "declined" | "expired";
  position_title: string | null;
  base_salary: string; // numeric → string dari pg
  benefits: string[];
  start_date: string | null;
  notes: string | null;
  response_note: string | null;
  responded_at: string | null;
  sent_at: string | null;
  expires_at: string | null;
  candidate_name: string;
  brand_name: string | null;
}

export function invalidOfferTokenResponse() {
  return NextResponse.json({ error: "Link penawaran tidak berlaku" }, { status: 404 });
}

export function offerRateLimitedResponse() {
  return NextResponse.json(
    { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
    { status: 429 }
  );
}

export function offerRateLimited(offerId: string, bucket: string): boolean {
  return !checkRateLimit(`offer_session_${bucket}_${offerId}`).allowed;
}

/** Muat offer via token + auto-expire bila lewat masa berlaku. */
export async function loadOfferByToken(token: string): Promise<OfferRow | null> {
  if (!OFFER_TOKEN_RE.test(token)) return null;
  const offer = await queryOne<OfferRow>(
    `SELECT o.id, o.candidate_id, o.version, o.token, o.status, o.position_title,
            o.base_salary, o.benefits, o.start_date, o.notes, o.response_note,
            o.responded_at, o.sent_at, o.expires_at,
            c.full_name AS candidate_name, b.name AS brand_name
     FROM recruitment.candidate_offers o
     JOIN recruitment.candidates c ON c.id = o.candidate_id
     LEFT JOIN item.brands b ON b.id = c.brand_id
     WHERE o.token = $1`,
    [token]
  );
  if (!offer) return null;

  const isExpirable = offer.status === "sent" || offer.status === "negotiating";
  const expiresAtMs = offer.expires_at
    ? new Date(offer.expires_at).getTime()
    : new Date(offer.sent_at ?? 0).getTime() + MAX_OFFER_LIFETIME_MS;
  if (isExpirable && expiresAtMs < Date.now()) {
    await queryOne(
      `UPDATE recruitment.candidate_offers SET status = 'expired' WHERE id = $1 RETURNING id`,
      [offer.id]
    );
    return { ...offer, status: "expired" };
  }
  return offer;
}
