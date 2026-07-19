import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/hris/attendance/:id
 * Get attendance detail by ID
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const db = await createServerPgClient();
    const { id } = await params;

    const { data, error } = await db
      .from('attendance')
      .select(`
        *,
        employee:employees!inner(
          id,
          full_name,
          nip,
          photo_url,
          email,
          department_id,
          job_title_id
        )
      `)
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Attendance not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error fetching attendance detail:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/hris/attendance/:id
 * Update attendance (validate, edit notes, etc.)
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const db = await createServerPgClient();
    const { id } = await params;
    const body = await request.json();

    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actor.isHr) {
      return NextResponse.json(
        { error: 'Forbidden: Only HRD or managers can update attendance' },
        { status: 403 }
      );
    }

    // Build update object
    const updateData: any = {};

    if (body.status !== undefined) {
      updateData.status = body.status;
    }

    if (body.notes !== undefined) {
      updateData.notes = body.notes;
    }

    if (body.validation_notes !== undefined) {
      updateData.validation_notes = body.validation_notes;
    }

    if (body.validated === true) {
      // FK validated_by → hris.employees(id): pakai record karyawan si
      // validator; null bila akun tidak tertaut karyawan (mis. super admin)
      updateData.validated_by = actor.employeeId;
      updateData.validated_at = new Date().toISOString();
    }

    // Update attendance
    const { data, error } = await db
      .from('attendance')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating attendance:', error);
      return NextResponse.json(
        { error: 'Failed to update attendance', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Attendance updated successfully',
      data,
    });
  } catch (error) {
    console.error('Error in attendance PUT:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/hris/attendance/:id
 * Delete attendance record (HRD only)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const db = await createServerPgClient();
    const { id } = await params;

    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!['super_admin', 'admin', 'hrd'].includes(actor.role)) {
      return NextResponse.json(
        { error: 'Forbidden: Only HRD can delete attendance records' },
        { status: 403 }
      );
    }

    // Delete attendance
    const { error } = await db
      .from('attendance')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting attendance:', error);
      return NextResponse.json(
        { error: 'Failed to delete attendance', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Attendance deleted successfully',
    });
  } catch (error) {
    console.error('Error in attendance DELETE:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
