// ============================================================
// API Route: Payroll Runs
// GET: List payroll runs
// POST: Create new payroll run
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireApiRole } from '@/lib/api/auth';
import { PAYROLL_MANAGE_ROLES } from '@/lib/payroll/roles';

// ============================================================
// GET /api/hris/payroll
// ============================================================

export async function GET(request: NextRequest) {
  try {
    await requireApiRole([...PAYROLL_MANAGE_ROLES]);
    const db = await createServerPgClient();
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');
    const status = searchParams.get('status');

    let query = db
      .from('payroll_runs')
      .select(`
        *,
        processed_by:employees!processed_by (
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
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false });

    if (year) {
      query = query.eq('period_year', parseInt(year));
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching payroll runs:', error);
      return NextResponse.json(
        { error: 'Gagal mengambil data payroll' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in payroll API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}

// ============================================================
// POST /api/hris/payroll
// Create new payroll run
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const apiUser = await requireApiRole([...PAYROLL_MANAGE_ROLES]);
    const db = await createServerPgClient();
    const body = await request.json();
    const { period_month, period_year, run_name } = body;

    const month = Number(period_month);
    const year = Number(period_year);
    if (
      !Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(year) || year < 2000 || year > 2100
    ) {
      return NextResponse.json(
        { error: 'Bulan dan tahun periode wajib diisi dengan benar' },
        { status: 400 }
      );
    }

    // Check if period already exists
    const { data: existing } = await db
      .from('payroll_runs')
      .select('id')
      .eq('period_month', month)
      .eq('period_year', year)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: 'Payroll untuk periode ini sudah ada' },
        { status: 400 }
      );
    }

    // Get employee record for current user (payroll_runs.processed_by → employees)
    const { data: currentUser } = await db
      .from('employees')
      .select('id')
      .eq('auth_id', apiUser.id)
      .maybeSingle();

    // Create payroll run
    const { data, error } = await db
      .from('payroll_runs')
      .insert({
        run_name: run_name || `Payroll ${getMonthName(month)} ${year}`,
        period_month: month,
        period_year: year,
        status: 'draft',
        processed_by: currentUser?.id,
      })
      .select(`
        *,
        processed_by:employees!processed_by (
          id,
          full_name,
          nip
        )
      `)
      .single();

    if (error) {
      console.error('Error creating payroll run:', error);
      return NextResponse.json(
        { error: 'Gagal membuat payroll run', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data,
      message: 'Payroll run berhasil dibuat'
    });

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in payroll API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}

function getMonthName(month: number): string {
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  return months[month - 1] || '';
}
