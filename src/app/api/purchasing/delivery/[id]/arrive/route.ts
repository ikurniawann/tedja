import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest } from "next/server";
import {
  requireApiRole,
  ApiError,
  successResponse,
} from "@/lib/api/auth";
import {
  validateDeliveryTransition,
  DeliveryStatus,
} from "@/lib/purchasing/delivery";
import { generateGrnNumber } from "@/lib/purchasing/grn";

// POST /api/purchasing/delivery/:id/arrive
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiRole([
      "admin",
      "purchasing_admin",
      "purchasing_staff",
      "warehouse_staff",
      "purchasing_manager",
      "super_admin",
    ]);
    const db = await createServerPgClient();
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const notes = body.notes as string | undefined;

    const { data: delivery, error: fetchError } = await db
      .from("deliveries")
      .select(
        "*, purchase_order:purchase_orders!purchase_order_id(id, nomor_po, status, supplier_id, vendor_id, company_id, branch_id)"
      )
      .eq("id", id)
      .single();

    if (fetchError || !delivery) {
      throw ApiError.notFound("Delivery tidak ditemukan");
    }

    try {
      validateDeliveryTransition(delivery.status as DeliveryStatus, "delivered");
    } catch (e) {
      throw ApiError.badRequest((e as Error).message);
    }

    const arrivedAt = new Date().toISOString();

    const { data: updatedDelivery, error: deliveryError } = await db
      .from("deliveries")
      .update({
        status: "delivered",
        tanggal_aktual_tiba: arrivedAt.split("T")[0],
        updated_by: user.id,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (deliveryError) throw deliveryError;

    const po = delivery.purchase_order as {
      supplier_id?: string | null;
      vendor_id?: string | null;
      company_id?: string | null;
      branch_id?: string | null;
    } | null;

    const grnNumber = await generateGrnNumber(db);

    const { data: grn, error: grnError } = await db
      .from("grn")
      .insert({
        nomor_grn: grnNumber,
        purchase_order_id: delivery.purchase_order_id,
        delivery_id: id,
        supplier_id: delivery.supplier_id || po?.supplier_id,
        vendor_id: delivery.vendor_id || po?.vendor_id || null,
        company_id: delivery.company_id ?? po?.company_id ?? null,
        branch_id: delivery.branch_id ?? po?.branch_id ?? null,
        tanggal_penerimaan: arrivedAt.split("T")[0],
        penerima_id: user.id,
        status: "pending",
        catatan: notes || null,
        created_by: user.id,
      })
      .select(
        `
        *,
        purchase_order:purchase_orders!purchase_order_id(id, nomor_po, status)
      `
      )
      .single();

    if (grnError) {
      await db
        .from("deliveries")
        .update({ status: "in_transit", updated_by: user.id })
        .eq("id", id);
      throw new Error(`Failed to create GRN: ${grnError.message}`);
    }

    return successResponse(
      { delivery: updatedDelivery, grn },
      `Barang arrived — GRN ${grn.nomor_grn} berhasil dibuat`
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error marking delivery as arrived:", error);
    return ApiError.server("Failed to mark delivery as arrived").toResponse();
  }
}
