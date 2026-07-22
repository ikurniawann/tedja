import { NextRequest, NextResponse } from "next/server";
import { paginatedResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { BOOKING_STATUSES } from "@/lib/ticketing/booking";
import { isValidCalendarDate } from "@/lib/ticketing/pricing";
import { requireTicketingContext } from "@/lib/ticketing/server";

// Fase D5 — daftar booking website utk dashboard (super_admin, konsisten
// menu "Booking"). Filter: tanggal kunjungan, status, cari kode/nama/WA.

interface BookingListRow {
  id: string;
  booking_code: string;
  visit_date: string;
  customer_name: string;
  customer_phone: string;
  status: string;
  total: string;
  paid_at: string | null;
  used_at: string | null;
  visit_id: string | null;
  refund_note: string | null;
  created_at: string;
  total_count: string;
}

export async function GET(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const sp = request.nextUrl.searchParams;
    const date = sp.get("date") ?? "";
    const status = sp.get("status") ?? "";
    const q = (sp.get("q") ?? "").trim();
    const page = Math.max(1, Number(sp.get("page")) || 1);
    const limit = Math.min(50, Math.max(1, Number(sp.get("limit")) || 20));

    const conditions = ["b.branch_id = $1", "b.company_id = $2"];
    const params: unknown[] = [ctx.branchId, ctx.companyId];

    if (isValidCalendarDate(date)) {
      params.push(date);
      conditions.push(`b.visit_date = $${params.length}`);
    }
    if ((BOOKING_STATUSES as readonly string[]).includes(status)) {
      params.push(status);
      conditions.push(`b.status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      conditions.push(
        `(b.booking_code ILIKE $${params.length}
          OR b.customer_name ILIKE $${params.length}
          OR b.customer_phone ILIKE $${params.length})`
      );
    }

    params.push(limit, (page - 1) * limit);
    const rows = await query<BookingListRow>(
      `SELECT b.id, b.booking_code, b.visit_date::text AS visit_date,
              b.customer_name, b.customer_phone, b.status, b.total,
              b.paid_at::text AS paid_at, b.used_at::text AS used_at,
              b.visit_id, b.refund_note, b.created_at::text AS created_at,
              COUNT(*) OVER() AS total_count
       FROM ticketing.ticket_bookings b
       WHERE ${conditions.join(" AND ")}
       ORDER BY b.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    const data = rows.map((row) => {
      const { total_count, ...booking } = row;
      void total_count;
      return { ...booking, total: Number(booking.total) };
    });
    return paginatedResponse(data, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("[ticketing] list bookings error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat daftar booking" },
      { status: 500 }
    );
  }
}
