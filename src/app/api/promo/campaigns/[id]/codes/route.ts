import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { generateVoucherCode, requirePromoContext } from "@/lib/promo/server";

// EPIC-032 A3 — kode di bawah satu campaign: list + tambah kode publik
// tunggal ATAU generate batch voucher sekali-pakai (usage_limit=1).
// Export CSV dilakukan klien dari hasil GET (tanpa route khusus).

interface CodeRow {
  id: string;
  code: string;
  usage_limit: number | null;
  usage_count: number;
  is_active: boolean;
  created_at: string;
}

const MAX_BATCH = 1000;

async function assertCampaign(
  id: string,
  branchId: string,
  companyId: string
): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM promo.promo_campaigns
     WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
    [id, branchId, companyId]
  );
  return row !== null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const { id } = await params;
    if (!(await assertCampaign(id, ctx.branchId, ctx.companyId))) {
      return NextResponse.json(
        { success: false, error: "Campaign tidak ditemukan" },
        { status: 404 }
      );
    }
    const rows = await query<CodeRow>(
      `SELECT id, code, usage_limit, usage_count, is_active, created_at
       FROM promo.promo_codes
       WHERE campaign_id = $1
       ORDER BY created_at DESC, code
       LIMIT 2000`,
      [id]
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[promo] list codes error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat kode" },
      { status: 500 }
    );
  }
}

const createSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("single"),
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{3,40}$/, "Kode: huruf/angka/strip, 3-40 karakter"),
    // null = ikut limit campaign (kode publik); isi utk membatasi kode ini
    usage_limit: z.number().int().positive().max(1_000_000).nullable().default(null),
  }),
  z.object({
    mode: z.literal("batch"),
    prefix: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{2,12}$/, "Prefix: huruf/angka, 2-12 karakter"),
    count: z.number().int().min(1).max(MAX_BATCH),
  }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const { id } = await params;
    if (!(await assertCampaign(id, ctx.branchId, ctx.companyId))) {
      return NextResponse.json(
        { success: false, error: "Campaign tidak ditemukan" },
        { status: 404 }
      );
    }
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    if (body.mode === "single") {
      const rows = await query<CodeRow>(
        `INSERT INTO promo.promo_codes
           (company_id, branch_id, campaign_id, code, usage_limit)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, code, usage_limit, usage_count, is_active, created_at`,
        [ctx.companyId, ctx.branchId, id, body.code.toUpperCase(), body.usage_limit]
      );
      return successResponse(rows[0], "Kode ditambahkan");
    }

    // Batch voucher: generate kode unik ber-prefix; tabrakan (antar batch /
    // dalam batch) di-skip ON CONFLICT lalu diisi ulang — maks 6 ronde.
    const prefix = body.prefix.toUpperCase();
    const created: string[] = [];
    await withTransaction(async (client) => {
      for (let round = 0; round < 6 && created.length < body.count; round++) {
        const need = body.count - created.length;
        const candidates = new Set<string>();
        while (candidates.size < need) {
          candidates.add(generateVoucherCode(prefix));
        }
        const inserted = await client.query<{ code: string }>(
          `INSERT INTO promo.promo_codes
             (company_id, branch_id, campaign_id, code, usage_limit)
           SELECT $1, $2, $3, unnest($4::text[]), 1
           ON CONFLICT (branch_id, code) DO NOTHING
           RETURNING code`,
          [ctx.companyId, ctx.branchId, id, [...candidates]]
        );
        created.push(...inserted.rows.map((r) => r.code));
      }
      if (created.length < body.count) {
        throw new Error(
          `Hanya ${created.length}/${body.count} kode berhasil dibuat — coba prefix lain`
        );
      }
    });
    return successResponse(
      { count: created.length, codes: created },
      `${created.length} voucher dibuat`
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { success: false, error: "Kode sudah dipakai — pilih kode lain" },
        { status: 409 }
      );
    }
    console.error("[promo] create codes error:", err);
    return NextResponse.json(
      { success: false, error: (err as Error).message || "Gagal membuat kode" },
      { status: 500 }
    );
  }
}

