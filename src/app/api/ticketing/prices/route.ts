import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, withTransaction } from "@/lib/db";
import { findPriceGaps, type PriceEntry } from "@/lib/ticketing/pricing";
import { SEASON_KINDS, requireTicketingContext } from "@/lib/ticketing/server";

/**
 * GET → matriks harga lengkap + daftar lubang (kombinasi tipe aktif ×
 * musim × kanal aktif yang belum punya harga). UI grid memakai ini utuh.
 */
export async function GET() {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const [prices, types, channels] = await Promise.all([
      query<PriceEntry & { id: string }>(
        `SELECT id, ticket_type_id, season_kind, channel_id, price::float8 AS price
         FROM ticketing.ticket_prices
         WHERE branch_id = $1 AND company_id = $2`,
        [ctx.branchId, ctx.companyId]
      ),
      query<{ id: string; is_active: boolean }>(
        `SELECT id, is_active FROM ticketing.ticket_types
         WHERE branch_id = $1 AND company_id = $2`,
        [ctx.branchId, ctx.companyId]
      ),
      query<{ id: string; is_active: boolean }>(
        `SELECT id, is_active FROM ticketing.ticket_channels
         WHERE branch_id = $1 AND company_id = $2`,
        [ctx.branchId, ctx.companyId]
      ),
    ]);

    const gaps = findPriceGaps(
      types.filter((t) => t.is_active).map((t) => t.id),
      channels.filter((c) => c.is_active).map((c) => c.id),
      prices
    );
    return successResponse({ prices, gaps });
  } catch (err) {
    console.error("[ticketing] get price matrix error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat matriks harga" },
      { status: 500 }
    );
  }
}

const priceEntrySchema = z.object({
  ticket_type_id: z.string().uuid(),
  season_kind: z.enum(SEASON_KINDS),
  channel_id: z.string().uuid(),
  price: z.number().min(0).max(1_000_000_000),
});

const putPricesSchema = z.object({
  entries: z.array(priceEntrySchema).min(1).max(500),
});

/** PUT → upsert massal dari grid (satu transaksi, semua-atau-tidak). */
export async function PUT(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const parsed = putPricesSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { entries } = parsed.data;

    // Tolak bila ada tipe/kanal di luar venue user (anti cross-tenant)
    const typeIds = [...new Set(entries.map((e) => e.ticket_type_id))];
    const channelIds = [...new Set(entries.map((e) => e.channel_id))];
    const [validTypes, validChannels] = await Promise.all([
      query<{ id: string }>(
        `SELECT id FROM ticketing.ticket_types
         WHERE branch_id = $1 AND company_id = $2 AND id = ANY($3::uuid[])`,
        [ctx.branchId, ctx.companyId, typeIds]
      ),
      query<{ id: string }>(
        `SELECT id FROM ticketing.ticket_channels
         WHERE branch_id = $1 AND company_id = $2 AND id = ANY($3::uuid[])`,
        [ctx.branchId, ctx.companyId, channelIds]
      ),
    ]);
    if (validTypes.length !== typeIds.length || validChannels.length !== channelIds.length) {
      return NextResponse.json(
        { success: false, error: "Jenis tiket / kanal di luar venue Anda" },
        { status: 403 }
      );
    }

    await withTransaction(async (client) => {
      for (const entry of entries) {
        await client.query(
          `INSERT INTO ticketing.ticket_prices
             (company_id, branch_id, ticket_type_id, season_kind, channel_id, price, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (ticket_type_id, season_kind, channel_id)
           DO UPDATE SET price = EXCLUDED.price, updated_at = now()`,
          [
            ctx.companyId,
            ctx.branchId,
            entry.ticket_type_id,
            entry.season_kind,
            entry.channel_id,
            entry.price,
            ctx.user.id,
          ]
        );
      }
    });
    return successResponse({ saved: entries.length }, "Matriks harga tersimpan");
  } catch (err) {
    console.error("[ticketing] save price matrix error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menyimpan matriks harga" },
      { status: 500 }
    );
  }
}
