// ============================================================
// API Route: Keputusan Pengajuan Lembur (EPIC-008 Fase B)
// POST — approve / reject / cancel dengan aturan per sumber:
//   source 'employee' : HRD atau atasan langsung yang memutuskan
//                       (pengaju tidak bisa memutuskan pengajuannya sendiri)
//   source 'company'  : hanya karyawan ybs yang KONFIRMASI (approve/reject)
//   cancel            : pembuat pengajuan, selama masih pending
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerPgClient } from "@/lib/pg/create-client";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { canDecideOvertime } from "@/lib/hris/overtime-rules";

const decideSchema = z.object({
  overtime_id: z.string().uuid(),
  action: z.enum(['approve', 'reject', 'cancel']),
  rejection_reason: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = decideSchema.parse(body);

    const db = await createServerPgClient();
    const { data: overtime } = await db
      .from('overtime_requests')
      .select(`
        *,
        employee:employees!employee_id ( id, full_name, reporting_to )
      `)
      .eq('id', validated.overtime_id)
      .maybeSingle();

    if (!overtime) {
      return NextResponse.json({ error: 'Pengajuan lembur tidak ditemukan' }, { status: 404 });
    }

    if (overtime.status !== 'pending') {
      return NextResponse.json(
        { error: `Pengajuan sudah ${overtime.status}`, current_status: overtime.status },
        { status: 400 }
      );
    }

    // Aturan otorisasi murni & teruji: lib/hris/overtime-rules.ts
    const decision = canDecideOvertime(
      { employeeId: actor.employeeId, isHr: actor.isHr },
      {
        employee_id: overtime.employee_id,
        requested_by: overtime.requested_by,
        source: overtime.source,
        reporting_to: overtime.employee?.reporting_to ?? null,
      },
      validated.action
    );
    if (!decision.allowed) {
      return NextResponse.json({ error: decision.reason }, { status: 403 });
    }

    if (validated.action === 'reject' && !validated.rejection_reason?.trim()) {
      return NextResponse.json({ error: 'Alasan penolakan wajib diisi' }, { status: 400 });
    }

    const newStatus =
      validated.action === 'approve'
        ? 'approved'
        : validated.action === 'reject'
          ? 'rejected'
          : 'cancelled';

    const { data, error } = await db
      .from('overtime_requests')
      .update({
        status: newStatus,
        decided_by: actor.employeeId,
        decided_at: new Date().toISOString(),
        rejection_reason:
          validated.action === 'reject'
            ? (validated.rejection_reason ?? null)
            : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', validated.overtime_id)
      .eq('status', 'pending')
      .select(`
        *,
        employee:employees!employee_id ( id, full_name, nip ),
        decider:employees!decided_by ( id, full_name )
      `)
      .single();

    if (error) {
      // 0 baris ter-update = sudah diputuskan proses lain (guard status pending)
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Pengajuan sudah diproses oleh orang lain' },
          { status: 409 }
        );
      }
      console.error('Error deciding overtime request:', error);
      return NextResponse.json(
        { error: 'Gagal memproses pengajuan lembur', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data,
      message:
        newStatus === 'approved'
          ? 'Lembur disetujui'
          : newStatus === 'rejected'
            ? 'Lembur ditolak'
            : 'Pengajuan dibatalkan',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.issues },
        { status: 400 }
      );
    }
    console.error('Error in overtime decide:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server' }, { status: 500 });
  }
}
