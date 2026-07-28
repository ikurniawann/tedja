import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import { formatRupiah } from "@/lib/purchasing/utils";

// GET /api/purchasing/reports/po-summary

const querySchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  vendor_id: z.string().uuid().optional(),
  status: z.string().optional(),
  export: z.enum(["json", "csv"]).default("json"),
});

export async function GET(request: NextRequest) {
  try {
    await requireApiRole([
      "admin",
      "super_admin",
      "purchasing_admin",
      "purchasing_manager",
      "purchasing_staff",
    ]);
    const db = await createServerPgClient();

    const { searchParams } = new URL(request.url);
    const params = querySchema.parse(Object.fromEntries(searchParams));
    const { date_from, date_to, vendor_id, status, export: exportFormat } = params;

    let query = db
      .from("v_purchase_orders")
      .select(
        `*
      `,
        { count: "exact" }
      )
      .order("tanggal_po", { ascending: false });

    if (date_from) query = query.gte("tanggal_po", date_from);
    if (date_to) query = query.lte("tanggal_po", date_to);
    if (vendor_id) query = query.eq("supplier_id", vendor_id);
    if (status) query = query.eq("status", status.toLowerCase());

    const { data: pos, error } = await query;

    if (error) throw error;

    // Group by status
    const byStatus: Record<string, { count: number; total: number }> = {};
    let grandTotal = 0;

    const summary = (pos || []).map((po: any) => {
      const amount = Number(po.total ?? po.total_amount ?? po.payable_amount ?? 0);
      grandTotal += amount;
      const statusKey = String(po.status || "unknown").toLowerCase();
      if (!byStatus[statusKey]) byStatus[statusKey] = { count: 0, total: 0 };
      byStatus[statusKey].count++;
      byStatus[statusKey].total += amount;

      return {
        po_number: po.nomor_po || po.po_number,
        vendor: po.nama_supplier || po.supplier_name || po.vendor_name || "-",
        vendor_code:
          po.supplier_kode || po.kode_supplier || po.supplier_code || po.vendor_code || "",
        status: statusKey,
        tanggal_po: po.tanggal_po,
        tanggal_diterima: po.tanggal_diterima || null,
        total_amount: amount,
        total_amount_formatted: formatRupiah(amount),
        mata_uang: po.currency || "IDR",
        item_count: Number(po.item_count || po.total_items || 0),
        created_by: po.created_by_name || po.created_by || "-",
      };
    });

    if (exportFormat === "csv") {
      const header = "PO Number,Vendor,Vendor Code,Status,Tanggal PO,Tanggal Diterima,Total Amount,Mata Uang,Item Count,Created By\n";
      const rows = summary
        .map(
          (po: any) =>
            `${po.po_number},"${po.vendor || ""}",${po.vendor_code || ""},${po.status},${po.tanggal_po || ""},${po.tanggal_diterima || ""},${po.total_amount},${po.mata_uang},${po.item_count},"${po.created_by || ""}"`
        )
        .join("\n");

      return new NextResponse(header + rows, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="po-summary-${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        summary: summary,
        by_status: Object.entries(byStatus).map(([k, v]) => ({
          status: k,
          count: v.count,
          total: Math.round(v.total * 100) / 100,
          total_formatted: formatRupiah(v.total),
        })),
        grand_total: Math.round(grandTotal * 100) / 100,
      },
    });
  } catch (error: any) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error generating PO summary:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to generate report" },
      { status: 500 }
    );
  }
}
