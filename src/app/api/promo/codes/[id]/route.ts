import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requirePromoContext } from "@/lib/promo/server";

// Toggle aktif selalu boleh. Rename / hapus hanya jika usage_count = 0
// (voucher belum pernah terpakai).

const patchSchema = z.object({
  is_active: z.boolean().optional(),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{3,40}$/, "Kode: huruf/angka/strip, 3-40 karakter")
    .optional(),
  usage_limit: z.number().int().positive().max(1_000_000).nullable().optional(),
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
    if (
      body.is_active === undefined &&
      body.code === undefined &&
      body.usage_limit === undefined
    ) {
      return NextResponse.json(
        { success: false, error: "Tidak ada field yang diubah" },
        { status: 400 }
      );
    }

    const current = await queryOne<{ id: string; usage_count: number }>(
      `SELECT id, usage_count
       FROM promo.promo_codes
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (!current) {
      return NextResponse.json(
        { success: false, error: "Kode tidak ditemukan" },
        { status: 404 }
      );
    }

    const editsCode =
      body.code !== undefined || body.usage_limit !== undefined;
    if (editsCode && Number(current.usage_count) > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Voucher sudah terpakai — hanya status aktif yang boleh diubah",
        },
        { status: 409 }
      );
    }

    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (body.is_active !== undefined) add("is_active", body.is_active);
    if (body.code !== undefined) add("code", body.code.toUpperCase());
    if (body.usage_limit !== undefined) add("usage_limit", body.usage_limit);

    values.push(id, ctx.branchId, ctx.companyId);
    const rows = await query<{ id: string }>(
      `UPDATE promo.promo_codes SET ${sets.join(", ")}
       WHERE id = $${values.length - 2} AND branch_id = $${values.length - 1}
         AND company_id = $${values.length}
       RETURNING id`,
      values
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Kode tidak ditemukan" },
        { status: 404 }
      );
    }
    return successResponse({ id }, "Kode diperbarui");
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { success: false, error: "Kode sudah dipakai — pilih kode lain" },
        { status: 409 }
      );
    }
    console.error("[promo] update code error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui kode" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const { id } = await params;
    const current = await queryOne<{ id: string; usage_count: number }>(
      `SELECT id, usage_count
       FROM promo.promo_codes
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (!current) {
      return NextResponse.json(
        { success: false, error: "Kode tidak ditemukan" },
        { status: 404 }
      );
    }
    if (Number(current.usage_count) > 0) {
      return NextResponse.json(
        { success: false, error: "Voucher sudah terpakai — tidak bisa dihapus" },
        { status: 409 }
      );
    }

    // Hapus hold/released orphan untuk kode ini bila ada (belum captured)
    await query(
      `DELETE FROM promo.promo_redemptions
       WHERE code_id = $1 AND status IN ('held', 'released')`,
      [id]
    );
    const rows = await query<{ id: string }>(
      `DELETE FROM promo.promo_codes
       WHERE id = $1 AND branch_id = $2 AND company_id = $3
         AND usage_count = 0
       RETURNING id`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Gagal menghapus kode" },
        { status: 409 }
      );
    }
    return successResponse({ id }, "Kode dihapus");
  } catch (err) {
    console.error("[promo] delete code error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus kode" },
      { status: 500 }
    );
  }
}
