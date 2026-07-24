import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  requireApiRole,
  ApiError,
  successResponse,
} from "@/lib/api/auth";
import {
  validateDeliveryTransition,
  DeliveryStatus,
} from "@/lib/purchasing/delivery";

const updateDeliverySchema = z.object({
  no_surat_jalan: z.string().min(1).optional(),
  ekspedisi: z.string().optional(),
  no_resi: z.string().optional(),
  tanggal_kirim: z.string().optional(),
  tanggal_estimasi_tiba: z.string().optional(),
  tanggal_aktual_tiba: z.string().optional(),
  status: z.enum(["pending", "shipped", "in_transit", "delivered", "cancelled"]).optional(),
  catatan: z.string().optional(),
});

// ============================================================
// GET /api/purchasing/delivery/:id
// ============================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiRole(["admin", "purchasing_admin", "purchasing_staff", "purchasing_manager", "super_admin"]);
    const db = await createServerPgClient();
    const { id } = await params;

    const { data: delivery, error } = await db
      .from("deliveries")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !delivery) {
      throw ApiError.notFound("Delivery tidak ditemukan");
    }

    const [supplierResult, vendorResult, poResult] = await Promise.all([
      delivery.supplier_id
        ? db.from("suppliers").select("*").eq("id", delivery.supplier_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      delivery.vendor_id
        ? db.from("vendors").select("id, code, name").eq("id", delivery.vendor_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      delivery.purchase_order_id
        ? db.from("purchase_orders").select("*").eq("id", delivery.purchase_order_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (supplierResult.error) throw supplierResult.error;
    if (vendorResult.error) throw vendorResult.error;
    if (poResult.error) throw poResult.error;

    const supplier = supplierResult.data as Record<string, unknown> | null;
    const vendor = vendorResult.data as Record<string, unknown> | null;
    const purchaseOrder = poResult.data as Record<string, unknown> | null;

    return successResponse(
      {
        ...delivery,
        supplier: supplier
          ? {
              id: supplier.id,
              nama: supplier.nama_supplier || supplier.nama || "-",
              kode: supplier.kode_supplier || supplier.kode || "",
            }
          : null,
        vendor: vendor
          ? {
              id: vendor.id,
              nama: vendor.name || "-",
              kode: vendor.code || "",
            }
          : null,
        purchase_order: purchaseOrder
          ? {
              id: purchaseOrder.id,
              po_number: purchaseOrder.nomor_po || purchaseOrder.po_number || "-",
              status: purchaseOrder.status || "",
            }
          : null,
      },
      "Delivery retrieved"
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching delivery:", error);
    return ApiError.server("Failed to fetch delivery").toResponse();
  }
}

// ============================================================
// PUT /api/purchasing/delivery/:id - Update delivery
// ============================================================

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiRole(["admin", "purchasing_admin", "purchasing_staff", "purchasing_manager", "super_admin"]);
    const db = await createServerPgClient();
    const { id } = await params;

    const body = await request.json();
    const validated = updateDeliverySchema.parse(body);

    // Get current delivery
    const { data: existing, error: fetchError } = await db
      .from("deliveries")
      .select("*, status")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      throw ApiError.notFound("Delivery tidak ditemukan");
    }

    // If status transition is requested, validate it
    if (validated.status && validated.status !== existing.status) {
      validateDeliveryTransition(existing.status as DeliveryStatus, validated.status as DeliveryStatus);
    }

    // Build update payload
    const updateData: Record<string, unknown> = { updated_by: user.id };
    if (validated.no_surat_jalan) updateData.no_surat_jalan = validated.no_surat_jalan;
    if (validated.ekspedisi !== undefined) updateData.kurir = validated.ekspedisi;
    if (validated.no_resi !== undefined) updateData.no_resi = validated.no_resi;
    if (validated.tanggal_kirim) updateData.tanggal_kirim = validated.tanggal_kirim;
    if (validated.tanggal_estimasi_tiba) updateData.tanggal_estimasi_tiba = validated.tanggal_estimasi_tiba;
    if (validated.tanggal_aktual_tiba) updateData.tanggal_aktual_tiba = validated.tanggal_aktual_tiba;
    if (validated.status) updateData.status = validated.status;
    if (validated.catatan !== undefined) updateData.catatan = validated.catatan;

    const { data: updated, error: updateError } = await db
      .from("deliveries")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) throw updateError;

    return successResponse(updated, "Delivery updated");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validation failed", error.issues).toResponse();
    }
    console.error("Error updating delivery:", error);
    return ApiError.server("Failed to update delivery").toResponse();
  }
}

// ============================================================
// DELETE /api/purchasing/delivery/:id - Soft delete
// ============================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiRole(["admin", "purchasing_admin", "purchasing_manager", "purchasing_staff", "super_admin"]);
    const db = await createServerPgClient();
    const { id } = await params;

    const { data: existing, error: fetchError } = await db
      .from("deliveries")
      .select("id, status")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      throw ApiError.notFound("Delivery tidak ditemukan");
    }

    if (existing.status !== "pending" && existing.status !== "cancelled") {
      throw ApiError.badRequest(
        `Delivery berstatus "${existing.status}" — hanya delivery berstatus PENDING atau CANCELLED yang dapat dihapus`
      );
    }

    await db
      .from("deliveries")
      .update({ is_active: false, updated_by: user.id })
      .eq("id", id);

    return successResponse(null, "Delivery berhasil dihapus");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error deleting delivery:", error);
    return ApiError.server("Failed to delete delivery").toResponse();
  }
}
