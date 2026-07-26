// ============================================
// API ROUTE: /api/purchasing/po/[id]
// ============================================

import { NextRequest } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { adjustInventoryOnOrder } from "@/lib/inventory";
import { recalculatePurchaseOrderTotals } from "@/lib/purchasing/po-totals";
import {
  computePoInvoiceAmounts,
  getPoCreditBreakdown,
} from "@/lib/purchasing/po-payments";
import { computePoFulfillmentProgress } from "@/lib/purchasing/po-fulfillment-progress";
import { z } from "zod";

const poSchema = z.object({
  supplier_id: z.string().uuid().optional(),
  tanggal_po: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tanggal_kirim_estimasi: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  catatan: z.string().optional().nullable(),
  alamat_pengiriman: z.string().optional().nullable(),
  diskon_persen: z.number().min(0).max(100).optional(),
  diskon_nominal: z.number().min(0).optional(),
  ppn_persen: z.number().min(0).max(100).optional(),
});

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// GET /api/purchasing/po/:id
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = createPgClient();

    // Get PO header
    const { data: po, error: poError } = await db
      .from("v_purchase_orders")
      .select("*")
      .eq("id", id)
      .single();

    if (poError) {
      if (poError.code === "PGRST116") {
        return Response.json(
          { success: false, message: "PO tidak ditemukan" },
          { status: 404 }
        );
      }
      throw poError;
    }

    // Get PO items.
    // Query builder hanya mendukung embed satu level, jadi satuan_besar/satuan_kecil
    // dari raw_material di-resolve manual lewat lookup units di bawah.
    const { data: items, error: itemsError } = await db
      .from("purchase_order_items")
      .select(`
        *,
        raw_material:raw_materials!raw_material_id (*),
        product:products!product_id (id, kode, nama, satuan_id),
        satuan:units!satuan_id (*)
      `)
      .eq("purchase_order_id", id)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (itemsError) throw itemsError;

    // Enrich raw_material dengan nama satuan besar/kecil (units).
    const itemUnitIds = Array.from(
      new Set(
        (items || []).flatMap((item) => {
          const rm = (item as { raw_material?: { satuan_besar_id?: string | null; satuan_kecil_id?: string | null } | null }).raw_material;
          return [rm?.satuan_besar_id, rm?.satuan_kecil_id].filter(Boolean) as string[];
        })
      )
    );
    if (itemUnitIds.length > 0) {
      const { data: unitRows } = await db
        .from("units")
        .select("id, nama, kode")
        .in("id", itemUnitIds);
      const unitMap = new Map((unitRows || []).map((u) => [u.id as string, u]));
      for (const item of items || []) {
        const rm = (item as { raw_material?: { satuan_besar_id?: string | null; satuan_kecil_id?: string | null; satuan_besar?: unknown; satuan_kecil?: unknown } | null }).raw_material;
        if (!rm) continue;
        rm.satuan_besar = rm.satuan_besar_id ? unitMap.get(rm.satuan_besar_id) ?? null : null;
        rm.satuan_kecil = rm.satuan_kecil_id ? unitMap.get(rm.satuan_kecil_id) ?? null : null;
      }
    }

    // EPIC-026 B3 — resolusi item barang operasional (scope 'general').
    // Manual lookup (bukan embed) mengikuti pola PR general (B2a).
    const supplyItemIds = Array.from(
      new Set(
        (items || [])
          .map((item: { supply_item_id?: string | null }) => item.supply_item_id)
          .filter(Boolean)
      )
    ) as string[];
    if (supplyItemIds.length > 0) {
      const { data: supplyRows } = await db
        .from("supply_items")
        .select("id, kode, nama, satuan_id, stockable")
        .in("id", supplyItemIds);
      const supplyMap = new Map(
        (supplyRows || []).map((s: { id: string }) => [s.id, s] as const)
      );
      for (const item of items || []) {
        const supplyItemId = (item as { supply_item_id?: string | null }).supply_item_id;
        (item as { supply_item?: unknown }).supply_item = supplyItemId
          ? supplyMap.get(supplyItemId) ?? null
          : null;
      }
    }

    const { data: activeDelivery, error: deliveryError } = await db
      .from("deliveries")
      .select("id, nomor_resi, no_surat_jalan, status")
      .eq("purchase_order_id", id)
      .eq("is_active", true)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (deliveryError) throw deliveryError;

    const creditBreakdown = await getPoCreditBreakdown(db, id);
    const invoiceAmounts = computePoInvoiceAmounts({
      grossPayable: Number(po.payable_amount ?? po.grand_total ?? po.total ?? 0),
      returnCredit: creditBreakdown.return_credit_amount,
      rejectCredit: creditBreakdown.reject_credit_amount,
      paidAmount: Number(po.paid_amount || 0),
      nextDueDate: po.next_due_date,
    });

    const fulfillmentProgress = await computePoFulfillmentProgress(
      db,
      id,
      String(po.status || "draft"),
      Number(po.received_percentage ?? po.receive_percentage ?? po.progress_pct ?? 0)
    );

    return Response.json({
      success: true,
      data: {
        ...po,
        gross_payable_amount: invoiceAmounts.gross_payable_amount,
        return_credit_amount: invoiceAmounts.return_credit_amount,
        reject_credit_amount: invoiceAmounts.reject_credit_amount,
        total_credit_amount: invoiceAmounts.total_credit_amount,
        payable_amount: invoiceAmounts.payable_amount,
        paid_amount: invoiceAmounts.paid_amount,
        outstanding_amount: invoiceAmounts.outstanding_amount,
        payment_progress_pct: invoiceAmounts.payment_progress_pct,
        payment_status: invoiceAmounts.payment_status,
        order_progress_pct: fulfillmentProgress.order_progress_pct,
        qc_progress_pct: fulfillmentProgress.qc_progress_pct,
        return_progress_pct: fulfillmentProgress.return_progress_pct,
        fulfillment_progress_pct: fulfillmentProgress.fulfillment_progress_pct,
        total_qty_received_grn: fulfillmentProgress.total_qty_received_grn,
        total_qty_qc_posted: fulfillmentProgress.total_qty_qc_posted,
        total_qty_returned: fulfillmentProgress.total_qty_returned,
        active_delivery_id: activeDelivery?.id || null,
        active_delivery_number: activeDelivery?.nomor_resi || activeDelivery?.no_surat_jalan || null,
        active_delivery_status: activeDelivery?.status || null,
        items: items || [],
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching PO:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal mengambil data PO") },
      { status: 500 }
    );
  }
}

