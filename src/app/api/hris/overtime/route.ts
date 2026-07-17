// ============================================================
// API Route: Pengajuan Lembur (EPIC-008 Fase B)
// GET : daftar pengajuan — HR semua; karyawan miliknya; atasan langsung
//       bisa scope=approvals (pengajuan anak buah)
// POST: buat pengajuan — karyawan utk diri sendiri (source 'employee');
//       HRD utk karyawan lain = penugasan perusahaan (source 'company')
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerPgClient } from "@/lib/pg/create-client";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { overtimeHoursFromTimes } from "@/lib/payroll/period";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const createSchema = z.object({
  employee_id: z.string().optional(), // default: diri sendiri
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(TIME_RE),
  end_time: z.string().regex(TIME_RE),
  reason: z.string().trim().min(5, 'Alasan minimal 5 karakter'),
});

const OVERTIME_SELECT = `
  *,
  employee:employees!employee_id (
    id, full_name, nip, reporting_to,
    department:departments ( name )
  ),
  requester:employees!requested_by ( id, full_name ),
  decider:employees!decided_by ( id, full_name )
`;

// ============================================================
// GET /api/hris/overtime
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await createServerPgClient();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const month = Number(searchParams.get('month'));
    const year = Number(searchParams.get('year'));
    const employeeIdParam = searchParams.get('employee_id');
    const scope = searchParams.get('scope');

    let query = db
      .from('overtime_requests')
      .select(OVERTIME_SELECT)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);

    if (scope === 'approvals') {
      // Pengajuan yang menunggu keputusan SAYA sebagai atasan langsung
      if (!actor.employeeId) {
        return NextResponse.json({ data: [] });
      }
      const { data: subordinates } = await db
        .from('employees')
        .select('id')
        .eq('reporting_to', actor.employeeId);
      const ids = (subordinates ?? []).map((row: { id: string }) => row.id);
      if (ids.length === 0) {
        return NextResponse.json({ data: [] });
      }
      query = query.in('employee_id', ids).eq('source', 'employee');
    } else if (actor.isHr) {
      if (employeeIdParam && employeeIdParam !== 'me') {
        query = query.eq('employee_id', employeeIdParam);
      } else if (employeeIdParam === 'me' && actor.employeeId) {
        query = query.eq('employee_id', actor.employeeId);
      }
    } else {
      // Non-HR hanya boleh melihat pengajuan miliknya sendiri
      if (!actor.employeeId) {
        return NextResponse.json({ data: [] });
      }
      query = query.eq('employee_id', actor.employeeId);
    }

    if (status) query = query.eq('status', status);
    if (Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(year) && year > 2000) {
      const monthStr = String(month).padStart(2, '0');
      const lastDay = new Date(year, month, 0).getDate();
      query = query
        .gte('date', `${year}-${monthStr}-01`)
        .lte('date', `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching overtime requests:', error);
      return NextResponse.json({ error: 'Gagal mengambil data lembur' }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error in overtime GET:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server' }, { status: 500 });
  }
}

// ============================================================
// POST /api/hris/overtime
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = createSchema.parse(body);

    const db = await createServerPgClient();

    // Resolusi target: default diri sendiri
    const targetEmployeeId =
      !validated.employee_id || validated.employee_id === 'me'
        ? actor.employeeId
        : validated.employee_id;

    if (!targetEmployeeId) {
      return NextResponse.json(
        { error: 'Akun ini tidak tertaut ke data karyawan' },
        { status: 400 }
      );
    }

    const isSelf = targetEmployeeId === actor.employeeId;
    if (!isSelf && !actor.isHr) {
      return NextResponse.json(
        { error: 'Hanya HRD yang bisa membuat penugasan lembur untuk karyawan lain' },
        { status: 403 }
      );
    }

    const { data: targetEmployee } = await db
      .from('employees')
      .select('id, full_name, is_active')
      .eq('id', targetEmployeeId)
      .maybeSingle();

    if (!targetEmployee || targetEmployee.is_active === false) {
      return NextResponse.json({ error: 'Karyawan tidak ditemukan/nonaktif' }, { status: 404 });
    }

    // Tolak duplikat: sudah ada pengajuan pending/approved di tanggal sama
    const { data: existing } = await db
      .from('overtime_requests')
      .select('id, status')
      .eq('employee_id', targetEmployeeId)
      .eq('date', validated.date)
      .in('status', ['pending', 'approved'])
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: 'Sudah ada pengajuan lembur pending/approved di tanggal tersebut' },
        { status: 400 }
      );
    }

    if (validated.start_time === validated.end_time) {
      return NextResponse.json(
        { error: 'Jam mulai dan selesai tidak boleh sama' },
        { status: 400 }
      );
    }

    const hours = overtimeHoursFromTimes(validated.start_time, validated.end_time);
    if (hours > 12) {
      return NextResponse.json(
        { error: 'Durasi lembur maksimal 12 jam' },
        { status: 400 }
      );
    }

    // source 'company' = penugasan dari perusahaan (dibuat HRD utk orang lain),
    // menunggu KONFIRMASI karyawan ybs; 'employee' menunggu approval HRD/atasan.
    const source = isSelf ? 'employee' : 'company';

    const { data, error } = await db
      .from('overtime_requests')
      .insert({
        employee_id: targetEmployeeId,
        date: validated.date,
        start_time: validated.start_time,
        end_time: validated.end_time,
        hours,
        source,
        status: 'pending',
        reason: validated.reason,
        requested_by: actor.employeeId,
      })
      .select(OVERTIME_SELECT)
      .single();

    if (error) {
      // Unique index (employee_id, date) utk status aktif — balapan duplikat
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Sudah ada pengajuan lembur pending/approved di tanggal tersebut' },
          { status: 400 }
        );
      }
      console.error('Error creating overtime request:', error);
      return NextResponse.json(
        { error: 'Gagal membuat pengajuan lembur', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data,
      message:
        source === 'company'
          ? 'Penugasan lembur dibuat — menunggu konfirmasi karyawan'
          : 'Pengajuan lembur terkirim — menunggu persetujuan',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Error in overtime POST:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server' }, { status: 500 });
  }
}
