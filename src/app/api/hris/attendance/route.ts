import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { query } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { savePrivateImage } from "@/lib/storage-private";
import {
  computeLateness,
  resolveShiftForDate,
  scheduledWindow,
  type EmployeeShiftRow,
} from "@/lib/hris/shifts";
import { z } from 'zod';

// Validation schemas — foto selfie (data URL) WAJIB utk clock-in & clock-out
const photoSchema = z
  .string()
  .regex(/^data:image\/(jpeg|png|webp);base64,/, "Foto selfie wajib disertakan");

const clockInSchema = z.object({
  employee_id: z.string().uuid().optional(),
  date: z.string().optional(), // defaults to today
  photo: photoSchema,
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
  photo: photoSchema,
  clock_out_location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracy: z.number().optional(),
    address: z.string().optional(),
    ip_address: z.string().optional(),
  }).optional(),
  notes: z.string().optional(),
});

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** Simpan selfie (data URL) ke storage private; return path relatif. */
async function saveSelfie(
  dataUrl: string,
  employeeId: string
): Promise<{ path: string | null; error: string | null }> {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) return { path: null, error: "Format foto tidak valid" };
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > MAX_PHOTO_BYTES) {
    return { path: null, error: "Ukuran foto maksimal 2 MB" };
  }
  return savePrivateImage(buffer, match[1], `attendance/${employeeId}`);
}

/** Tanggal hari ini menurut WIB (jam kerja operasional). */
function todayWib(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().split("T")[0];
}

interface ScheduleJoinRow extends EmployeeShiftRow {
  name: string | null;
  start_time: string | null;
  end_time: string | null;
  late_tolerance_minutes: number | null;
  is_overnight: boolean | null;
}

/** Snapshot shift + keterlambatan utk sebuah clock-in. */
async function shiftSnapshot(employeeId: string, dateIso: string, clockIn: Date) {
  const rows = await query<ScheduleJoinRow>(
    `SELECT es.day_of_week, es.shift_id,
            es.effective_from::text, es.effective_to::text,
            s.name, s.start_time::text, s.end_time::text,
            s.late_tolerance_minutes, s.is_overnight
     FROM hris.employee_shifts es
     LEFT JOIN hris.shifts s ON s.id = es.shift_id
     WHERE es.employee_id = $1`,
    [employeeId]
  );
  const active = resolveShiftForDate(rows, dateIso);
  const detail = active
    ? rows.find((row) => row.shift_id === active.shift_id && row.name)
    : null;
  if (!active || !detail?.start_time || !detail.end_time) {
    // tanpa jadwal / libur — absen tetap tercatat, tanpa penilaian terlambat
    return {
      shift_id: null,
      scheduled_start: null,
      scheduled_end: null,
      is_late: false,
      late_minutes: 0,
    };
  }
  const shift = {
    start_time: detail.start_time,
    end_time: detail.end_time,
    is_overnight: detail.is_overnight ?? false,
    late_tolerance_minutes: detail.late_tolerance_minutes ?? 0,
  };
  const window = scheduledWindow(dateIso, shift);
  const lateness = computeLateness(clockIn, dateIso, shift);
  return {
    shift_id: active.shift_id,
    scheduled_start: window.start.toISOString(),
    scheduled_end: window.end.toISOString(),
    ...lateness,
  };
}

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
        clock_in_photo_url,
        clock_out_photo_url,
        shift_id,
        scheduled_start,
        scheduled_end,
        work_hours,
        break_minutes,
        status,
        is_late,
        late_minutes,
        notes,
        created_at,
        updated_at,
        shift:shifts(id, name),
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
      const today = date || todayWib();
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

      // Selfie wajib — simpan ke storage private
      const selfie = await saveSelfie(validated.photo, empId);
      if (!selfie.path) {
        return NextResponse.json(
          { error: selfie.error ?? 'Foto selfie tidak valid' },
          { status: 400 }
        );
      }

      // Snapshot shift + keterlambatan dari jadwal karyawan
      const clockInAt = new Date();
      const snapshot = await shiftSnapshot(empId, today, clockInAt);

      // Create attendance record
      const { data, error } = await db
        .from('attendance')
        .insert({
          employee_id: empId,
          date: today,
          clock_in: clockInAt.toISOString(),
          clock_in_location: validated.clock_in_location || null,
          clock_in_photo_url: selfie.path,
          shift_id: snapshot.shift_id,
          scheduled_start: snapshot.scheduled_start,
          scheduled_end: snapshot.scheduled_end,
          is_late: snapshot.is_late,
          late_minutes: snapshot.late_minutes,
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

      // Selfie wajib juga saat pulang
      const selfie = await saveSelfie(validated.photo, attendance.employee_id);
      if (!selfie.path) {
        return NextResponse.json(
          { error: selfie.error ?? 'Foto selfie tidak valid' },
          { status: 400 }
        );
      }

      // Update clock-out
      const { data, error } = await db
        .from('attendance')
        .update({
          clock_out: new Date().toISOString(),
          clock_out_location: validated.clock_out_location || null,
          clock_out_photo_url: selfie.path,
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
