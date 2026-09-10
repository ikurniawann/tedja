import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError } from "@/lib/api/auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = await createServerPgClient();
    const { id } = await params;

    const { data, error } = await db
      .from("grn_items")
      .select(
        `
        *,
        raw_material:raw_materials!raw_material_id(*),
        satuan:units!satuan_id(*),
        purchase_order_item:purchase_order_items!purchase_order_item_id(*),
        pos_sku:pos_product_skus!pos_sku_id(id, sku, name)
      `
      )
      .eq("grn_id", id)
      .eq("is_active", true)
      .order("created_at");

    if (error) throw error;

    return NextResponse.json({ data: data || [] });
  } catch (error: unknown) {
    console.error("Error fetching GRN items:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch GRN items";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = await createServerPgClient();
    const { id } = await params;
    const body = await request.json();

    const { data: grn } = await db
      .from("grn")
      .select("status")
      .eq("id", id)
      .single();

    if (!grn || grn.status !== "pending") {
      return ApiError.badRequest("Cannot add items to GRN that is not pending").toResponse();
    }

    const { data, error } = await db
      .from("grn_items")
      .insert({
        ...body,
        grn_id: id,
        raw_material_id: body.raw_material_id || body.bahan_baku_id,
        satuan_id: body.satuan_id,
      })
      .select(
        `
        *,
        raw_material:raw_materials!raw_material_id(*),
        satuan:units!satuan_id(*)
      `
      )
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (error: unknown) {
    console.error("Error creating GRN item:", error);
    const message = error instanceof Error ? error.message : "Failed to create GRN item";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
