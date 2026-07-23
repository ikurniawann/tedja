// ============================================
// API ROUTE: /api/purchasing/po/[id]/approve
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireApiRole } from "@/lib/api/auth";

const APPROVE_ROLES = ["admin", "super_admin", "purchasing_admin", "purchasing_manager"] as const;

// POST /api/purchasing/po/:id/approve
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiRole([...APPROVE_ROLES]);
    const { id } = await params;
    const db = await createServerPgClient();

    // Cek PO ada
    const { data: po, error: findError } = await db
      .from("purchase_orders")
      .select("*")
      .eq("id", id)
      .single();

    if (findError || !po) {
      return Response.json(
        { success: false, message: "PO tidak ditemukan" },
        { status: 404 }
      );
    }

    // Validasi status
    if (po.status !== "draft") {
      return Response.json(
        { success: false, message: "PO hanya bisa diapprove saat status draft" },
        { status: 400 }
      );
    }

    // Cek apakah PO punya items
    const { data: items } = await db
      .from("purchase_order_items")
      .select("id")
      .eq("purchase_order_id", id)
      .eq("is_active", true);

    if (!items || items.length === 0) {
      return Response.json(
        { success: false, message: "PO tidak memiliki item. Tambahkan item terlebih dahulu." },
        { status: 400 }
      );
    }

    // Update status ke approved
    const { data, error } = await db
      .from("purchase_orders")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return Response.json({
      success: true,
      data,
      message: "PO berhasil diapprove",
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error approving PO:", error);
    return Response.json(
      { success: false, message: "Gagal mengapprove PO" },
      { status: 500 }
    );
  }
}