const syncSchema = z.object({
  target_count: z.number().int().min(0).max(MAX_BATCH),
  prefix: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{2,12}$/, "Prefix: huruf/angka, 2-12 karakter")
    .optional(),
});

function inferPrefix(codes: string[]): string | null {
  for (const code of codes) {
    const match = /^([A-Z0-9]{2,12})-/.exec(code.toUpperCase());
    if (match) return match[1];
  }
  return null;
}

/** Samakan jumlah voucher campaign (hanya jika belum ada yang terpakai). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const { id } = await params;
    if (!(await assertCampaign(id, ctx.branchId, ctx.companyId))) {
      return NextResponse.json(
        { success: false, error: "Campaign tidak ditemukan" },
        { status: 404 }
      );
    }

    const parsed = syncSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { target_count: targetCount } = parsed.data;

    const usage = await queryOne<{ captured: string; used_codes: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM promo.promo_redemptions r
           WHERE r.campaign_id = $1 AND r.status = 'captured') AS captured,
         (SELECT COUNT(*)::text FROM promo.promo_codes c
           WHERE c.campaign_id = $1 AND c.usage_count > 0) AS used_codes`,
      [id]
    );
    if (Number(usage?.captured) > 0 || Number(usage?.used_codes) > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Sudah ada voucher terpakai — jumlah tidak bisa diubah",
        },
        { status: 409 }
      );
    }

    const existing = await query<{ id: string; code: string }>(
      `SELECT id, code FROM promo.promo_codes
       WHERE campaign_id = $1 AND branch_id = $2 AND company_id = $3
       ORDER BY created_at DESC, code`,
      [id, ctx.branchId, ctx.companyId]
    );
    const currentCount = existing.length;
    if (targetCount === currentCount) {
      return successResponse(
        { count: currentCount, added: 0, removed: 0 },
        "Jumlah voucher tidak berubah"
      );
    }

    if (targetCount < currentCount) {
      const toRemove = currentCount - targetCount;
      const ids = existing.slice(0, toRemove).map((row) => row.id);
      await withTransaction(async (client) => {
        await client.query(
          `DELETE FROM promo.promo_redemptions
           WHERE code_id = ANY($1::uuid[]) AND status IN ('held', 'released')`,
          [ids]
        );
        await client.query(
          `DELETE FROM promo.promo_codes
           WHERE id = ANY($1::uuid[]) AND usage_count = 0`,
          [ids]
        );
      });
      return successResponse(
        { count: targetCount, added: 0, removed: toRemove },
        `${toRemove} voucher dihapus`
      );
    }

    const need = targetCount - currentCount;
    const prefix = (
      parsed.data.prefix?.toUpperCase() ||
      inferPrefix(existing.map((row) => row.code)) ||
      ""
    ).trim();
    if (!/^[A-Z0-9]{2,12}$/.test(prefix)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Prefix tidak tersedia — pastikan kanal campaign valid atau isi prefix",
        },
        { status: 400 }
      );
    }

    const created: string[] = [];
    await withTransaction(async (client) => {
      for (let round = 0; round < 6 && created.length < need; round++) {
        const gap = need - created.length;
        const candidates = new Set<string>();
        while (candidates.size < gap) {
          candidates.add(generateVoucherCode(prefix));
        }
        const inserted = await client.query<{ code: string }>(
          `INSERT INTO promo.promo_codes
             (company_id, branch_id, campaign_id, code, usage_limit)
           SELECT $1, $2, $3, unnest($4::text[]), 1
           ON CONFLICT (branch_id, code) DO NOTHING
           RETURNING code`,
          [ctx.companyId, ctx.branchId, id, [...candidates]]
        );
        created.push(...inserted.rows.map((r) => r.code));
      }
      if (created.length < need) {
        throw new Error(
          `Hanya ${created.length}/${need} kode berhasil ditambah — coba prefix lain`
        );
      }
    });

    return successResponse(
      { count: targetCount, added: created.length, removed: 0 },
      `${created.length} voucher ditambah`
    );
  } catch (err) {
    console.error("[promo] sync codes error:", err);
    return NextResponse.json(
      {
        success: false,
        error: (err as Error).message || "Gagal mengubah jumlah voucher",
      },
      { status: 500 }
    );
  }
}
