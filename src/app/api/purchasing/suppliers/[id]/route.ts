import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  requireApiRole,
  ApiError,
  successResponse,
  noContentResponse,
} from "@/lib/api/auth";

const updateSupplierSchema = z.object({
  nama_supplier: z.string().min(1).max(200).optional(),
  pic_name: z.string().max(100).optional(),
  pic_phone: z.string().max(30).optional(),
  pic_email: z.string().email("Email PIC tidak valid").optional().or(z.literal("")),
  email: z.string().email("Email tidak valid").optional().or(z.literal("")),
  alamat: z.string().optional(),
  telepon: z.string().max(30).optional(),
  kota: z.string().max(100).optional(),
  npwp: z.string().max(50).optional(),
  payment_terms: z.enum(["CBD", "TOP7", "TOP14", "TOP30", "TOP45", "TOP60"]).optional(),
  currency: z.enum(["IDR", "USD", "EUR"]).optional(),
  bank_nama: z.string().optional(),
  bank_rekening: z.string().optional(),
  bank_atas_nama: z.string().optional(),
  kategori: z.string().optional(),
  catatan: z.string().optional(),
  status: z.enum(["active", "inactive", "probation", "blocked", "draft"]).optional(),
  is_active: z.boolean().optional(),
});

// ========================
// GET /api/purchasing/suppliers/:id
// ========================
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiRole(["purchasing_admin", "purchasing_staff", "purchasing_manager", "super_admin"]);

    const { id } = await params;
    const db = await createServerPgClient();

    // Fetch supplier
    const { data: supplier, error: supplierError } = await db
      .from("suppliers")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (supplierError || !supplier) {
      throw ApiError.notFound("Supplier tidak ditemukan");
    }

    // ---- Analytics: PO Aktif ----
    // Count PO with status DRAFT, APPROVED, SENT, PARTIAL (not RECEIVED, CLOSED, CANCELLED)
    const { count: poAktifCount } = await db
      .from("purchase_orders")
      .select("*", { count: "exact", head: true })
      .eq("vendor_id", id)
      .in("status", ["draft", "sent", "partial"]);

    // Total nilai PO aktif
    const { data: poAktifData } = await db
      .from("purchase_orders")
      .select("total")
      .eq("vendor_id", id)
      .in("status", ["draft", "sent", "partial"]);

    const totalNilaiPOAktif = poAktifData?.reduce((sum, po) => sum + Number(po.total), 0) ?? 0;

    // ---- Analytics: Total transaksi 12 bulan terakhir ----
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const { data: transaksi12Bulan } = await db
      .from("purchase_orders")
      .select("id, total, status")
      .eq("vendor_id", id)
      .gte("created_at", twelveMonthsAgo.toISOString())
      .in("status", ["received", "closed"]);

    const totalTransaksi12Bulan =
      transaksi12Bulan?.reduce((sum, po) => sum + Number(po.total), 0) ?? 0;
    const jumlahPO12Bulan = transaksi12Bulan?.length ?? 0;

    // ---- Analytics: On-time delivery rate ----
    // On-time = actual_delivery <= expected_delivery (for received POs)
    const { data: deliveredPOs } = await db
      .from("purchase_orders")
      .select("id, expected_delivery, actual_delivery")
      .eq("vendor_id", id)
      .not("actual_delivery", "is", null)
      .in("status", ["received", "closed"]);

    let onTimeCount = 0;
    let totalDelivered = 0;

    if (deliveredPOs && deliveredPOs.length > 0) {
      totalDelivered = deliveredPOs.length;
      for (const po of deliveredPOs) {
        if (po.actual_delivery && po.expected_delivery) {
          const actual = new Date(po.actual_delivery);
          const expected = new Date(po.expected_delivery);
          if (actual <= expected) onTimeCount++;
        }
      }
    }

    const onTimeDeliveryRate =
      totalDelivered > 0 ? Math.round((onTimeCount / totalDelivered) * 100 * 10) / 10 : 0;

    // Simpler: get distinct descriptions from PO items for this vendor's POs
    const { data: topBahan } = await db
      .from("purchase_orders")
      .select(`
        id,
        purchase_order_items(raw_material:raw_materials!raw_material_id(nama))
      `)
      .eq("vendor_id", id)
      .limit(5);

    const bahanSet = new Set<string>();
    if (topBahan) {
      for (const po of topBahan) {
        const items = po.purchase_order_items as Array<{ raw_material?: { nama?: string } | null }> | null;
        if (items) {
          for (const item of items) {
            if (item.raw_material?.nama) bahanSet.add(item.raw_material.nama);
          }
        }
      }
    }

    const enrichedSupplier = {
      ...supplier,
      analytics: {
        po_aktif_count: poAktifCount ?? 0,
        po_aktif_nilai: totalNilaiPOAktif,
        total_transaksi_12_bulan: totalTransaksi12Bulan,
        jumlah_po_12_bulan: jumlahPO12Bulan,
        on_time_delivery_rate: onTimeDeliveryRate,
        bahan_sering_dibeli: Array.from(bahanSet).slice(0, 5),
      },
    };

    return successResponse(enrichedSupplier);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching supplier detail:", error);
    return ApiError.server("Gagal mengambil detail supplier").toResponse();
  }
}

