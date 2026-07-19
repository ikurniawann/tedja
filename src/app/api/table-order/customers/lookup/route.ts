import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPgClient } from "@/lib/pg/create-client";

const lookupSchema = z.object({
  phone: z.string().trim().min(6).max(40),
  name: z.string().trim().max(160).optional(),
});

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeCustomer(customer: Record<string, unknown>) {
  return {
    id: String(customer.id),
    name: String(customer.name || ""),
    phone: String(customer.phone || ""),
    email: customer.email ? String(customer.email) : "",
    membership_tier: String(customer.membership_tier || "regular"),
    ark_coin_balance: toNumber(customer.ark_coin_balance),
    total_xp: toNumber(customer.total_xp),
    visit_count: toNumber(customer.visit_count),
    is_active: customer.is_active !== false,
  };
}

export async function POST(request: NextRequest) {
  try {
    const payload = lookupSchema.parse(await request.json());
    const db = createPgClient();

    const { data: existing, error: lookupError } = await db
      .from("pos_customers")
      .select("id, name, phone, email, membership_tier, ark_coin_balance, total_xp, visit_count, is_active")
      .eq("phone", payload.phone)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (existing) {
      return NextResponse.json({ success: true, data: normalizeCustomer(existing), created: false });
    }

    const { data: created, error: createError } = await db
      .from("pos_customers")
      .insert({
        phone: payload.phone,
        name: payload.name || `Member ${payload.phone.slice(-4)}`,
        membership_tier: "regular",
        notes: "Created from table self-service ordering",
      })
      .select("id, name, phone, email, membership_tier, ark_coin_balance, total_xp, visit_count, is_active")
      .single();

    if (createError) throw createError;

    return NextResponse.json({ success: true, data: normalizeCustomer(created), created: true }, { status: 201 });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Gagal lookup customer" },
      { status }
    );
  }
}
