import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { requireTicketingContext } from "@/lib/ticketing/server";
import { isVariantPriceComplete } from "@/lib/ticketing/pricing";

const toggleSchema = z.object({
  channel_id: z.string().uuid(),
  is_distributed: z.boolean(),
});

/**
 * Toggle distribusi ticket ke satu kanal. Menyalakan distribusi dijaga
 * guard: ticket harus Active dan SEMUA varian aktifnya lengkap harga
 * (Regular & High — langsung di varian atau tertutup override kanal ini).
 * Mematikan selalu boleh.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = toggleSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    await withTransaction(async (client) => {
      const productResult = await client.query<{ status: string }>(
        `SELECT status FROM ticketing.ticket_products
         WHERE id = $1 AND branch_id = $2 AND company_id = $3
         FOR UPDATE`,
        [id, ctx.branchId, ctx.companyId]
      );
      const product = productResult.rows[0];
      if (!product) {
        throw Object.assign(new Error("Ticket tidak ditemukan"), {
          statusCode: 404,
        });
      }

      const channelResult = await client.query<{ id: string }>(
        `SELECT id FROM ticketing.ticket_channels
         WHERE id = $1 AND branch_id = $2 AND company_id = $3
           AND is_active = true`,
        [body.channel_id, ctx.branchId, ctx.companyId]
      );
      if (channelResult.rows.length === 0) {
        throw Object.assign(new Error("Kanal tidak dikenal"), {
          statusCode: 400,
        });
      }

      if (body.is_distributed) {
        if (product.status !== "active") {
          throw Object.assign(
            new Error("Ticket masih Draft — aktifkan dulu sebelum didistribusi"),
            { statusCode: 400 }
          );
        }
        const variantsResult = await client.query<{
          id: string;
          name: string;
          price_regular: string | null;
          price_high: string | null;
        }>(
          `SELECT id, name, price_regular, price_high
           FROM ticketing.ticket_product_variants
           WHERE ticket_product_id = $1 AND is_active = true`,
          [id]
        );
        if (variantsResult.rows.length === 0) {
          throw Object.assign(new Error("Ticket tidak punya varian aktif"), {
            statusCode: 400,
          });
        }
        const overridesResult = await client.query<{
          variant_id: string;
          price_regular: string | null;
          price_high: string | null;
        }>(
          `SELECT variant_id, price_regular, price_high
           FROM ticketing.ticket_variant_channel_prices
           WHERE channel_id = $1 AND variant_id = ANY($2)`,
          [body.channel_id, variantsResult.rows.map((v) => v.id)]
        );
        const overrideMap = new Map(
          overridesResult.rows.map((o) => [o.variant_id, o])
        );
        const toNum = (v: string | null) => (v === null ? null : Number(v));
        const incomplete = variantsResult.rows.find((v) => {
          const o = overrideMap.get(v.id);
          return !isVariantPriceComplete(
            {
              price_regular: toNum(v.price_regular),
              price_high: toNum(v.price_high),
            },
            o
              ? {
                  price_regular: toNum(o.price_regular),
                  price_high: toNum(o.price_high),
                }
              : null
          );
        });
        if (incomplete) {
          throw Object.assign(
            new Error(
              `Harga varian "${incomplete.name}" belum lengkap (Regular & High Season) untuk kanal ini`
            ),
            { statusCode: 400 }
          );
        }
      }

      await client.query(
        `INSERT INTO ticketing.ticket_product_channels
           (company_id, branch_id, ticket_product_id, channel_id, is_distributed)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (ticket_product_id, channel_id) DO UPDATE SET
           is_distributed = EXCLUDED.is_distributed, updated_at = now()`,
        [ctx.companyId, ctx.branchId, id, body.channel_id, body.is_distributed]
      );
    });

    return successResponse(
      { id, channel_id: body.channel_id, is_distributed: body.is_distributed },
      body.is_distributed ? "Ticket didistribusikan" : "Distribusi dimatikan"
    );
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode) {
      return NextResponse.json(
        { success: false, error: (err as Error).message },
        { status: statusCode }
      );
    }
    console.error("[ticketing] toggle channel error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mengubah distribusi" },
      { status: 500 }
    );
  }
}
