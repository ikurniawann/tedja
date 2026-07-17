// ============================================================
// API Route: Employee Loans
// GET: List loans
// POST: Create loan request
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireApiRole } from '@/lib/api/auth';
import { loadPayrollConfig } from '@/lib/payroll/config';
import { validateLoanLimits } from '@/lib/payroll/loans';
import { LOAN_MANAGE_ROLES } from '@/lib/payroll/roles';

// Loan records are sensitive financial PII — restrict to HR/finance/admin
// (selaras menu iam + page guard /dashboard/hris/loans).
const LOAN_VIEW_ROLES = LOAN_MANAGE_ROLES;

// ============================================================
// GET /api/hris/loans
// ============================================================

export async function GET(request: NextRequest) {
  try {
    await requireApiRole([...LOAN_VIEW_ROLES]);
    const db = await createServerPgClient();
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employee_id');
    const status = searchParams.get('status');

    let query = db
      .from('loans')
      .select(`
        *,
        employee:employees (
          id,
          full_name,
          nip,
          photo_url
        ),
        approved_by:employees!approved_by (
          id,
          full_name,
          nip
        )
      `)
      .order('created_at', { ascending: false });

    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching loans:', error);
      return NextResponse.json(
        { error: 'Gagal mengambil data pinjaman' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in loans API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}

// ============================================================
// POST /api/hris/loans
// Create loan request
// ============================================================

export async function POST(request: NextRequest) {
  try {
    await requireApiRole([...LOAN_VIEW_ROLES]);
    const db = await createServerPgClient();
    const body = await request.json();
    const {
      employee_id,
      loan_type,
      principal_amount,
      interest_rate,
      tenor_months,
      purpose,
      notes,
    } = body;

    const principal = Number(principal_amount);
    const tenor = Number(tenor_months);
    const rate = Number(interest_rate) || 0;
    if (
      !employee_id || !loan_type ||
      !Number.isFinite(principal) || principal <= 0 ||
      !Number.isInteger(tenor) || tenor < 1 || tenor > 60 ||
      rate < 0 || rate > 100
    ) {
      return NextResponse.json(
        { error: 'Employee ID, jenis pinjaman, jumlah (> 0), dan tenor (1–60 bulan) wajib valid' },
        { status: 400 }
      );
    }

    // Check if employee exists
    const { data: employee } = await db
      .from('employees')
      .select('id, is_active')
      .eq('id', employee_id)
      .maybeSingle();

    if (!employee) {
      return NextResponse.json(
        { error: 'Karyawan tidak ditemukan' },
        { status: 404 }
      );
    }

    if (!employee.is_active) {
      return NextResponse.json(
        { error: 'Karyawan sudah tidak aktif' },
        { status: 400 }
      );
    }

    // Calculate monthly installment (bunga flat sederhana)
    const monthlyInstallment = rate
      ? principal * (1 + (rate / 100) * tenor) / tenor
      : principal / tenor;

    // Limitasi pinjaman (konfigurabel di pengaturan payroll):
    // cicilan maks % gaji pokok + jumlah pinjaman aktif maks per karyawan
    const config = await loadPayrollConfig(db, new Date().getFullYear());
    const [{ data: salary }, { data: activeLoans }] = await Promise.all([
      db
        .from('employee_salary')
        .select('base_salary')
        .eq('employee_id', employee_id)
        .eq('is_active', true)
        .order('effective_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from('loans')
        .select('id, status, remaining_balance')
        .eq('employee_id', employee_id)
        .eq('is_active', true)
        .in('status', ['pending', 'approved']),
    ]);
    const activeLoanCount = (activeLoans ?? []).filter(
      (loan: { status: string; remaining_balance: unknown }) =>
        loan.status === 'pending' || Number(loan.remaining_balance) > 0
    ).length;

    const limitError = validateLoanLimits({
      monthlyInstallment,
      baseSalary: salary ? Number(salary.base_salary) : null,
      maxInstallmentPercent: config.loan.maxInstallmentPercent,
      activeLoanCount,
      maxActiveLoans: config.loan.maxActivePerEmployee,
    });
    if (limitError) {
      return NextResponse.json({ error: limitError }, { status: 400 });
    }

    // Sisa kewajiban = total yang harus dibayar (termasuk bunga) agar
    // cicilan bulanan bisa mengikisnya sampai 0 — sebelumnya keliru diisi
    // pokok saja sehingga pinjaman berbunga tidak pernah "lunas" konsisten.
    const totalRepayment = Math.round(monthlyInstallment) * tenor;

    // Create loan request
    const { data, error } = await db
      .from('loans')
      .insert({
        employee_id,
        loan_type,
        principal_amount: principal,
        interest_rate: rate,
        tenor_months: tenor,
        monthly_installment: Math.round(monthlyInstallment),
        remaining_balance: totalRepayment,
        purpose,
        notes,
        status: 'pending',
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
      console.error('Error creating loan:', error);
      return NextResponse.json(
        { error: 'Gagal membuat pengajuan pinjaman', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data,
      message: 'Pengajuan pinjaman berhasil dibuat, menunggu approval'
    });

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in loans API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}
