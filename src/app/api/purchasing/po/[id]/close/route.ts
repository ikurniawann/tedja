// ============================================
// API ROUTE: /api/purchasing/po/[id]/close
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { closePurchaseOrder } from "@/lib/purchasing/po";
import { z } from "zod";

const closeSchema = z.object({
  reason: z.string().min(1, "Alasan penutupan wajib diisi"),
});

const CLOSE_ROLES = [
  "admin",
  "super_admin",
  "purchasing_admin",
  "purchasing_manager",
] as const;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// POST /api/purchasing/po/:id/close
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const { id } = await params;
    const db = await createServerPgClient();
    const body = await request.json();
    const { reason } = closeSchema.parse(body);

    const result = await closePurchaseOrder(db, id, reason, user.id);

    return Response.json({
      success: true,
      data: result,
      message:
        "Purchase order ditutup. Kekurangan qty tidak ditagihkan; pengiriman baru tidak lagi diizinkan.",
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error closing PO:", error);

    if (error instanceof z.ZodError) {
      return Response.json(
        {
          success: false,
          message: "Validasi gagal",
          errors: error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const message = getErrorMessage(error, "Gagal menutup purchase order");
    const status =
      message.includes("tidak ditemukan") ||
      message.includes("Invalid state") ||
      message.includes("Alasan")
        ? 400
        : 500;

    return Response.json({ success: false, message }, { status });
  }
}
