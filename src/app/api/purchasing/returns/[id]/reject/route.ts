import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireApiRole } from "@/lib/api/auth";

// PATCH /api/purchasing/returns/[id]/reject
// Reject a purchase return
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiRole(["admin", "purchasing_admin", "purchasing_manager", "purchasing_staff", "super_admin"]);
    const db = await createServerPgClient();
    const returnId = (await params).id;
    const body = await request.json();
    const { rejection_reason } = body;

    if (!rejection_reason) {
      return NextResponse.json(
        { success: false, message: "Alasan penolakan wajib diisi" },
        { status: 400 }
      );
    }

    // Get current return data
    const { data: currentReturn, error: fetchError } = await db
      .from("purchase_returns")
      .select("*")
      .eq("id", returnId)
      .single();

    if (fetchError || !currentReturn) {
      return NextResponse.json(
        { success: false, message: "Return tidak ditemukan" },
        { status: 404 }
      );
    }

    if (currentReturn.status !== "pending_approval") {
      return NextResponse.json(
        { success: false, message: "Return tidak dalam status pending approval" },
        { status: 400 }
      );
    }

    // Update return status to rejected
    const { data: updatedReturn, error: updateError } = await db
      .from("purchase_returns")
      .update({
        status: "rejected",
        rejection_reason,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", returnId)
      .select()
      .single();

    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      data: updatedReturn,
      message: "Return ditolak",
    });
  } catch (error: any) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error rejecting return:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Gagal menolak return" },
      { status: 500 }
    );
  }
}
