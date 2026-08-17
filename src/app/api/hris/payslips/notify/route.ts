// ============================================================
// API Route: Notifikasi Slip Gaji (EPIC-008 Fase E)
// POST — tandai slip terkirim + kembalikan link WhatsApp "slip terbit"
//        (pola wa.me, dibuka oleh UI HR — konsisten dgn notifikasi cuti)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, validateBody, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { PAYROLL_MANAGE_ROLES } from '@/lib/payroll/roles';
import { buildWaLink } from '@/lib/recruitment/wa';

const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const notifySchema = z.object({
  payroll_detail_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisCompensation);
    const db = await createServerPgClient();
    const body = await validateBody(request, notifySchema);

    const { data: detail } = await db
      .from('payroll_details')
      .select(`
        id, payslip_sent,
        employee:employees ( id, full_name, phone ),
        payroll_run:payroll_runs ( id, period_month, period_year, status )
      `)
      .eq('id', body.payroll_detail_id)
      .maybeSingle();

    if (!detail) {
      return NextResponse.json({ error: 'Slip tidak ditemukan' }, { status: 404 });
    }

    if (detail.payroll_run?.status !== 'paid') {
      return NextResponse.json(
        { error: 'Notifikasi hanya untuk run yang sudah dibayar' },
        { status: 400 }
      );
    }

    const periodLabel = `${MONTHS[(detail.payroll_run.period_month ?? 1) - 1]} ${detail.payroll_run.period_year}`;
    const message =
      `Halo ${detail.employee?.full_name}, slip gaji Anda periode ${periodLabel} sudah terbit. ` +
      `Silakan lihat detailnya di portal karyawan: menu Area Karyawan → Slip Gaji.`;
    const waLink = buildWaLink(detail.employee?.phone, message);

    await db
      .from('payroll_details')
      .update({
        payslip_sent: true,
        payslip_sent_at: new Date().toISOString(),
      })
      .eq('id', body.payroll_detail_id);

    return NextResponse.json({
      data: { wa_link: waLink, payslip_sent: true },
      message: waLink
        ? 'Slip ditandai terkirim — buka WhatsApp untuk mengirim notifikasi'
        : 'Slip ditandai terkirim (karyawan tidak punya nomor telepon utk WA)',
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in payslip notify:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server' }, { status: 500 });
  }
}