// ========================
// PUT /api/purchasing/suppliers/:id
// ========================
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiRole(["purchasing_admin", "purchasing_staff", "purchasing_manager", "super_admin"]);

    const { id } = await params;
    const body = await request.json();
    const validated = updateSupplierSchema.parse(body);

    const db = await createServerPgClient();

    // Check if supplier exists
    const { data: existing } = await db
      .from("suppliers")
      .select("id, kode")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (!existing) {
      throw ApiError.notFound("Supplier tidak ditemukan");
    }

    // Validate NPWP format if being updated
    if (validated.npwp && !/^\d{2}\.\d{3}\.\d{3}\.\d{1}-\d{3}\.\d{3}$/.test(validated.npwp)) {
      throw ApiError.badRequest("Format NPWP tidak valid. Gunakan format: XX.XXX.XXX.X-XXX.XXX");
    }

    const { data, error } = await db
      .from("suppliers")
      .update({
        ...validated,
        updated_by: user.id,
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select()
      .single();

    if (error) throw error;

    return successResponse(data, "Supplier berhasil diperbarui");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validasi gagal", error.issues).toResponse();
    }
    console.error("Error updating supplier:", error);
    return ApiError.server("Gagal memperbarui supplier").toResponse();
  }
}

// ========================
// DELETE /api/purchasing/suppliers/:id — Soft delete
// ========================
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiRole(["purchasing_admin", "purchasing_manager", "purchasing_staff", "super_admin"]);

    const { id } = await params;
    const db = await createServerPgClient();

    // Check if supplier exists
    const { data: existing } = await db
      .from("suppliers")
      .select("id")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (!existing) {
      throw ApiError.notFound("Supplier tidak ditemukan");
    }

    // Check: jika ada PO dengan status DRAFT/APPROVED/SENT → tolak delete
    const { count: activePOCount } = await db
      .from("purchase_orders")
      .select("*", { count: "exact", head: true })
      .eq("vendor_id", id)
      .in("status", ["draft", "sent", "partial"]);

    if (activePOCount && activePOCount > 0) {
      throw ApiError.conflict(
        `Tidak dapat menghapus supplier. Terdapat ${activePOCount} PO aktif (DRAFT/SENT/PARTIAL) yang masih terkait dengan supplier ini.`
      );
    }

    const softDeletePayload = {
      is_active: false,
      status: "inactive",
      deleted_by: user.id,
      deleted_at: new Date().toISOString(),
      updated_by: user.id,
    };
    const { error } = await db
      .from("suppliers")
      .update(softDeletePayload)
      .eq("id", id)
      .is("deleted_at", null);

    if (error) throw error;

    return noContentResponse();
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error deleting supplier:", error);
    return ApiError.server("Gagal menghapus supplier").toResponse();
  }
}
