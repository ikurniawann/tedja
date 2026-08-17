import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, successResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { formatRupiah } from "@/lib/purchasing/utils";

// GET /api/purchasing/reports/supplier-performance

const querySchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  supplier_id: z.string().uuid().optional(),
  export: z.enum(["json", "csv"]).default("json"),
});

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function daysBetween(from?: string | null, to?: string | null) {
  if (!from || !to) return null;
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function qualityFromReject(rejectRate: number) {
  if (rejectRate === 0) return 100;
  if (rejectRate < 5) return 80;
  if (rejectRate < 10) return 60;
  return 40;
}

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.items);
    const db = await createServerPgClient();

    const { searchParams } = new URL(request.url);
    const params = querySchema.parse(Object.fromEntries(searchParams));
    const { date_from, date_to, supplier_id, export: exportFormat } = params;

    let supplierQuery = db
      .from("suppliers")
      .select("id, kode, nama_supplier, pic_name, telepon, pic_phone, email, is_active")
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("nama_supplier", { ascending: true });

    if (supplier_id) supplierQuery = supplierQuery.eq("id", supplier_id);

    const { data: suppliers, error: supplierError } = await supplierQuery;
    if (supplierError) throw supplierError;

    if (!suppliers || suppliers.length === 0) {
      return successResponse({
        summary: {
          total_suppliers: 0,
          period: { from: date_from, to: date_to },
          top_supplier: null,
          total_spend_all_suppliers: 0,
        },
        vendors: [],
        suppliers: [],
      });
    }

    const supplierIds = suppliers.map((s: { id: string }) => s.id);

    let poQuery = db
      .from("purchase_orders")
      .select(
        "id, supplier_id, status, total, tanggal_po, tanggal_dibutuhkan, tanggal_kirim_estimasi, is_active"
      )
      .in("supplier_id", supplierIds)
      .eq("is_active", true)
      .is("deleted_at", null);

    if (date_from) poQuery = poQuery.gte("tanggal_po", date_from);
    if (date_to) poQuery = poQuery.lte("tanggal_po", date_to);

    const { data: pos, error: poError } = await poQuery;
    if (poError) throw poError;

    const activePos = (pos || []).filter(
      (po: { status?: string }) => String(po.status || "").toLowerCase() !== "cancelled"
    );
    const poIds = activePos.map((po: { id: string }) => po.id);
    const poById = new Map(activePos.map((po: { id: string }) => [po.id, po]));

    const { data: deliveries, error: deliveryError } =
      poIds.length > 0
        ? await db
            .from("deliveries")
            .select(
              "id, purchase_order_id, supplier_id, tanggal_aktual_tiba, tanggal_estimasi_tiba"
            )
            .in("purchase_order_id", poIds)
            .eq("is_active", true)
        : { data: [], error: null };
    if (deliveryError) throw deliveryError;

    const { data: grns, error: grnError } =
      poIds.length > 0
        ? await db
            .from("grn")
            .select(
              "id, purchase_order_id, supplier_id, tanggal_penerimaan, total_item_diterima, total_item_ditolak"
            )
            .in("purchase_order_id", poIds)
            .eq("is_active", true)
        : { data: [], error: null };
    if (grnError) throw grnError;

    const grnIds = (grns || []).map((g: { id: string }) => g.id);
    let inspections: Array<{
      grn_id: string;
      items?: Array<{ qty_inspected?: number; qty_rejected?: number }>;
    }> = [];
    if (grnIds.length > 0) {
      const qcResult = await db
        .from("grn_qc_inspections")
        .select("grn_id, items:grn_qc_inspection_items(qty_inspected, qty_rejected)")
        .in("grn_id", grnIds);
      if (qcResult.error) {
        console.warn("QC data unavailable for supplier performance:", qcResult.error);
      } else {
        inspections = (qcResult.data || []) as typeof inspections;
      }
    }

    const qcByGrn = new Map<string, { inspected: number; rejected: number }>();
    for (const inspection of inspections) {
      const items = inspection.items || [];
      const inspected = items.reduce((sum, item) => sum + toNumber(item.qty_inspected), 0);
      const rejected = items.reduce((sum, item) => sum + toNumber(item.qty_rejected), 0);
      qcByGrn.set(inspection.grn_id, { inspected, rejected });
    }

    type Agg = {
      total_po: number;
      completed_po: number;
      total_value: number;
      on_time_count: number;
      late_count: number;
      lead_days: number[];
      qty_accepted: number;
      qty_rejected: number;
    };

    const bySupplier = new Map<string, Agg>();
    for (const id of supplierIds) {
      bySupplier.set(id, {
        total_po: 0,
        completed_po: 0,
        total_value: 0,
        on_time_count: 0,
        late_count: 0,
        lead_days: [],
        qty_accepted: 0,
        qty_rejected: 0,
      });
    }

    for (const po of activePos) {
      const supplierId = po.supplier_id as string;
      const agg = bySupplier.get(supplierId);
      if (!agg) continue;
      agg.total_po += 1;
      agg.total_value += toNumber(po.total);
      const status = String(po.status || "").toLowerCase();
      if (["received", "partially_received", "partial"].includes(status)) {
        agg.completed_po += 1;
      }
    }

    for (const delivery of deliveries || []) {
      const po = poById.get(delivery.purchase_order_id);
      const supplierId = (delivery.supplier_id || po?.supplier_id) as string | undefined;
      if (!supplierId) continue;
      const agg = bySupplier.get(supplierId);
      if (!agg) continue;

      const lead = daysBetween(po?.tanggal_po, delivery.tanggal_aktual_tiba);
      if (lead != null) agg.lead_days.push(lead);

      if (delivery.tanggal_aktual_tiba && delivery.tanggal_estimasi_tiba) {
        const onTime =
          new Date(delivery.tanggal_aktual_tiba) <= new Date(delivery.tanggal_estimasi_tiba);
        if (onTime) agg.on_time_count += 1;
        else agg.late_count += 1;
      } else if (delivery.tanggal_aktual_tiba && po?.tanggal_dibutuhkan) {
        const onTime =
          new Date(delivery.tanggal_aktual_tiba) <= new Date(po.tanggal_dibutuhkan);
        if (onTime) agg.on_time_count += 1;
        else agg.late_count += 1;
      } else if (delivery.tanggal_aktual_tiba && po?.tanggal_kirim_estimasi) {
        const onTime =
          new Date(delivery.tanggal_aktual_tiba) <= new Date(po.tanggal_kirim_estimasi);
        if (onTime) agg.on_time_count += 1;
        else agg.late_count += 1;
      }
    }

    // Fallback on-time from GRN vs needed date when no delivery timing exists for that PO
    const poWithDeliveryTiming = new Set(
      (deliveries || [])
        .filter((d: { tanggal_aktual_tiba?: string | null }) => d.tanggal_aktual_tiba)
        .map((d: { purchase_order_id: string }) => d.purchase_order_id)
    );

    for (const grn of grns || []) {
      const po = poById.get(grn.purchase_order_id);
      const supplierId = (grn.supplier_id || po?.supplier_id) as string | undefined;
      if (!supplierId) continue;
      const agg = bySupplier.get(supplierId);
      if (!agg) continue;

      const qc = qcByGrn.get(grn.id);
      if (qc && qc.inspected > 0) {
        agg.qty_accepted += Math.max(0, qc.inspected - qc.rejected);
        agg.qty_rejected += qc.rejected;
      } else {
        agg.qty_accepted += toNumber(grn.total_item_diterima);
        agg.qty_rejected += toNumber(grn.total_item_ditolak);
      }

      if (!poWithDeliveryTiming.has(grn.purchase_order_id) && grn.tanggal_penerimaan) {
        const lead = daysBetween(po?.tanggal_po, grn.tanggal_penerimaan);
        if (lead != null) agg.lead_days.push(lead);

        const deadline = po?.tanggal_dibutuhkan || po?.tanggal_kirim_estimasi;
        if (deadline) {
          const onTime = new Date(grn.tanggal_penerimaan) <= new Date(deadline);
          if (onTime) agg.on_time_count += 1;
          else agg.late_count += 1;
        }
      }
    }

    const rows = suppliers
      .map((supplier: Record<string, any>) => {
        const agg = bySupplier.get(supplier.id)!;
        if (agg.total_po === 0) return null;

        const timed = agg.on_time_count + agg.late_count;
        const onTimeRate = timed > 0 ? (agg.on_time_count / timed) * 100 : null;
        const inspected = agg.qty_accepted + agg.qty_rejected;
        const rejectRate = inspected > 0 ? (agg.qty_rejected / inspected) * 100 : 0;
        const qualityScore = qualityFromReject(rejectRate);
        const avgLead =
          agg.lead_days.length > 0
            ? agg.lead_days.reduce((s, d) => s + d, 0) / agg.lead_days.length
            : null;
        const avgPoValue = agg.total_po > 0 ? agg.total_value / agg.total_po : 0;
        const rating =
          Math.round(
            (((onTimeRate ?? 50) * 0.5 + qualityScore * 0.5) / 20) * 10
          ) / 10;

        return {
          id: supplier.id,
          vendor_id: supplier.id,
          supplier_id: supplier.id,
          supplier_code: supplier.kode,
          vendor_code: supplier.kode,
          supplier_name: supplier.nama_supplier,
          vendor_name: supplier.nama_supplier,
          contact_person: supplier.pic_name,
          telepon: supplier.telepon || supplier.pic_phone,
          email: supplier.email,
          total_po: agg.total_po,
          completed_po: agg.completed_po,
          approved_po: agg.completed_po,
          on_time_count: agg.on_time_count,
          late_count: agg.late_count,
          on_time_rate: onTimeRate !== null ? Math.round(onTimeRate * 10) / 10 : null,
          on_time_delivery_rate:
            onTimeRate !== null ? Math.round(onTimeRate * 10) / 10 : null,
          reject_rate: Math.round(rejectRate * 100) / 100,
          avg_lead_time_days:
            avgLead !== null ? Math.round(avgLead * 10) / 10 : null,
          total_value: Math.round(agg.total_value * 100) / 100,
          total_spent: Math.round(agg.total_value * 100) / 100,
          total_spent_formatted: formatRupiah(agg.total_value),
          avg_po_value: Math.round(avgPoValue * 100) / 100,
          quality_score: qualityScore,
          rating,
        };
      })
      .filter(Boolean) as Array<Record<string, any>>;

    rows.sort((a, b) => b.total_value - a.total_value);
    const ranked = rows.map((row, index) => ({ ...row, rank: index + 1 }));
    const totalSpend = ranked.reduce((sum, row) => sum + row.total_value, 0);

    if (exportFormat === "csv") {
      const header =
        "Rank,Kode,Supplier,PIC,Telepon,Email,Total PO,On-Time,Terlambat,On-Time %,Reject %,Lead Time (Hari),Total Nilai,Rating,Quality Score\n";
      const csvRows = ranked
        .map(
          (v) =>
            `${v.rank},${v.supplier_code || ""},"${v.supplier_name || ""}","${v.contact_person || ""}","${v.telepon || ""}","${v.email || ""}",${v.total_po},${v.on_time_count},${v.late_count},${v.on_time_rate ?? ""},${v.reject_rate},${v.avg_lead_time_days ?? ""},${v.total_value},${v.rating},${v.quality_score}`
        )
        .join("\n");

      return new NextResponse(header + csvRows, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="supplier-performance-${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    }

    return successResponse({
      summary: {
        total_suppliers: ranked.length,
        total_vendors: ranked.length,
        period: { from: date_from, to: date_to },
        top_supplier: ranked[0]?.supplier_name || null,
        top_vendor: ranked[0]?.supplier_name || null,
        total_spend_all_suppliers: Math.round(totalSpend * 100) / 100,
        total_spend_all_vendors: Math.round(totalSpend * 100) / 100,
      },
      vendors: ranked,
      suppliers: ranked,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Invalid query params", error.issues).toResponse();
    }
    console.error("Error generating supplier performance:", error);
    return ApiError.server(
      error instanceof Error ? error.message : "Failed to generate report"
    ).toResponse();
  }
}
