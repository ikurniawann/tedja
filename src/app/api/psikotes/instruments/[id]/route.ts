import { NextRequest, NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { instrumentUpdateSchema } from "@/lib/validations/psikotes";

/**
 * PUT /api/psikotes/instruments/[id] — update nama / aktif / config.
 * `code` dan `kind` immutable (dipakai engine scoring & seed).
 * Config di-merge (jsonb ||) supaya key lama tidak hilang saat partial update.
 */

const WRITE_ROLES = ["super_admin", "admin", "hrd"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiRole([...WRITE_ROLES]);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID instrumen tidak valid" }, { status: 400 });
    }

    // key ke user.id — X-Forwarded-For bisa dipalsukan client
    const rateLimit = checkRateLimit(`psikotes_instrument_put_${user.id}`);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = instrumentUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: first ? `${first.path.join(".")}: ${first.message}` : "Payload tidak valid" },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const updated = await queryOne(
      `UPDATE recruitment.psikotes_instruments SET
         name      = COALESCE($2, name),
         is_active = COALESCE($3, is_active),
         config    = CASE WHEN $4::jsonb IS NULL THEN config ELSE config || $4::jsonb END
       WHERE id = $1
       RETURNING id, code, name, kind, config, is_active, sort_order, created_at, updated_at`,
      [
        id,
        input.name ?? null,
        input.is_active ?? null,
        input.config ? JSON.stringify(input.config) : null,
      ]
    );
    if (!updated) {
      return NextResponse.json({ error: "Instrumen tidak ditemukan" }, { status: 404 });
    }

    return NextResponse.json({ data: updated, message: "Instrumen tersimpan" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[psikotes-instrument] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
