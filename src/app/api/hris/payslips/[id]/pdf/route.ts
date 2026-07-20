import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { getSettings, SETTING_KEYS } from "@/lib/settings/app-settings";
import { buildPayslipPdf, payslipFileName } from "@/lib/hris/payslip-pdf";
import type { LoanInstallmentDetail } from "@/lib/payroll/loans";

/**
 * GET /api/hris/payslips/[id]/pdf — slip gaji sebagai berkas PDF.
 *
 * Digenerate on-the-fly dari `payroll_details`, yang merupakan snapshot saat
 * payroll dihitung — mengunduh ulang tahun depan menghasilkan angka yang sama.
 *
 * Kepemilikan diperiksa di server: karyawan hanya boleh mengunduh slipnya
 * sendiri. Tanpa ini, mengganti UUID di URL cukup untuk membaca gaji orang
 * lain — data paling sensitif di HRIS.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

type Row = {
  employee_id: string;
  full_name: string;
  nip: string | null;
  position_title: string | null;
  department_name: string | null;
  period_month: number;
  period_year: number;
  run_status: string;
  paid_at: string | null;
  loan_details: LoanInstallmentDetail[] | null;
} & Record<string, unknown>;

const num = (value: unknown): number => Number(value ?? 0) || 0;

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID slip tidak valid" }, { status: 400 });
    }

    if (!checkRateLimit(`payslip_pdf_${actor.userId}`, 30).allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }

    const row = await queryOne<Row>(
      `SELECT pd.*,
              e.id AS employee_id, e.full_name, e.nip,
              p.title AS position_title,
              d.name  AS department_name,
              r.period_month, r.period_year,
              r.status AS run_status, r.paid_at
         FROM hris.payroll_details pd
         JOIN hris.employees e ON e.id = pd.employee_id
         LEFT JOIN hris.positions p ON p.id = e.job_title_id
         LEFT JOIN hris.departments d ON d.id = e.department_id
         JOIN hris.payroll_runs r ON r.id = pd.payroll_run_id
        WHERE pd.id = $1`,
      [id]
    );

    if (!row) {
      return NextResponse.json({ error: "Slip gaji tidak ditemukan" }, { status: 404 });
    }

    // Karyawan biasa hanya boleh slipnya sendiri; HR boleh semua.
    if (!actor.isHr && row.employee_id !== actor.employeeId) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const settings = await getSettings([
      SETTING_KEYS.COMPANY_LEGAL_NAME,
      SETTING_KEYS.COMPANY_ADDRESS,
      SETTING_KEYS.COMPANY_CITY,
    ]).catch(() => ({}) as Record<string, string | null>);

    const period = {
      month: Number(row.period_month),
      year: Number(row.period_year),
      paid_at: row.paid_at,
      status: row.run_status,
    };

    const pdf = await buildPayslipPdf({
      company: {
        legal_name: settings[SETTING_KEYS.COMPANY_LEGAL_NAME] ?? null,
        address: settings[SETTING_KEYS.COMPANY_ADDRESS] ?? null,
        city: settings[SETTING_KEYS.COMPANY_CITY] ?? null,
      },
      employee: {
        full_name: row.full_name,
        nip: row.nip,
        position_title: row.position_title,
        department_name: row.department_name,
      },
      period,
      amounts: {
        base_salary: num(row.base_salary),
        fixed_allowance: num(row.fixed_allowance),
        variable_allowance: num(row.variable_allowance),
        transport_allowance: num(row.transport_allowance),
        meal_allowance: num(row.meal_allowance),
        housing_allowance: num(row.housing_allowance),
        overtime_pay: num(row.overtime_pay),
        thr: num(row.thr),
        bonus: num(row.bonus),
        other_earning: num(row.other_earning),
        gross_salary: num(row.gross_salary),
        bpjs_tk_jht_deduction: num(row.bpjs_tk_jht_deduction),
        bpjs_tk_jp_deduction: num(row.bpjs_tk_jp_deduction),
        bpjs_kes_deduction: num(row.bpjs_kes_deduction),
        tapera_deduction: num(row.tapera_deduction),
        pph21_deduction: num(row.pph21_deduction),
        unpaid_leave_deduction: num(row.unpaid_leave_deduction),
        late_deduction: num(row.late_deduction),
        loan_deduction: num(row.loan_deduction),
        other_deduction: num(row.other_deduction),
        total_deductions: num(row.total_deductions),
        net_salary: num(row.net_salary),
        working_days: num(row.working_days),
        present_days: num(row.present_days),
        overtime_hours: num(row.overtime_hours),
        loan_details: Array.isArray(row.loan_details) ? row.loan_details : [],
      },
    });

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `attachment; filename="${payslipFileName(row.full_name, period)}"`,
        // Slip memuat data gaji — jangan sampai tersimpan di cache bersama.
        "Cache-Control": "no-store, private",
      },
    });
  } catch (error) {
    console.error("[payslip-pdf] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
