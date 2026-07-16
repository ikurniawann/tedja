import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/hris/leaves/:id
 * Get leave request detail by ID
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const db = await createServerPgClient();
    const { id } = await params;

    const { data, error } = await db
      .from('leaves')
      .select(`
        *,
        employee:employees!employee_id(
          id,
          full_name,
          nip,
          photo_url,
          email,
          phone,
          department:departments(name),
          job_title:positions(title)
        ),
        approver:employees!leaves_approved_by_fkey(
          id,
          full_name,
          nip,
          email
        )
      `)
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Leave request not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error fetching leave detail:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/hris/leaves/:id
 * Update leave request (cancel by employee, or edit)
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const db = await createServerPgClient();
    const { id } = await params;
    const body = await request.json();

    // Check authentication
    const { data: { user } } = await db.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get current leave request
    const { data: leave } = await db
      .from('leaves')
      .select('*')
      .eq('id', id)
      .single();

    if (!leave) {
      return NextResponse.json(
        { error: 'Leave request not found' },
        { status: 404 }
      );
    }

    // Check permissions
    const isOwner = leave.employee_id === await getCurrentEmployeeId(db, user.id);
    const isHRD = await checkIsHRD(db, user.id);
    const isManager = await checkIsManager(db, user.id);

    // Build update object
    const updateData: any = {};
    
    // Employee can only cancel their own pending request
    if (body.status === 'cancelled' && isOwner && leave.status === 'pending') {
      updateData.status = 'cancelled';
    }
    
    // HRD/Manager can update other fields
    if (isHRD || isManager) {
      if (body.reason !== undefined) updateData.reason = body.reason;
      if (body.attachment_url !== undefined) updateData.attachment_url = body.attachment_url;
    }

    // If nothing to update
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No valid updates or insufficient permissions' },
        { status: 403 }
      );
    }

    // Update leave request
    const { data, error } = await db
      .from('leaves')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating leave:', error);
      return NextResponse.json(
        { error: 'Failed to update leave request', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Leave request updated successfully',
      data,
    });
  } catch (error) {
    console.error('Error in leave PUT:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/hris/leaves/:id
 * Delete leave request (HRD only)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const db = await createServerPgClient();
    const { id } = await params;

    // Check authentication
    const { data: { user } } = await db.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if user is HRD
    const isHRD = await checkIsHRD(db, user.id);
    if (!isHRD) {
      return NextResponse.json(
        { error: 'Forbidden: Only HRD can delete leave requests' },
        { status: 403 }
      );
    }

    // Delete leave
    const { error } = await db
      .from('leaves')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting leave:', error);
      return NextResponse.json(
        { error: 'Failed to delete leave request', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Leave request deleted successfully',
    });
  } catch (error) {
    console.error('Error in leave DELETE:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Helper functions
async function getCurrentEmployeeId(db: any, userId: string) {
  const { data } = await db
    .from('employees')
    .select('id')
    .eq('user_id', userId)
    .single();
  
  return data?.id || null;
}

async function checkIsHRD(db: any, userId: string): Promise<boolean> {
  const { data } = await db
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();
  
  return data?.role === 'hrd' || false;
}

async function checkIsManager(db: any, userId: string): Promise<boolean> {
  const { data } = await db
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();
  
  return data?.role === 'hiring_manager' || data?.role === 'hrd' || false;
}
