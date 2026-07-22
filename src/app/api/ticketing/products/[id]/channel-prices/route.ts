import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { requireTicketingContext } from "@/lib/ticketing/server";

const priceSchema = z.number().min(0).max(1_000_000_000).nullable();

const upsertSchema = z.object({
  channel_id: z.string().uuid(),
  prices: z
    .array(
      z.object({
        variant_id: z.string().uuid(),
        price_regular: priceSchema,
        price_high: priceSchema,
      })
    )
    // Klien mengirim SEMUA varian produk sekaligus (bukan diff) — batas
    // dilonggarkan supaya ticket ber-varian banyak tidak gagal simpan
    .min(1)
    .max(50),
});

/**
 * Simpan harga override kanal per varian (Channel Manager). NULL = ikut
 * harga varian; keduanya NULL → baris override dihapus (bersih).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = upsertSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    await withTransaction(async (client) => {
      const product = await client.query(
        `SELECT 1 FROM ticketing.ticket_products
         WHERE id = $1 AND branch_id = $2 AND company_id = $3
         FOR UPDATE`,
        [id, ctx.branchId, ctx.companyId]
      );
      if (product.rows.length === 0) {
        throw Object.assign(new Error("Ticket tidak ditemukan"), {
          statusCode: 404,
        });
      }

      const channel = await client.query(
        `SELECT 1 FROM ticketing.ticket_channels
         WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
        [body.channel_id, ctx.branchId, ctx.companyId]
      );
      if (channel.rows.length === 0) {
        throw Object.assign(new Error("Kanal tidak dikenal"), {
          statusCode: 400,
        });
      }

      // Varian yang di-update WAJIB milik ticket ini DAN masih aktif —
      // override utk varian nonaktif jadi baris hantu yang menyalakan
      // dirinya sendiri bila varian diaktifkan lagi (hasil review)
      const variantIds = body.prices.map((p) => p.variant_id);
      const owned = await client.query<{ id: string }>(
        `SELECT id FROM ticketing.ticket_product_variants
         WHERE ticket_product_id = $1 AND id = ANY($2) AND is_active = true`,
        [id, variantIds]
      );
      if (owned.rows.length !== new Set(variantIds).size) {
        throw Object.assign(
          new Error("Ada varian yang bukan milik ticket ini / sudah nonaktif"),
          { statusCode: 400 }
        );
      }

      for (const price of body.prices) {
        if (price.price_regular === null && price.price_high === null) {
          await client.query(
            `DELETE FROM ticketing.ticket_variant_channel_prices
             WHERE variant_id = $1 AND channel_id = $2`,
            [price.variant_id, body.channel_id]
          );
          continue;
        }
        await client.query(
          `INSERT INTO ticketing.ticket_variant_channel_prices
             (company_id, branch_id, variant_id, channel_id,
              price_regular, price_high)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (variant_id, channel_id) DO UPDATE SET
             price_regular = EXCLUDED.price_regular,
             price_high = EXCLUDED.price_high,
             updated_at = now()`,
          [
            ctx.companyId,
            ctx.branchId,
            price.variant_id,
            body.channel_id,
            price.price_regular,
            price.price_high,
          ]
        );
      }
    });

    return successResponse({ id }, "Harga kanal tersimpan");
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode) {
      return NextResponse.json(
        { success: false, error: (err as Error).message },
        { status: statusCode }
      );
    }
    console.error("[ticketing] channel prices error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menyimpan harga kanal" },
      { status: 500 }
    );
  }
}
