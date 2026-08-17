import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getVendorCreditsByGrnId } from "@/lib/purchasing/vendor-credit-service";

// GET /api/purchasing/grn/[id]/vendor-credits
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireIamMenuPrefix(IAM.items);

    const db = await createServerPgClient();
    const grnId = (await params).id;
    const credits = await getVendorCreditsByGrnId(db, grnId);

    return NextResponse.json({ success: true, data: credits });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching vendor credits:", error);
    const message = error instanceof Error ? error.message : "Failed to load vendor credits";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
