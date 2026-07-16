import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { z } from 'zod';

// Validation schemas
const clockInSchema = z.object({
  employee_id: z.string().uuid().optional(),
  date: z.string().optional(), // defaults to today
  clock_in_location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracy: z.number().optional(),
    address: z.string().optional(),
    ip_address: z.string().optional(),
  }).optional(),
  notes: z.string().optional(),
});

const clockOutSchema = z.object({
  attendance_id: z.string().uuid(),
  clock_out_location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracy: z.number().optional(),
    address: z.string().optional(),
    ip_address: z.string().optional(),
  }).optional(),
  notes: z.string().optional(),
});

/**
 * GET /api/hris/attendance
 * List attendance records with filters
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await createServerPgClient();

    // Get query params
    const searchParams = request.nextUrl.searchParams;
    let employeeId = searchParams.get('employee_id');
    // "me" = absensi milik sendiri (dipakai pemulihan state clock-out)
    if (employeeId === 'me') {
      if (!actor.employeeId) {
        return NextResponse.json({
          data: [],
          pagination: { page: 1, limit: 0, total: 0, totalPages: 0 },
        });
      }
      employeeId = actor.employeeId;
    }
    // non-HR hanya boleh melihat absensinya sendiri
    if (!actor.isHr) {
      if (!actor.employeeId) {
        return NextResponse.json(
          { error: 'Akun ini tidak terhubung ke data karyawan' },
          { status: 403 }
        );
      }
      employeeId = actor.employeeId;
    }
    const date = searchParams.get('date');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    // Build query
    let query = db
      .from('attendance')
      .select(`
        id,
        employee_id,
        date,
        clock_in,
        clock_out,
        clock_in_location,
        clock_out_location,
        work_hours,
        break_minutes,
        status,
        is_late,
        late_minutes,
        notes,
        created_at,
        updated_at,
        employee:employees!attendance_employee_id_fkey(
          id,
          full_name,
          nip,
          photo_url,
          department_id,
          job_title_id
        )
      `, { count: 'exact' });

    // Apply filters
    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }
    
    if (date) {
      query = query.eq('date', date);
    }
    
    if (startDate && endDate) {
      query = query.gte('date', startDate).lte('date', endDate);
    }
    
    if (status) {
      query = query.eq('status', status);
    }

    // Pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to).order('date', { ascending: false });

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching attendance:', error);
      return NextResponse.json(
        { error: 'Failed to fetch attendance', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('Error in attendance GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/hris/attendance
 * Clock-in or Clock-out
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await createServerPgClient();
    const body = await request.json();

    // Determine action: clock-in or clock-out
    const { action, employee_id, date } = body;

    if (action === 'clock-in') {
      // Validate clock-in data
      const validated = clockInSchema.parse(body);

      // non-HR hanya boleh clock-in untuk dirinya sendiri
      const empId = actor.isHr && employee_id ? employee_id : actor.employeeId;
      if (!empId) {
        return NextResponse.json(
          { error: 'Akun ini tidak terhubung ke data karyawan' },
          { status: 404 }
        );
      }

      // Check if already clocked in today
      const today = date || new Date().toISOString().split('T')[0];
      const { data: existing } = await db
        .from('attendance')
        .select('id')
        .eq('employee_id', empId)
        .eq('date', today)
        .single();

      if (existing) {
        return NextResponse.json(
          { error: 'Already clocked in today', attendance_id: existing.id },
          { status: 400 }
        );
      }

      // Create attendance record
      const { data, error } = await db
        .from('attendance')
        .insert({
          employee_id: empId,
          date: today,
          clock_in: new Date().toISOString(),
          clock_in_location: validated.clock_in_location || null,
          notes: validated.notes || null,
          status: 'present',
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating attendance:', error);
        return NextResponse.json(
          { error: 'Failed to clock in', details: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        message: 'Clock-in successful',
        data,
      });
    }

    if (action === 'clock-out') {
      // Validate clock-out data
      const validated = clockOutSchema.parse(body);

      // Get attendance record
      const { data: attendance, error: fetchError } = await db
        .from('attendance')
        .select('*')
        .eq('id', validated.attendance_id)
        .single();

      if (fetchError || !attendance) {
        return NextResponse.json(
          { error: 'Attendance record not found' },
          { status: 404 }
        );
      }
      // non-HR hanya boleh clock-out absensinya sendiri
      if (!actor.isHr && attendance.employee_id !== actor.employeeId) {
        return NextResponse.json(
          { error: 'Tidak boleh mengubah absensi karyawan lain' },
          { status: 403 }
        );
      }
      if (attendance.clock_out) {
        return NextResponse.json(
          { error: 'Sudah clock-out untuk absensi ini' },
          { status: 400 }
        );
      }

      // Update clock-out
      const { data, error } = await db
        .from('attendance')
        .update({
          clock_out: new Date().toISOString(),
          clock_out_location: validated.clock_out_location || null,
          notes: validated.notes ? `${attendance.notes || ''}\n${validated.notes}`.trim() : attendance.notes,
          // work_hours will be auto-calculated by trigger
        })
        .eq('id', validated.attendance_id)
        .select()
        .single();

      if (error) {
        console.error('Error updating attendance:', error);
        return NextResponse.json(
          { error: 'Failed to clock out', details: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        message: 'Clock-out successful',
        data,
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "clock-in" or "clock-out"' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error in attendance POST:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
