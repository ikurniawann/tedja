import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse, createdResponse } from "@/lib/api/auth";
import { requirePromoContext } from "@/lib/promo/server";
import {
  createOfferRule,
  listOfferRules,
} from "@/lib/promo/offer-rules-server";
import type { OfferType } from "@/lib/promo/offer-rules";

const itemSchema = z.object({
  role: z.enum(["component", "buy", "get", "eligible"]),
  product_id: z.string().uuid(),
  qty: z.number().positive().optional(),
  sort_order: z.number().int().optional(),
});

const createSchema = z.object({
  offer_type: z.enum(["bundle", "bxgy", "volume"]),
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

export async function GET(request: NextRequest) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  const type = request.nextUrl.searchParams.get("type") as OfferType | null;
  if (!type || !["bundle", "bxgy", "volume"].includes(type)) {
    return NextResponse.json(
      { success: false, error: "Query type=bundle|bxgy|volume wajib" },
      { status: 400 }
    );
  }

  try {
    const rows = await listOfferRules({
      companyId: ctx.companyId,
      branchId: ctx.branchId,
      offerType: type,
    });
    return successResponse(rows);
  } catch (err) {
    console.error("[promo/offers] GET failed:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat aturan promo" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const parsed = createSchema.safeParse(await request.json());
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

    const created = await createOfferRule({
      companyId: ctx.companyId,
      branchId: ctx.branchId,
      userId: ctx.user.id,
      payload: parsed.data,
    });
    return createdResponse(created, "Aturan promo dibuat");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal membuat aturan";
    const status = message.includes("wajib") || message.includes("minimal") ? 400 : 500;
    if (status === 500) console.error("[promo/offers] POST failed:", err);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
