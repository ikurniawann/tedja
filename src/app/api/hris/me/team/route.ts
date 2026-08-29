import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { listDirectSubordinates } from "@/lib/hris/team";

/**
 * GET /api/hris/me/team — anggota tim (bawahan langsung menurut
 * employees.reporting_to) milik karyawan yang sedang login, beserta
 * ringkasan pola shift yang berlaku hari ini. Dipakai halaman
 * Area Karyawan → Shift Tim (permintaan owner 2026-08-29): supervisor /
 * kepala divisi mengatur jadwal timnya sendiri, bukan hanya HRD.
 *
 * Karyawan tanpa bawahan menerima daftar kosong — halaman menampilkan
 * penjelasan, bukan error.
 */
export async function GET() {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!actor.employeeId) {
      return NextResponse.json({ data: { members: [] } });
    }

    const members = await listDirectSubordinates(actor.employeeId);
    if (members.length === 0) {
      return NextResponse.json({ data: { members: [] } });
    }

    // Ringkasan pola aktif hari ini per anggota: "Senin–Jumat Pagi" terlalu
    // mahal dirangkai di SQL — cukup jumlah hari kerja + nama shift unik.
    const summary = await query<{
      employee_id: string;
      shift_names: string | null;
      work_days: number;
      effective_from: string | null;
    }>(
      `SELECT es.employee_id,
              string_agg(DISTINCT s.name, ', ' ORDER BY s.name) AS shift_names,
              count(*) FILTER (WHERE es.shift_id IS NOT NULL)::int AS work_days,
              max(es.effective_from)::text AS effective_from
       FROM hris.employee_shifts es
       LEFT JOIN hris.shifts s ON s.id = es.shift_id
       WHERE es.employee_id = ANY($1::uuid[])
         AND es.effective_from <= CURRENT_DATE
         AND (es.effective_to IS NULL OR es.effective_to >= CURRENT_DATE)
       GROUP BY es.employee_id`,
      [members.map((m) => m.id)]
    );
    const byEmployee = new Map(summary.map((row) => [row.employee_id, row]));

    return NextResponse.json({
      data: {
        members: members.map((m) => {
          const s = byEmployee.get(m.id);
          return {
            ...m,
            schedule_summary: s
              ? `${s.work_days} hari kerja/minggu${s.shift_names ? ` — ${s.shift_names}` : ""}`
              : null,
            schedule_since: s?.effective_from ?? null,
          };
        }),
      },
    });
  } catch (error) {
    console.error("[me/team] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
