import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse, noContentResponse } from "@/lib/api/auth";
import { requirePromoContext } from "@/lib/promo/server";
import {
  deleteOfferRule,
  getOfferRule,
  updateOfferRule,
} from "@/lib/promo/offer-rules-server";

const itemSchema = z.object({
  role: z.enum(["component", "buy", "get", "eligible"]),
  product_id: z.string().uuid(),
  qty: z.number().positive().optional(),
  sort_order: z.number().int().optional(),
});

const updateSchema = z.object({
  offer_type: z.enum(["bundle", "bxgy", "volume"]).optional(),
  name: z.string().min(1).max(160),
  description: z.string().nullable().optional(),
  valid_from: z.string().nullable().optional(),
  valid_until: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  bundle_price: z.number().nullable().optional(),
  buy_qty: z.number().int().nullable().optional(),
  get_qty: z.number().int().nullable().optional(),
  get_mode: z.enum(["same_as_buy", "specific_products"]).nullable().optional(),
  volume_basis: z.enum(["qty", "spend"]).nullable().optional(),
  volume_min: z.number().nullable().optional(),
  discount_type: z.enum(["percent", "fixed"]).nullable().optional(),
  discount_value: z.number().nullable().optional(),
  items: z.array(itemSchema).default([]),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Ctx) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;
  const { id } = await context.params;

  try {
    const row = await getOfferRule({
      id,
      companyId: ctx.companyId,
      branchId: ctx.branchId,
    });
    if (!row) {
      return NextResponse.json(
        { success: false, error: "Aturan tidak ditemukan" },
        { status: 404 }
      );
    }
    return successResponse(row);
  } catch (err) {
    console.error("[promo/offers/:id] GET failed:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat aturan" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;
  const { id } = await context.params;

  try {
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          details: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const existing = await getOfferRule({
      id,
      companyId: ctx.companyId,
      branchId: ctx.branchId,
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Aturan tidak ditemukan" },
        { status: 404 }
      );
    }

    const updated = await updateOfferRule({
      id,
      companyId: ctx.companyId,
      branchId: ctx.branchId,
      payload: {
        ...parsed.data,
        offer_type: existing.offer_type,
      },
    });
    return successResponse(updated, "Aturan promo diperbarui");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal memperbarui";
    const status = message.includes("wajib") || message.includes("minimal") ? 400 : 500;
    if (status === 500) console.error("[promo/offers/:id] PATCH failed:", err);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function DELETE(_request: NextRequest, context: Ctx) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;
  const { id } = await context.params;

  try {
    const ok = await deleteOfferRule({
      id,
      companyId: ctx.companyId,
      branchId: ctx.branchId,
    });
    if (!ok) {
      return NextResponse.json(
        { success: false, error: "Aturan tidak ditemukan" },
        { status: 404 }
      );
    }
    return noContentResponse();
  } catch (err) {
    console.error("[promo/offers/:id] DELETE failed:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus aturan" },
      { status: 500 }
    );
  }
}
