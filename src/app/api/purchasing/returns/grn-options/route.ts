import { NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getApiUserScope } from "@/lib/api/scope";
import { listScopedQcCompletedGrnIds } from "@/lib/purchasing/purchase-returns";

// GET /api/purchasing/returns/grn-options
// QC-completed goods receipts eligible for purchase returns
export async function GET() {
  try {
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const scopedGrnIds = await listScopedQcCompletedGrnIds(db, scope);

    if (scopedGrnIds.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const { data, error } = await db
      .from("grn")
      .select(
        `
        id,
        nomor_grn,
        tanggal_penerimaan,
        supplier_id,
        supplier:suppliers (
          nama_supplier
        )
      `
      )
      .in("id", scopedGrnIds)
      .eq("is_active", true)
      .order("tanggal_penerimaan", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: unknown) {
    console.error("Error fetching return GRN options:", error);
    const message =
      error instanceof Error ? error.message : "Failed to load goods receipt options";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
