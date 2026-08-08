// ============================================
// API ROUTE: /api/purchasing/po/[id]/send
// ============================================

import { NextRequest } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { adjustInventoryOnOrder } from "@/lib/inventory";
import { createBaseUnitResolver } from "@/lib/purchasing/raw-material-units";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { z } from "zod";

const sendSchema = z.object({
  sent_via: z.enum(["EMAIL", "WHATSAPP", "PRINT", "OTHER"]),
});

const SEND_ROLES = [
  "admin",
  "super_admin",
  "purchasing_admin",
  "purchasing_manager",
  "purchasing_staff",
] as const;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// POST /api/purchasing/po/:id/send
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiRole([...SEND_ROLES]);
    const { id } = await params;
    const db = createPgClient();
    const body = await request.json();

    // Validasi input
    const { sent_via } = sendSchema.parse(body);

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

    // Validasi status - harus approved untuk dikirim
    if (po.status !== "approved") {
      return Response.json(
        { success: false, message: "PO harus diapprove terlebih dahulu sebelum dikirim" },
        { status: 400 }
      );
    }

    const { data: items, error: itemsError } = await db
      .from("purchase_order_items")
      .select("raw_material_id, satuan_id, qty_ordered, qty_received")
      .eq("purchase_order_id", id)
      .eq("is_active", true);

    if (itemsError) throw itemsError;
    if (!items || items.length === 0) {
      return Response.json(
        { success: false, message: "PO tidak memiliki item untuk dikirim" },
        { status: 400 }
      );
    }

    // Update status ke sent
    const { data, error } = await db
      .from("purchase_orders")
      .update({
        status: "sent",
        sent_via,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    const resolveBaseUnit = await createBaseUnitResolver(
      db,
      items.map((item: { raw_material_id?: string | null }) => item.raw_material_id)
    );

    for (const item of items) {
      const remainingQty = Math.max(0, Number(item.qty_ordered || 0) - Number(item.qty_received || 0));
      if (item.raw_material_id && remainingQty > 0) {
        await adjustInventoryOnOrder(
          db,
          item.raw_material_id,
          remainingQty * resolveBaseUnit(item.raw_material_id, item.satuan_id)
        );
      }
    }

    return Response.json({
      success: true,
      data,
      message: `PO berhasil dikirim ke supplier via ${sent_via}`,
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error sending PO:", error);

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

    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal mengirim PO") },
      { status: 500 }
    );
  }
}
