import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { offerRespondSchema } from "@/lib/validations/offer";
import {
  loadOfferByToken,
  invalidOfferTokenResponse,
  offerRateLimited,
  offerRateLimitedResponse,
} from "@/lib/recruitment/offer-session";

/**
 * POST /api/offer/session/[token]/respond — kandidat merespons penawaran:
 * accept / negotiate / decline (+ catatan). Respons + timestamp + IP
 * tercatat sebagai bukti digital; jejak masuk timeline Aktivitas.
 * accept/decline bersifat final; negotiate boleh diperbarui.
 */

const ACTION_TO_STATUS = {
  accept: "accepted",
  negotiate: "negotiating",
  decline: "declined",
} as const;

const ACTION_LABELS = {
  accept: "menerima",
  negotiate: "mengajukan negosiasi",
  decline: "menolak",
} as const;

interface RouteParams {
  params: Promise<{ token: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params;
    const offer = await loadOfferByToken(token);
    if (!offer) return invalidOfferTokenResponse();
    if (offerRateLimited(offer.id, "respond")) return offerRateLimitedResponse();

    if (offer.status !== "sent" && offer.status !== "negotiating") {
      return NextResponse.json(
        { error: "Penawaran ini sudah tidak bisa direspons" },
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = offerRespondSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: first ? `${first.path.join(".")}: ${first.message}` : "Payload tidak valid" },
        { status: 400 }
      );
    }
    const input = parsed.data;
    if (input.action === "negotiate" && !input.note?.trim()) {
      return NextResponse.json(
        { error: "Tuliskan catatan negosiasi Anda (mis. angka yang diharapkan)" },
        { status: 400 }
      );
    }

    const ip =
      req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;

    const updated = await withTransaction(async (client) => {
      const res = await client.query(
        `UPDATE recruitment.candidate_offers
         SET status = $2, response_note = $3, responded_at = now(),
             response_ip = $4, response_source = 'portal'
         WHERE id = $1 AND status IN ('sent', 'negotiating')
         RETURNING id, status, response_note, responded_at`,
        [offer.id, ACTION_TO_STATUS[input.action], input.note?.trim() || null, ip]
      );
      if (res.rows.length === 0) return null;
      await client.query(
        `INSERT INTO recruitment.candidate_activities
           (candidate_id, activity_type, description)
         VALUES ($1, 'offer_response', $2)`,
        [
          offer.candidate_id,
          `Kandidat ${ACTION_LABELS[input.action]} offer v${offer.version} via portal` +
            (input.note?.trim() ? ` — "${input.note.trim().slice(0, 300)}"` : ""),
        ]
      );
      return res.rows[0];
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Penawaran ini sudah tidak bisa direspons" },
        { status: 409 }
      );
    }

    return NextResponse.json({ data: updated, message: "Respons Anda tercatat" });
  } catch (error) {
    console.error("[offer-respond] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
