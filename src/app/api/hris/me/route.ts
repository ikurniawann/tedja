import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";

/**
 * GET /api/hris/me — identitas karyawan milik akun yang login + kuota cuti
 * tahun berjalan. Dipakai halaman ESS (/dashboard/me). employee null bila
 * akun tidak tertaut record karyawan (mis. super admin).
 */
export async function GET() {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!actor.employeeId) {
      return NextResponse.json({ data: { employee: null, leave_balance: null } });
    }

    const [employee, leaveBalance] = await Promise.all([
      queryOne<{
        id: string;
        full_name: string;
        nip: string | null;
        join_date: string | null;
        employment_status: string;
        position_title: string | null;
        department_name: string | null;
      }>(
        `SELECT e.id, e.full_name, e.nip, e.join_date, e.employment_status,
                p.title AS position_title, d.name AS department_name
         FROM hris.employees e
         LEFT JOIN hris.positions p ON p.id = e.job_title_id
         LEFT JOIN hris.departments d ON d.id = e.department_id
         WHERE e.id = $1`,
        [actor.employeeId]
      ),
      queryOne<{
        year: number;
        annual_leave_total: string;
        annual_leave_used: string;
        annual_leave_remaining: string;
      }>(
        `SELECT year, annual_leave_total, annual_leave_used, annual_leave_remaining
         FROM hris.leave_balances
         WHERE employee_id = $1 AND year = date_part('year', now())::int`,
        [actor.employeeId]
      ),
    ]);

    return NextResponse.json({ data: { employee, leave_balance: leaveBalance } });
  } catch (error) {
    console.error("[hris/me] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
