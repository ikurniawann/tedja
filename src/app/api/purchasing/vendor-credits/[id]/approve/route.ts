import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { approveVendorCredit } from "@/lib/purchasing/vendor-credit-service";

// PATCH /api/purchasing/vendor-credits/[id]/approve
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const approver = await requireIamMenuPrefix(IAM.items);

    const db = await createServerPgClient();
    const creditId = (await params).id;
    const updated = await approveVendorCredit(db, creditId, approver.id);

    return NextResponse.json({
      success: true,
      data: updated,
      message: "Vendor credit approved. Purchase invoice net payable has been reduced.",
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error approving vendor credit:", error);
    const message = error instanceof Error ? error.message : "Failed to approve vendor credit";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
