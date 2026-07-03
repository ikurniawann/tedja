import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getApiUserScope } from "@/lib/api/scope";
import {
  enrichPurchaseReturnsWithGrn,
  listScopedQcCompletedGrnIds,
} from "@/lib/purchasing/purchase-returns";
import {
  assertReturnEditable,
  replacePurchaseReturnItems,
  validateReturnLineItems,
} from "@/lib/purchasing/purchase-return-service";

const updateReturnSchema = z.object({
  return_date: z.string().min(1),
  reason_type: z.enum([
    "damaged",
    "wrong_item",
    "expired",
    "overstock",
    "specification_mismatch",
    "other",
  ]),
  reason_notes: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z
    .array(
      z.object({
        grn_item_id: z.string().uuid(),
        raw_material_id: z.string().uuid().optional(),
        product_id: z.string().uuid().optional(),
        qty_returned: z.number().positive(),
        unit_cost: z.number().min(0),
        batch_number: z.string().optional().nullable(),
        expiry_date: z.string().optional().nullable(),
        condition_notes: z.string().optional().nullable(),
      })
    )
    .min(1),
});

// GET /api/purchasing/returns/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const { id } = await params;

    const { data, error } = await db
      .from("purchase_returns")
      .select(
        `
        *,
        supplier:suppliers (
          id,
          nama_supplier
        ),
        vendor:vendors (
          id,
          name
        ),
        grn:grn (
          id,
          nomor_grn
        ),
        items:purchase_return_items (
          id,
          return_id,
          grn_item_id,
          raw_material_id,
          product_id,
          qty_returned,
          unit_cost,
          subtotal,
          batch_number,
          expiry_date,
          condition_notes,
          qc_status,
          created_at,
          grn_item:grn_items (
            warehouse_id,
            warehouse:warehouses (
              name
            )
          ),
          raw_material:raw_materials (
            kode,
            nama
          ),
          product:products (
            kode,
            nama
          )
        )
      `
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return NextResponse.json(
        { success: false, message: "Purchase return not found" },
        { status: 404 }
      );
    }

    if (data.grn_id) {
      const scopedGrnIds = await listScopedQcCompletedGrnIds(db, scope);
      if (!scopedGrnIds.includes(data.grn_id)) {
        return NextResponse.json(
          { success: false, message: "Purchase return not found" },
          { status: 404 }
        );
      }
    }

    const [enriched] = await enrichPurchaseReturnsWithGrn(db, [data]);

    return NextResponse.json({
      success: true,
      data: enriched,
    });
  } catch (error: unknown) {
    console.error("Error fetching purchase return:", error);
    const message =
      error instanceof Error ? error.message : "Failed to load purchase return";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

// PATCH /api/purchasing/returns/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const { id } = await params;
    const body = updateReturnSchema.parse(await request.json());

    const { data: currentReturn, error: fetchError } = await db
      .from("purchase_returns")
      .select("id, grn_id, status, company_id, branch_id")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!currentReturn) {
      return NextResponse.json(
        { success: false, message: "Purchase return not found" },
        { status: 404 }
      );
    }

    if (currentReturn.grn_id) {
      const scopedGrnIds = await listScopedQcCompletedGrnIds(db, scope);
      if (!scopedGrnIds.includes(currentReturn.grn_id)) {
        return NextResponse.json(
          { success: false, message: "Purchase return not found" },
          { status: 404 }
        );
      }
    }

    assertReturnEditable(String(currentReturn.status));

    if (!currentReturn.grn_id) {
      return NextResponse.json(
        { success: false, message: "Goods receipt is required" },
        { status: 400 }
      );
    }

    await validateReturnLineItems(db, currentReturn.grn_id, body.items, id);

    const total_amount = body.items.reduce(
      (sum, item) => sum + item.qty_returned * item.unit_cost,
      0
    );

    const { error: headerError } = await db
      .from("purchase_returns")
      .update({
        return_date: body.return_date,
        reason_type: body.reason_type,
        reason_notes: body.reason_notes ?? null,
        notes: body.notes ?? null,
        total_amount,
        status: "pending_approval",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (headerError) throw headerError;

    await replacePurchaseReturnItems(db, id, body.items);

    const { data, error } = await db
      .from("purchase_returns")
      .select(
        `
        *,
        supplier:suppliers (id, nama_supplier),
        grn:grn (id, nomor_grn),
        items:purchase_return_items (
          *,
          raw_material:raw_materials (kode, nama),
          grn_item:grn_items (warehouse_id)
        )
      `
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;

    const [enriched] = await enrichPurchaseReturnsWithGrn(db, data ? [data] : []);

    return NextResponse.json({
      success: true,
      data: enriched,
      message: "Purchase return updated successfully",
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, message: "Validation failed", issues: error.issues },
        { status: 400 }
      );
    }
    console.error("Error updating purchase return:", error);
    const message =
      error instanceof Error ? error.message : "Failed to update purchase return";
    const status = message.includes("before approval") ? 400 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}
