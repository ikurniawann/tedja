import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { approvePurchaseReturn } from "@/lib/purchasing/purchase-return-service";

// PATCH /api/purchasing/returns/[id]/approve
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const approver = await requireApiRole([
      "super_admin",
      "purchasing_admin",
      "purchasing_manager",
    ]);

    const db = await createServerPgClient();
    const returnId = (await params).id;

    const updatedReturn = await approvePurchaseReturn(db, returnId, approver.id);

    return NextResponse.json({
      success: true,
      data: updatedReturn,
      message:
        "Purchase return approved. Stock has been reduced from the receipt warehouse.",
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error approving return:", error);
    const message =
      error instanceof Error ? error.message : "Failed to approve purchase return";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
