import { NextRequest, NextResponse } from "next/server";
import {
  loadOfferByToken,
  invalidOfferTokenResponse,
  offerRateLimited,
  offerRateLimitedResponse,
} from "@/lib/recruitment/offer-session";

/**
 * GET /api/offer/session/[token] — rincian penawaran utk portal kandidat
 * (anonim, identitas = token). Catatan internal HRD (notes) TIDAK dikirim.
 */

interface RouteParams {
  params: Promise<{ token: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params;
    const offer = await loadOfferByToken(token);
    if (!offer) return invalidOfferTokenResponse();
    if (offerRateLimited(offer.id, "get")) return offerRateLimitedResponse();

    return NextResponse.json({
      data: {
        offer: {
          status: offer.status,
          version: offer.version,
          candidate_name: offer.candidate_name,
          brand_name: offer.brand_name,
          position_title: offer.position_title,
          base_salary: Number(offer.base_salary),
          benefits: offer.benefits,
          start_date: offer.start_date,
          response_note: offer.response_note,
          responded_at: offer.responded_at,
          sent_at: offer.sent_at,
          expires_at: offer.expires_at,
        },
      },
    });
  } catch (error) {
    console.error("[offer-session] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
