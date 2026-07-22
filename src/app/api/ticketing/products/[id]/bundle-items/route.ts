import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { requireTicketingContext } from "@/lib/ticketing/server";

// Fase P — susun komposisi paket (replace-all, pola channel-prices):
// komponen = varian dari tiket SATUAN Active milik venue. Paket-dalam-
// paket ditolak di sini; paket Active tidak boleh dikosongkan komposisinya
// (guard aktivasi di PATCH produk memeriksa hal yang sama saat naik status).

const MAX_BUNDLE_COMPONENTS = 10;

const putSchema = z.object({
  items: z
    .array(
      z.object({
        component_variant_id: z.string().uuid(),
        qty: z.number().int().min(1).max(20),
      })
    )
    .max(MAX_BUNDLE_COMPONENTS),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = putSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const items = parsed.data.items;

    const variantIds = items.map((i) => i.component_variant_id);
    if (new Set(variantIds).size !== variantIds.length) {
      return NextResponse.json(
        { success: false, error: "Ada komponen yang sama dipilih dua kali" },
        { status: 400 }
      );
    }

    await withTransaction(async (client) => {
      const productResult = await client.query<{
        product_kind: "single" | "bundle";
        status: "draft" | "active";
      }>(
        `SELECT product_kind, status FROM ticketing.ticket_products
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
      if (product.product_kind !== "bundle") {
        throw Object.assign(
          new Error("Komposisi hanya berlaku untuk produk paket"),
          { statusCode: 400 }
        );
      }
      if (product.status === "active" && items.length === 0) {
        throw Object.assign(
          new Error(
            "Paket Active tidak boleh tanpa komposisi — turunkan ke Draft dulu"
          ),
          { statusCode: 400 }
        );
      }

      if (variantIds.length > 0) {
        // Komponen sah = varian aktif milik venue dari produk SATUAN
        // Active (paket-dalam-paket & produk draft tertolak di sini)
        const validResult = await client.query<{ id: string }>(
          `SELECT pv.id
           FROM ticketing.ticket_product_variants pv
           JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
           WHERE pv.id = ANY($1) AND pv.branch_id = $2 AND pv.company_id = $3
             AND pv.is_active = true AND tp.status = 'active'
             AND tp.product_kind = 'single'`,
          [variantIds, ctx.branchId, ctx.companyId]
        );
        if (validResult.rows.length !== variantIds.length) {
          throw Object.assign(
            new Error(
              "Ada komponen yang bukan tiket satuan Active — paket hanya boleh berisi varian tiket satuan yang aktif"
            ),
            { statusCode: 400 }
          );
        }
      }

      await client.query(
        `DELETE FROM ticketing.ticket_bundle_items WHERE bundle_product_id = $1`,
        [id]
      );
      for (const [index, item] of items.entries()) {
        await client.query(
          `INSERT INTO ticketing.ticket_bundle_items
             (company_id, branch_id, bundle_product_id, component_variant_id,
              qty, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            ctx.companyId,
            ctx.branchId,
            id,
            item.component_variant_id,
            item.qty,
            (index + 1) * 10,
          ]
        );
      }
    });

    return successResponse({ id }, "Komposisi paket tersimpan");
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode) {
      return NextResponse.json(
        { success: false, error: (err as Error).message },
        { status: statusCode }
      );
    }
    console.error("[ticketing] save bundle items error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menyimpan komposisi paket" },
      { status: 500 }
    );
  }
}
