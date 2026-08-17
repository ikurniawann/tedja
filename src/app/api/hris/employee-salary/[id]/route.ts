// ============================================================
// API Route: Employee Salary by ID
// GET: Get salary structure by ID
// PUT: Update salary structure
// DELETE: Delete salary structure
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// Salary is sensitive financial PII — restrict to HR/finance roles only.
const SALARY_ROLES = ['super_admin', 'hrd', 'finance_staff'] as const;

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ============================================================
// GET /api/hris/employee-salary/[id]
// ============================================================

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisCompensation);
    const db = await createServerPgClient();
    const { id } = await params;

    const { data, error } = await db
      .from('employee_salary')
      .select(`
        *,
        employee:employees (
          id,
          full_name,
          nip,
          email,
          phone,
          position:positions (
            title
          ),
          department:departments (
            name
          )
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching employee salary:', error);
      return NextResponse.json(
        { error: 'Gagal mengambil data salary', details: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Data salary tidak ditemukan' },
        { status: 404 }
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
// PUT /api/hris/employee-salary/[id]
// Update salary structure
// ============================================================

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisCompensation);
    const db = await createServerPgClient();
    const { id } = await params;
    const body = await request.json();

    // Build update data (only allow specific fields)
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    // Allowed fields to update
    const allowedFields = [
      'base_salary',
      'fixed_allowance',
      'variable_allowance',
      'transport_allowance',
      'meal_allowance',
      'housing_allowance',
      'loan_deduction',
      'other_deduction',
      'ptkp_status',
      'is_taxable',
      'bpjs_tk_enrolled',
      'bpjs_kes_enrolled',
      'tapera_enrolled',
      'notes',
      'end_date',
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    const { data, error } = await db
      .from('employee_salary')
      .update(updateData)
      .eq('id', id)
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
      console.error('Error updating employee salary:', error);
      return NextResponse.json(
        { error: 'Gagal update data salary', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data,
      message: 'Data salary berhasil diupdate'
    });

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in employee-salary PUT API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}

// ============================================================
// DELETE /api/hris/employee-salary/[id]
// Delete salary structure
// ============================================================

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisCompensation);
    const db = await createServerPgClient();
    const { id } = await params;

    // Soft delete by setting is_active = false
    const { error } = await db
      .from('employee_salary')
      .update({ 
        is_active: false,
        end_date: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) {
      console.error('Error deleting employee salary:', error);
      return NextResponse.json(
        { error: 'Gagal menghapus data salary', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Data salary berhasil dihapus'
    });

  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in employee-salary DELETE API:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server' },
      { status: 500 }
    );
  }
}
