// ============================================================
// API Route: Approve/Reject Loan
// POST: Approve or reject loan request
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireApiRole } from '@/lib/api/auth';
import { LOAN_MANAGE_ROLES } from '@/lib/payroll/roles';
import { loadPayrollConfig } from '@/lib/payroll/config';
import { validateLoanLimits } from '@/lib/payroll/loans';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ============================================================
// POST /api/hris/loans/[id]/approve
// ============================================================

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const apiUser = await requireApiRole([...LOAN_MANAGE_ROLES]);
    const db = await createServerPgClient();
    const { id } = await params;
    const body = await request.json();
    const { approved, rejection_reason } = body;

    // Get employee record for current user (approved_by → hris.employees)
    const { data: currentUser } = await db
      .from('employees')
      .select('id')
      .eq('auth_id', apiUser.id)
      .maybeSingle();

    // Get loan
    const { data: loan } = await db
      .from('loans')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!loan) {
      return NextResponse.json(
        { error: 'Pinjaman tidak ditemukan' },
        { status: 404 }
      );
    }

    if (loan.status !== 'pending') {
      return NextResponse.json(
        { error: 'Pinjaman sudah diproses' },
        { status: 400 }
      );
    }

    // Update loan based on approval decision
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (approved) {
      // Validasi ulang limit saat approval — gaji/pinjaman lain bisa
      // berubah sejak pengajuan dibuat.
      const config = await loadPayrollConfig(db, new Date().getFullYear());
      const [{ data: salary }, { data: activeLoans }] = await Promise.all([
        db
          .from('employee_salary')
          .select('base_salary')
          .eq('employee_id', loan.employee_id)
          .eq('is_active', true)
          .order('effective_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from('loans')
          .select('id, status, remaining_balance')
          .eq('employee_id', loan.employee_id)
          .eq('is_active', true)
          .eq('status', 'approved')
          .gt('remaining_balance', 0),
      ]);
      const limitError = validateLoanLimits({
        monthlyInstallment: Number(loan.monthly_installment),
        baseSalary: salary ? Number(salary.base_salary) : null,
        maxInstallmentPercent: config.loan.maxInstallmentPercent,
        activeLoanCount: (activeLoans ?? []).length,
        maxActiveLoans: config.loan.maxActivePerEmployee,
      });
      if (limitError) {
        return NextResponse.json({ error: limitError }, { status: 400 });
      }

      updateData.status = 'approved';
      updateData.approved_by = currentUser?.id;
      updateData.approved_at = new Date().toISOString();

      // Cicilan pertama mulai BULAN DEPAN (gaji bulan ini biasanya sudah/
      // sedang diproses saat pinjaman cair)
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      updateData.first_installment_month = next.getMonth() + 1;
      updateData.first_installment_year = next.getFullYear();
    } else {
      updateData.status = 'rejected';
      updateData.rejected_by = currentUser?.id;
      updateData.rejected_at = new Date().toISOString();
      updateData.rejection_reason = rejection_reason || 'Tidak disetujui';
      updateData.is_active = false;
    }

    const { data, error } = await db
      .from('loans')
      .update(updateData)
      .eq('id', id)
      .eq('status', 'pending')
      .select(`
        *,
        employee:employees!employee_id (
          id,
          full_name,
          nip
        ),
        approved_by:employees!approved_by (
          id,
          full_name,
          nip
        )
      `)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Pinjaman sudah diproses oleh orang lain' },
          { status: 409 }
        );
      }
      console.error('Error updating loan:', error);
      return NextResponse.json(
        { error: 'Gagal update pinjaman', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data,
      message: approved ? 'Pinjaman disetujui — cicilan mulai bulan depan' : 'Pinjaman ditolak'
    });

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in loan approval API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}