// PUT /api/purchasing/po/:id
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = createPgClient();
    const body = await request.json();

    // Validasi input
    const validated = poSchema.parse(body);

    // Cek PO ada dan status masih bisa diedit (hanya draft)
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

    if (po.status !== "draft") {
      return Response.json(
        { success: false, message: "PO hanya bisa diedit saat status draft" },
        { status: 400 }
      );
    }

    // Update data + hitung ulang total dari item
    const totals = await recalculatePurchaseOrderTotals(db, id, {
      diskon_persen: validated.diskon_persen,
      diskon_nominal: validated.diskon_nominal,
      ppn_persen: validated.ppn_persen,
    });

    const { data, error } = await db
      .from("purchase_orders")
      .update({
        ...validated,
        ...totals,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return Response.json({
      success: true,
      data,
      message: "PO berhasil diupdate",
    });
  } catch (error: unknown) {
    console.error("Error updating PO:", error);

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
      { success: false, message: getErrorMessage(error, "Gagal mengupdate PO") },
      { status: 500 }
    );
  }
}

// DELETE /api/purchasing/po/:id
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = createPgClient();

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

    const normalizedStatus = String(po.status || "").toLowerCase();

    // Hanya bisa hapus/cancel jika belum received
    if (normalizedStatus === "received") {
      return Response.json(
        { success: false, message: "PO yang sudah diterima tidak bisa dibatalkan" },
        { status: 400 }
      );
    }

    const shouldReleaseOnOrder = normalizedStatus === "sent" || normalizedStatus === "partial" || normalizedStatus === "partially_received";
    const { data: items, error: itemsError } = shouldReleaseOnOrder
      ? await db
          .from("purchase_order_items")
          .select("raw_material_id, qty_ordered, qty_received")
          .eq("purchase_order_id", id)
          .eq("is_active", true)
      : { data: [], error: null };

    if (itemsError) throw itemsError;

    // Soft delete / cancel
    const { error } = await db
      .from("purchase_orders")
      .update({
        status: "cancelled",
        is_active: false,
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    if (shouldReleaseOnOrder) {
      for (const item of items || []) {
        const remainingQty = Math.max(0, Number(item.qty_ordered || 0) - Number(item.qty_received || 0));
        if (item.raw_material_id && remainingQty > 0) {
          await adjustInventoryOnOrder(db, item.raw_material_id, -remainingQty);
        }
      }
    }

    return Response.json({
      success: true,
      message: "PO berhasil dibatalkan",
    });
  } catch (error: unknown) {
    console.error("Error cancelling PO:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal membatalkan PO") },
      { status: 500 }
    );
  }
}
