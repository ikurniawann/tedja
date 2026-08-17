// ============================================================
// API Route: Employee Salary
// GET: List employee salaries
// POST: Create/update employee salary structure
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// Salary is sensitive financial PII — restrict to HR/finance roles only.
const SALARY_ROLES = ['super_admin', 'hrd', 'finance_staff'] as const;

// ============================================================
// GET /api/hris/employee-salary
// ============================================================

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisCompensation);
    const db = await createServerPgClient();
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employee_id');

    let query = db
      .from('employee_salary')
      .select(`
        *,
        employee:employees (
          id,
          full_name,
          nip,
          photo_url
        )
      `)
      .order('effective_date', { ascending: false });

    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching employee salaries:', error);
      return NextResponse.json(
        { error: 'Gagal mengambil data salary' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in employee-salary API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}

// ============================================================
// POST /api/hris/employee-salary
// Create or update employee salary structure
// ============================================================

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisCompensation);
    const db = await createServerPgClient();
    const body = await request.json();
    const {
      employee_id,
      base_salary,
      fixed_allowance,
      variable_allowance,
      transport_allowance,
      meal_allowance,
      housing_allowance,
      loan_deduction,
      other_deduction,
      ptkp_status,
      is_taxable,
      bpjs_tk_enrolled,
      bpjs_kes_enrolled,
      tapera_enrolled,
      effective_date,
      notes,
    } = body;

    // Validate required fields
    if (!employee_id || !base_salary) {
      return NextResponse.json(
        { error: 'Employee ID dan base salary wajib diisi' },
        { status: 400 }
      );
    }

    // Check if employee exists
    const { data: employee } = await db
      .from('employees')
      .select('id')
      .eq('id', employee_id)
      .single();

    if (!employee) {
      return NextResponse.json(
        { error: 'Karyawan tidak ditemukan' },
        { status: 404 }
      );
    }

    // Deactivate previous salary record for this employee
    await db
      .from('employee_salary')
      .update({ 
        is_active: false,
        end_date: effective_date ? new Date(effective_date).toISOString() : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('employee_id', employee_id)
      .eq('is_active', true);

    // Create new salary record
    const { data, error } = await db
      .from('employee_salary')
      .insert({
        employee_id,
        base_salary,
        fixed_allowance: fixed_allowance || 0,
        variable_allowance: variable_allowance || 0,
        transport_allowance: transport_allowance || 0,
        meal_allowance: meal_allowance || 0,
        housing_allowance: housing_allowance || 0,
        loan_deduction: loan_deduction || 0,
        other_deduction: other_deduction || 0,
        ptkp_status: ptkp_status || 'TK/0',
        is_taxable: is_taxable ?? true,
        bpjs_tk_enrolled: bpjs_tk_enrolled ?? true,
        bpjs_kes_enrolled: bpjs_kes_enrolled ?? true,
        tapera_enrolled: tapera_enrolled ?? true,
        effective_date: effective_date || new Date().toISOString(),
        notes,
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
      console.error('Error creating employee salary:', error);
      return NextResponse.json(
        { error: 'Gagal membuat salary structure', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data,
      message: 'Salary structure berhasil dibuat'
    });

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in employee-salary API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}
