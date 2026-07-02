import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getApiUserScope } from "@/lib/api/scope";
import {
  enrichPurchaseReturnsWithGrn,
  listScopedQcCompletedGrnIds,
} from "@/lib/purchasing/purchase-returns";

// GET /api/purchasing/returns
// List purchase returns (QC-completed GRNs only)
export async function GET(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const status = searchParams.get("status") || "all";
    const supplier_id = searchParams.get("supplier_id");
    const reason_type = searchParams.get("reason_type");
    const date_from = searchParams.get("date_from");
    const date_to = searchParams.get("date_to");
    const search = searchParams.get("search");
    const sort_by = searchParams.get("sort_by") || "return_date";
    const sort_order = searchParams.get("sort_order") || "DESC";

    const scopedGrnIds = await listScopedQcCompletedGrnIds(db, scope);

    if (scopedGrnIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: {
          page,
          limit,
          total: 0,
          total_pages: 0,
        },
      });
    }

    let query = db
      .from("purchase_returns")
      .select(
        `
        *,
        supplier:suppliers (
          id,
          nama_supplier
        ),
        grn:grn (
          id,
          nomor_grn
        )
      `,
        { count: "exact" }
      )
      .in("grn_id", scopedGrnIds);

    if (status !== "all") {
      query = query.eq("status", status);
    }
    if (supplier_id) {
      query = query.eq("supplier_id", supplier_id);
    }
    if (reason_type) {
      query = query.eq("reason_type", reason_type);
    }
    if (date_from) {
      query = query.gte("return_date", date_from);
    }
    if (date_to) {
      query = query.lte("return_date", date_to);
    }
    if (search) {
      const { data: matchingGrns } = await db
        .from("grn")
        .select("id")
        .ilike("nomor_grn", `%${search}%`);
      const matchingGrnIds = (matchingGrns || []).map((grn) => grn.id).filter(Boolean);

      if (matchingGrnIds.length > 0) {
        query = query.or(
          `return_number.ilike.%${search}%,reason_notes.ilike.%${search}%,grn_id.in.(${matchingGrnIds.join(",")})`
        );
      } else {
        query = query.or(`return_number.ilike.%${search}%,reason_notes.ilike.%${search}%`);
      }
    }

    query = query.order(sort_by as "return_date", { ascending: sort_order === "ASC" });

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: await enrichPurchaseReturnsWithGrn(db, data || []),
      pagination: {
        page,
        limit,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching returns:", error);
    const message = error instanceof Error ? error.message : "Failed to load purchase returns";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

// POST /api/purchasing/returns
// Create a new purchase return (GRN must have completed QC)
export async function POST(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const body = await request.json();

    const {
      grn_id,
      supplier_id,
      return_date,
      reason_type,
      reason_notes,
      items,
      notes,
    } = body;

    if (!supplier_id || !return_date || !reason_type || !items || items.length === 0) {
      return NextResponse.json(
        { success: false, message: "Required fields are incomplete" },
        { status: 400 }
      );
    }

    if (!grn_id) {
      return NextResponse.json(
        { success: false, message: "Goods receipt is required for purchase returns" },
        { status: 400 }
      );
    }

    const scopedGrnIds = await listScopedQcCompletedGrnIds(db, scope);
    if (!scopedGrnIds.includes(grn_id)) {
      return NextResponse.json(
        {
          success: false,
          message: "Goods receipt is not eligible for return (QC incomplete or out of scope)",
        },
        { status: 400 }
      );
    }

    const { data: grn, error: grnError } = await db
      .from("grn")
      .select("id, company_id, branch_id, supplier_id")
      .eq("id", grn_id)
      .eq("is_active", true)
      .maybeSingle();

    if (grnError) throw grnError;
    if (!grn) {
      return NextResponse.json(
        { success: false, message: "Goods receipt not found" },
        { status: 404 }
      );
    }

    const total_amount = items.reduce(
      (sum: number, item: { qty_returned: number; unit_cost: number }) =>
        sum + item.qty_returned * item.unit_cost,
      0
    );

    const { data: returnData, error: returnError } = await db
      .from("purchase_returns")
      .insert({
        grn_id,
        supplier_id,
        return_date,
        reason_type,
        reason_notes,
        status: "pending_approval",
        total_amount,
        notes,
        company_id: grn.company_id ?? null,
        branch_id: grn.branch_id ?? null,
      })
      .select()
      .single();

    if (returnError) throw returnError;

    const returnItems = items.map(
      (item: {
        grn_item_id: string;
        raw_material_id: string;
        qty_returned: number;
        unit_cost: number;
        batch_number?: string | null;
        expiry_date?: string | null;
        condition_notes?: string | null;
        qc_status?: string;
      }) => ({
        return_id: returnData.id,
        grn_item_id: item.grn_item_id,
        raw_material_id: item.raw_material_id,
        qty_returned: item.qty_returned,
        unit_cost: item.unit_cost,
        subtotal: item.qty_returned * item.unit_cost,
        batch_number: item.batch_number || null,
        expiry_date: item.expiry_date || null,
        condition_notes: item.condition_notes || null,
        qc_status: item.qc_status || "rejected",
      })
    );

    const { error: itemsError } = await db.from("purchase_return_items").insert(returnItems);

    if (itemsError) {
      await db.from("purchase_returns").delete().eq("id", returnData.id);
      throw itemsError;
    }

    const { data: completeReturn } = await db
      .from("purchase_returns")
      .select(
        `
        *,
        supplier:suppliers (nama_supplier),
        items:purchase_return_items (
          *,
          raw_material:raw_materials (kode, nama, satuan)
        )
      `
      )
      .eq("id", returnData.id)
      .single();

    return NextResponse.json({
      success: true,
      data: completeReturn,
      message: "Purchase return created and pending approval",
    });
  } catch (error: unknown) {
    console.error("Error creating return:", error);
    const message = error instanceof Error ? error.message : "Failed to create purchase return";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
