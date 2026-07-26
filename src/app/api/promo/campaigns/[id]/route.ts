import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { isValidCalendarDate } from "@/lib/ticketing/pricing";
import { requirePromoContext } from "@/lib/promo/server";

// EPIC-032 A3 — edit satu campaign (toggle aktif, window, limit, nilai).
// Snapshot di redemptions menjaga riwayat: edit tidak mengubah pemakaian lama.

const dateField = z
  .string()
  .refine(isValidCalendarDate, "Tanggal tidak valid")
  .nullable()
  .optional();

const patchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  value: z.number().positive().max(1_000_000_000).optional(),
  max_discount: z.number().positive().max(1_000_000_000).nullable().optional(),
  min_purchase: z.number().min(0).max(1_000_000_000).optional(),
  valid_from: dateField,
  valid_until: dateField,
  usage_limit: z.number().int().positive().max(1_000_000).nullable().optional(),
  per_phone_limit: z.number().int().positive().max(100).nullable().optional(),
  scope: z.enum(["ticketing_online", "ticketing_loket", "pos", "semua"]).optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const current = await queryOne<{
      discount_type: string;
      value: string;
      valid_from: string | null;
      valid_until: string | null;
    }>(
      `SELECT discount_type, value, valid_from::text AS valid_from,
              valid_until::text AS valid_until
       FROM promo.promo_campaigns
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (!current) {
      return NextResponse.json(
        { success: false, error: "Campaign tidak ditemukan" },
        { status: 404 }
      );
    }

    // Validasi pakai nilai FINAL gabungan (pola capacity-dates PATCH)
    const finalValue = body.value ?? Number(current.value);
    if (current.discount_type === "percent" && finalValue > 100) {
      return NextResponse.json(
        { success: false, error: "Diskon persen maksimal 100" },
        { status: 400 }
      );
    }
    const finalFrom =
      body.valid_from !== undefined ? body.valid_from : current.valid_from;
    const finalUntil =
      body.valid_until !== undefined ? body.valid_until : current.valid_until;
    if (finalFrom && finalUntil && finalUntil < finalFrom) {
      return NextResponse.json(
        { success: false, error: "Tanggal akhir sebelum tanggal mulai" },
        { status: 400 }
      );
    }

    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (body.name !== undefined) add("name", body.name);
    if (body.description !== undefined) add("description", body.description);
    if (body.value !== undefined) add("value", body.value);
    if (body.max_discount !== undefined) add("max_discount", body.max_discount);
    if (body.min_purchase !== undefined) add("min_purchase", body.min_purchase);
    if (body.valid_from !== undefined) add("valid_from", body.valid_from);
    if (body.valid_until !== undefined) add("valid_until", body.valid_until);
    if (body.usage_limit !== undefined) add("usage_limit", body.usage_limit);
    if (body.per_phone_limit !== undefined) {
      add("per_phone_limit", body.per_phone_limit);
    }
    if (body.scope !== undefined) add("scope", body.scope);
    if (body.is_active !== undefined) add("is_active", body.is_active);

    values.push(id, ctx.branchId, ctx.companyId);
    await query(
      `UPDATE promo.promo_campaigns SET ${sets.join(", ")}
       WHERE id = $${values.length - 2} AND branch_id = $${values.length - 1}
         AND company_id = $${values.length}`,
      values
    );
    return successResponse({ id }, "Campaign diperbarui");
  } catch (err) {
    console.error("[promo] update campaign error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui campaign" },
      { status: 500 }
    );
  }
}
