import { NextRequest, NextResponse } from 'next/server';
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// Bulk attendance export is HR-only.
const HR_EXPORT_ROLES = ['super_admin', 'hrd'] as const;

/**
 * GET /api/hris/attendance/export
 * Export attendance data to CSV
 */
export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hris);
    const db = await createServerPgClient();
    
    // Get query params
    const searchParams = request.nextUrl.searchParams;
    const employeeId = searchParams.get('employee_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const status = searchParams.get('status');
    const format = searchParams.get('format') || 'csv';

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
        employee:employees!attendance_employee_id_fkey(
          full_name,
          nip,
          department:departments(name),
          job_title:positions(title)
        )
      `);

    // Apply filters
    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }
    
    if (startDate && endDate) {
      query = query.gte('date', startDate).lte('date', endDate);
    }
    
    if (status) {
      query = query.eq('status', status);
    }

    query = query.order('date', { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching attendance for export:', error);
      return NextResponse.json(
        { error: 'Failed to fetch attendance data', details: error.message },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'No attendance data found' },
        { status: 404 }
      );
    }

    // Convert to CSV
    const csv = convertToCSV(data);
    
    // Generate filename with date
    const filename = `attendance_export_${new Date().toISOString().split('T')[0]}.csv`;

    // Return CSV file
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv;charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in attendance export:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function convertToCSV(data: any[]): string {
  // Define CSV headers
  const headers = [
    'NIP',
    'Nama Karyawan',
    'Departemen',
    'Jabatan',
    'Tanggal',
    'Clock In',
    'Clock Out',
    'Lokasi Clock In',
    'Lokasi Clock Out',
    'Jam Kerja (jam)',
    'Istirahat (menit)',
    'Status',
    'Terlambat',
    'Keterlambatan (menit)',
    'Catatan',
  ];

  // Convert rows
  const rows = data.map((record) => {
    const clockIn = record.clock_in 
      ? new Date(record.clock_in).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
      : '-';
    
    const clockOut = record.clock_out 
      ? new Date(record.clock_out).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
      : '-';
    
    const clockInLocation = record.clock_in_location 
      ? `${record.clock_in_location.latitude},${record.clock_in_location.longitude}${record.clock_in_location.address ? ` (${record.clock_in_location.address})` : ''}`
      : '-';
    
    const clockOutLocation = record.clock_out_location 
      ? `${record.clock_out_location.latitude},${record.clock_out_location.longitude}${record.clock_out_location.address ? ` (${record.clock_out_location.address})` : ''}`
      : '-';

    return [
      record.employee?.nip || '-',
      record.employee?.full_name || '-',
      record.employee?.department?.name || '-',
      record.employee?.job_title?.title || '-',
      record.date,
      clockIn,
      clockOut,
      clockInLocation,
      clockOutLocation,
      record.work_hours || 0,
      record.break_minutes || 0,
      record.status || '-',
      record.is_late ? 'Ya' : 'Tidak',
      record.late_minutes || 0,
      record.notes || '-',
    ].map((field) => `"${String(field).replace(/"/g, '""')}"`).join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}
