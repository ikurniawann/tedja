// ============================================================
// API Route: Calculate Payroll for a Run
// POST: Calculate payroll for all employees in a run
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { calculatePayroll } from '@/lib/payroll/calculator';
import { loadEmployeePayrollInput } from '@/lib/payroll/inputs';
import { loadPayrollConfig } from '@/lib/payroll/config';
import { ApiError, requireApiRole } from '@/lib/api/auth';
import { PAYROLL_MANAGE_ROLES } from '@/lib/payroll/roles';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ============================================================
// POST /api/hris/payroll/[id]/calculate
// ============================================================

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    await requireApiRole([...PAYROLL_MANAGE_ROLES]);
    const db = await createServerPgClient();
    const { id } = await params;

    // Get payroll run
    const { data: payrollRun } = await db
      .from('payroll_runs')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!payrollRun) {
      return NextResponse.json(
        { error: 'Payroll run tidak ditemukan' },
        { status: 404 }
      );
    }

    if (payrollRun.status !== 'draft') {
      return NextResponse.json(
        { error: 'Hanya payroll draft yang bisa dihitung' },
        { status: 400 }
      );
    }

    // Parse request body for options
    const body = await request.json().catch(() => ({}));
    const includeThr = body.include_thr ?? false;

    // Konfigurasi tarif dari DB (payroll_settings + tax config tahun periode)
    const config = await loadPayrollConfig(db, payrollRun.period_year);

    // Delete existing payroll details for this run (prevent duplicates on recalculate)
    const { error: deleteError } = await db
      .from('payroll_details')
      .delete()
      .eq('payroll_run_id', id);

    if (deleteError) {
      console.error('Error deleting old payroll details:', deleteError);
      return NextResponse.json(
        { error: 'Gagal membersihkan hasil kalkulasi sebelumnya' },
        { status: 500 }
      );
    }

    // Get all active employees
    const { data: employees, error: empError } = await db
      .from('employees')
      .select('id, full_name, nip, is_active, employment_status, join_date')
      .eq('is_active', true);

    if (empError) {
      console.error('Error fetching employees:', empError);
      return NextResponse.json(
        { error: 'Gagal fetch karyawan', details: empError.message },
        { status: 500 }
      );
    }

    if (!employees || employees.length === 0) {
      return NextResponse.json(
        { error: 'Tidak ada karyawan aktif ditemukan' },
        { status: 400 }
      );
    }

    const results: unknown[] = [];
    const skipped: { employee_id: string; full_name: string; reason: string }[] = [];
    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;
    let totalBjtkEmployee = 0;
    let totalBjtkEmployer = 0;
    let totalPph21 = 0;

    // Calculate payroll for each employee
    for (const employee of employees) {
      const input = await loadEmployeePayrollInput(
        db,
        employee,
        payrollRun.period_month,
        payrollRun.period_year,
        { includeThr }
      );

      if (!input) {
        skipped.push({
          employee_id: employee.id,
          full_name: employee.full_name,
          reason: 'Belum ada struktur gaji aktif',
        });
        continue;
      }

      let payrollResult;
      try {
        payrollResult = await calculatePayroll(input, config);
      } catch (calcError) {
        console.error(`Calculation error for employee ${employee.id}:`, calcError);
        skipped.push({
          employee_id: employee.id,
          full_name: employee.full_name,
          reason: 'Gagal menghitung',
        });
        continue;
      }

      // Insert payroll detail
      const { data: detail, error } = await db
        .from('payroll_details')
        .insert({
          payroll_run_id: id,
          employee_id: employee.id,
          base_salary: payrollResult.baseSalary,
          fixed_allowance: payrollResult.fixedAllowance,
          variable_allowance: payrollResult.variableAllowance,
          transport_allowance: payrollResult.transportAllowance,
          meal_allowance: payrollResult.mealAllowance,
          housing_allowance: payrollResult.housingAllowance,
          overtime_pay: payrollResult.overtimePay,
          thr: payrollResult.thr,
          bonus: payrollResult.bonus,
          other_earning: payrollResult.otherEarning,
          gross_salary: payrollResult.grossSalary,
          bpjs_tk_jht_deduction: payrollResult.bpjsTkJhtDeduction,
          bpjs_tk_jp_deduction: payrollResult.bpjsTkJpDeduction,
          bpjs_kes_deduction: payrollResult.bpjsKesDeduction,
          tapera_deduction: payrollResult.taperaDeduction,
          pph21_deduction: payrollResult.pph21Deduction,
          unpaid_leave_deduction: payrollResult.unpaidLeaveDeduction,
          other_deduction: payrollResult.otherDeduction,
          total_deductions: payrollResult.totalDeductions,
          net_salary: payrollResult.netSalary,
          bpjs_tk_jht_employer: payrollResult.bpjsTkJhtEmployer,
          bpjs_tk_jp_employer: payrollResult.bpjsTkJpEmployer,
          bpjs_tk_jkk_employer: payrollResult.bpjsTkJkkEmployer,
          bpjs_tk_jkm_employer: payrollResult.bpjsTkJkmEmployer,
          bpjs_kes_employer: payrollResult.bpjsKesEmployer,
          tapera_employer: payrollResult.taperaEmployer,
          taxable_income: payrollResult.taxableIncome,
          ptkp_amount: payrollResult.ptkpAmount,
          pph21_annual: payrollResult.pph21Annual,
          pph21_monthly: payrollResult.pph21Monthly,
          working_days: input.workingDays,
          present_days: input.presentDays,
          late_days: input.lateDays,
          unpaid_leave_days: input.unpaidLeaveDays,
          status: 'calculated',
        })
        .select(`
          *,
          employee:employees (
            id,
            full_name,
            nip
          )
        `)
        .single();

      if (error) {
        console.error(`Error inserting payroll detail for employee ${employee.id}:`, error);
        skipped.push({
          employee_id: employee.id,
          full_name: employee.full_name,
          reason: 'Gagal menyimpan detail',
        });
        continue;
      }

      results.push(detail);

      // Accumulate totals
      totalGross += payrollResult.grossSalary;
      totalDeductions += payrollResult.totalDeductions;
      totalNet += payrollResult.netSalary;
      totalBjtkEmployee += payrollResult.bpjsTkJhtDeduction + payrollResult.bpjsTkJpDeduction + payrollResult.bpjsKesDeduction + payrollResult.taperaDeduction;
      totalBjtkEmployer += payrollResult.totalEmployerContribution;
      totalPph21 += payrollResult.pph21Deduction;
    }

    // Collect employee names for summary
    const employeeNames = results.map((r) => {
      const emp = (r as { employee?: { full_name?: string } }).employee;
      return emp?.full_name ?? 'Unknown';
    });

    // Update payroll run with totals
    await db
      .from('payroll_runs')
      .update({
        total_employees: results.length,
        total_gross: totalGross,
        total_deductions: totalDeductions,
        total_net: totalNet,
        total_bjtk_employee: totalBjtkEmployee,
        total_bjtk_employer: totalBjtkEmployer,
        total_pph21: totalPph21,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    return NextResponse.json({
      data: results,
      summary: {
        total_employees: results.length,
        employee_names: employeeNames,
        skipped,
        total_gross: totalGross,
        total_deductions: totalDeductions,
        total_net: totalNet,
        total_bjtk_employee: totalBjtkEmployee,
        total_bjtk_employer: totalBjtkEmployer,
        total_pph21: totalPph21,
      },
      message: `Payroll berhasil dihitung untuk ${results.length} karyawan${skipped.length ? `, ${skipped.length} dilewati` : ''}`
    });

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error calculating payroll:', error);
    return NextResponse.json(
      { error: 'Gagal menghitung payroll', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
