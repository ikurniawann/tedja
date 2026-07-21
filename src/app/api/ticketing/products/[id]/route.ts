import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { RE_ENTRY_POLICIES, requireTicketingContext } from "@/lib/ticketing/server";

interface ProductRow {
  id: string;
  code: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  status: "draft" | "active";
  base_price: string;
  thumbnail_url: string | null;
  description: string | null;
  re_entry_policy: string;
  created_at: string;
  updated_at: string;
}

/** Detail ticket + varian + kalender + distribusi kanal. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const { id } = await params;
    const product = await queryOne<ProductRow>(
      `SELECT tp.id, tp.code, tp.name, tp.category_id, c.name AS category_name,
              tp.status, tp.base_price, tp.thumbnail_url, tp.description,
              tp.re_entry_policy, tp.created_at, tp.updated_at
       FROM ticketing.ticket_products tp
       LEFT JOIN ticketing.ticket_categories c ON c.id = tp.category_id
       WHERE tp.id = $1 AND tp.branch_id = $2 AND tp.company_id = $3`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (!product) {
      return NextResponse.json(
        { success: false, error: "Ticket tidak ditemukan" },
        { status: 404 }
      );
    }

    const [variants, dates, channels] = await Promise.all([
      query(
        `SELECT id, code, name, price_regular, price_high, sort_order, is_active
         FROM ticketing.ticket_product_variants
         WHERE ticket_product_id = $1
         ORDER BY sort_order`,
        [id]
      ),
      query(
        `SELECT id, date_kind, label, start_date::text AS start_date,
                end_date::text AS end_date, is_active
         FROM ticketing.ticket_product_dates
         WHERE ticket_product_id = $1
         ORDER BY start_date`,
        [id]
      ),
      query(
        `SELECT pc.id, ch.code AS channel_code, ch.name AS channel_name,
                ch.is_online, pc.is_distributed
         FROM ticketing.ticket_product_channels pc
         JOIN ticketing.ticket_channels ch ON ch.id = pc.channel_id
         WHERE pc.ticket_product_id = $1
         ORDER BY ch.sort_order`,
        [id]
      ),
    ]);

    return successResponse({
      product: { ...product, base_price: Number(product.base_price) },
      variants: variants.map((v) => ({
        ...v,
        price_regular: v.price_regular === null ? null : Number(v.price_regular),
        price_high: v.price_high === null ? null : Number(v.price_high),
      })),
      dates,
      channels,
    });
  } catch (err) {
    console.error("[ticketing] product detail error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat detail ticket" },
      { status: 500 }
    );
  }
}

const priceSchema = z.number().min(0).max(1_000_000_000).nullable();

const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  category_id: z.string().uuid().optional().nullable(),
  category_name: z.string().trim().max(100).optional().nullable(),
  status: z.enum(["draft", "active"]).optional(),
  base_price: z.number().min(0).max(1_000_000_000).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  re_entry_policy: z.enum(RE_ENTRY_POLICIES).optional(),
  variants: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(60).optional(),
        price_regular: priceSchema.optional(),
        price_high: priceSchema.optional(),
        is_active: z.boolean().optional(),
      })
    )
    .max(10)
    .optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = updateProductSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    await withTransaction(async (client) => {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM ticketing.ticket_products
         WHERE id = $1 AND branch_id = $2 AND company_id = $3
         FOR UPDATE`,
        [id, ctx.branchId, ctx.companyId]
      );
      if (existing.rows.length === 0) {
        throw Object.assign(new Error("Ticket tidak ditemukan"), {
          statusCode: 404,
        });
      }

      let categoryId = body.category_id;
      if (categoryId) {
        // id kiriman klien WAJIB milik venue ini (anti-IDOR lintas tenant)
        const owned = await client.query(
          `SELECT 1 FROM ticketing.ticket_categories
           WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
          [categoryId, ctx.branchId, ctx.companyId]
        );
        if (owned.rows.length === 0) {
          throw Object.assign(new Error("Kategori tidak dikenal"), {
            statusCode: 400,
          });
        }
      }
      if (categoryId === undefined && body.category_name) {
        const catResult = await client.query<{ id: string }>(
          `INSERT INTO ticketing.ticket_categories
             (company_id, branch_id, name, created_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (branch_id, lower(name)) DO UPDATE SET updated_at = now()
           RETURNING id`,
          [ctx.companyId, ctx.branchId, body.category_name, ctx.user.id]
        );
        categoryId = catResult.rows[0].id;
      }

      const sets: string[] = ["updated_at = now()"];
      const values: unknown[] = [];
      const add = (column: string, value: unknown) => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      };
      if (body.name !== undefined) add("name", body.name);
      if (categoryId !== undefined) add("category_id", categoryId);
      if (body.status !== undefined) add("status", body.status);
      if (body.base_price !== undefined) add("base_price", body.base_price);
      if (body.description !== undefined) add("description", body.description || null);
      if (body.re_entry_policy !== undefined) {
        add("re_entry_policy", body.re_entry_policy);
      }

      if (values.length > 0) {
        values.push(id);
        await client.query(
          `UPDATE ticketing.ticket_products SET ${sets.join(", ")}
           WHERE id = $${values.length}`,
          values
        );
      }

      for (const variant of body.variants ?? []) {
        const vSets: string[] = ["updated_at = now()"];
        const vValues: unknown[] = [];
        const vAdd = (column: string, value: unknown) => {
          vValues.push(value);
          vSets.push(`${column} = $${vValues.length}`);
        };
        if (variant.name !== undefined) vAdd("name", variant.name);
        if (variant.price_regular !== undefined) {
          vAdd("price_regular", variant.price_regular);
        }
        if (variant.price_high !== undefined) vAdd("price_high", variant.price_high);
        if (variant.is_active !== undefined) vAdd("is_active", variant.is_active);
        if (vValues.length === 0) continue;

        vValues.push(variant.id, id);
        await client.query(
          `UPDATE ticketing.ticket_product_variants SET ${vSets.join(", ")}
           WHERE id = $${vValues.length - 1}
             AND ticket_product_id = $${vValues.length}`,
          vValues
        );
      }
    });

    return successResponse({ id }, "Ticket tersimpan");
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode) {
      return NextResponse.json(
        { success: false, error: (err as Error).message },
        { status: statusCode }
      );
    }
    console.error("[ticketing] update product error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menyimpan ticket" },
      { status: 500 }
    );
  }
}
