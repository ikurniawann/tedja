// ============================================================
// API Route: Payslips
// GET: List payslips (payroll details)
//   - HR/finance : semua slip (filter bebas)
//   - Karyawan   : hanya slip MILIKNYA dari run berstatus PAID (Fase E)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { getWorkforceActor } from '@/lib/hris/workforce-auth';

// Akses penuh lintas karyawan — slip gaji adalah PII finansial.
const PAYSLIP_FULL_ROLES = ['super_admin', 'hrd', 'finance_staff'] as const;

// ============================================================
// GET /api/hris/payslips
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isFullAccess = (PAYSLIP_FULL_ROLES as readonly string[]).includes(actor.role);

    const db = await createServerPgClient();
    const { searchParams } = new URL(request.url);
    const employeeIdParam = searchParams.get('employee_id');
    const payrollRunId = searchParams.get('payroll_run_id');
    const year = searchParams.get('year');
    const month = searchParams.get('month');

    // Resolusi scoping:
    // - employee_id=me → tampilan PERSONAL utk semua role (termasuk HR):
    //   slip milik sendiri + hanya run paid. Dipakai halaman ESS.
    // - non-HR tanpa parameter → tetap dipaksa ke miliknya sendiri.
    // - HR dengan/atau tanpa parameter eksplisit → akses penuh.
    const isMeView = employeeIdParam === 'me' || !isFullAccess;
    let employeeId: string | null = null;
    if (isMeView) {
      if (!actor.employeeId) {
        return NextResponse.json({ data: [] });
      }
      employeeId = actor.employeeId;
    } else if (employeeIdParam) {
      employeeId = employeeIdParam;
    }

    let query = db
      .from('payroll_details')
      .select(`
        *,
        employee:employees (
          id,
          full_name,
          nip,
          photo_url,
          position:positions (
            title
          ),
          department:departments (
            name
          )
        ),
        payroll_run:payroll_runs (
          id,
          run_name,
          period_month,
          period_year,
          status,
          paid_at
        )
      `)
      .order('created_at', { ascending: false })
      .limit(60);

    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }

    if (payrollRunId) {
      query = query.eq('payroll_run_id', payrollRunId);
    }

    if (year) {
      query = query.eq('period_year', parseInt(year));
    }

    if (month) {
      query = query.eq('period_month', parseInt(month));
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching payslips:', error);
      return NextResponse.json(
        { error: 'Gagal mengambil data payslip' },
        { status: 500 }
      );
    }

    // Tampilan personal hanya menampilkan slip yang gajinya SUDAH dibayar —
    // run draft/processing/completed masih bisa berubah.
    const rows = (data ?? []) as { payroll_run?: { status?: string } | null }[];
    const visible = isMeView
      ? rows.filter((row) => row.payroll_run?.status === 'paid')
      : rows;

    return NextResponse.json({ data: visible });

  } catch (error) {
    console.error('Error in payslips API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}
