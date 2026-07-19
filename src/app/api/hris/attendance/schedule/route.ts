import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";

/**
 * GET /api/hris/attendance/schedule?employee_id=me|<uuid> — pola jadwal
 * shift seorang karyawan (baris employee_shifts + detail shift) untuk
 * ditampilkan di kalender absensi. Karyawan boleh melihat jadwalnya
 * sendiri (employee_id=me); HR boleh melihat siapa pun. Resolusi pola →
 * tanggal dilakukan client-side via lib/hris/shifts.resolveScheduleRowForDate.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let employeeId = req.nextUrl.searchParams.get("employee_id");
    if (!employeeId || employeeId === "me") {
      employeeId = actor.employeeId;
    }
    // non-HR hanya boleh melihat jadwalnya sendiri
    if (!actor.isHr) {
      if (!actor.employeeId) {
        return NextResponse.json(
          { error: "Akun ini tidak terhubung ke data karyawan" },
          { status: 403 }
        );
      }
      employeeId = actor.employeeId;
    }
    if (!employeeId || !UUID_RE.test(employeeId)) {
      return NextResponse.json({ error: "ID karyawan tidak valid" }, { status: 400 });
    }

    const rows = await query(
      `SELECT es.day_of_week, es.shift_id,
              es.effective_from::text, es.effective_to::text,
              s.name AS shift_name, s.start_time::text, s.end_time::text,
              s.is_overnight
       FROM hris.employee_shifts es
       LEFT JOIN hris.shifts s ON s.id = es.shift_id
       WHERE es.employee_id = $1
       ORDER BY es.effective_from DESC, es.day_of_week ASC`,
      [employeeId]
    );

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("[attendance/schedule] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
