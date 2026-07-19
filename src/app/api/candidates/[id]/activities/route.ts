import { NextRequest, NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * POST /api/candidates/[id]/activities — catat aktivitas manual dari UI.
 * Whitelist ketat: saat ini hanya pembukaan template WhatsApp (AC epic:
 * "template WA membuka wa.me + tercatat di aktivitas").
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ALLOWED_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WA_TEMPLATE_LABELS: Record<string, string> = {
  undangan_screening: "Undangan Screening",
  lolos_psikotes: "Lolos → Lanjut Psikotes",
  undangan_psikotes: "Undangan Psikotes Online",
  undangan_interview: "Undangan Interview AI",
  lolos_interview: "Lolos → Lanjut Interview",
  lolos_offer: "Lolos → Lanjut Offer",
  offer_terkirim: "Penawaran Kerja Terkirim",
  penolakan: "Penolakan Halus",
};

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireApiRole([...ALLOWED_ROLES]);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID kandidat tidak valid" }, { status: 400 });
    }

    // key ke user.id — X-Forwarded-For bisa dipalsukan client
    const rateLimit = checkRateLimit(`candidate_activities_post_${user.id}`);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }

    const body: unknown = await req.json().catch(() => null);
    const template =
      typeof body === "object" && body !== null && "template" in body &&
      typeof (body as { template: unknown }).template === "string"
        ? (body as { template: string }).template
        : "";
    const label = WA_TEMPLATE_LABELS[template];
    if (!label) {
      return NextResponse.json({ error: "Template tidak dikenal" }, { status: 400 });
    }

    const candidate = await queryOne<{ id: string }>(
      "SELECT id FROM recruitment.candidates WHERE id = $1",
      [id]
    );
    if (!candidate) {
      return NextResponse.json({ error: "Kandidat tidak ditemukan" }, { status: 404 });
    }

    const rows = await query(
      `INSERT INTO recruitment.candidate_activities
         (candidate_id, activity_type, description, created_by, created_by_name)
       VALUES ($1, 'wa_template_sent', $2, $3, $4)
       RETURNING id, candidate_id, activity_type, description, created_by, created_by_name, created_at`,
      [id, `Template WA "${label}" dibuka`, user.id, user.full_name]
    );

    return NextResponse.json({ data: rows[0], message: "Aktivitas tercatat" }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[candidate-activities] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
