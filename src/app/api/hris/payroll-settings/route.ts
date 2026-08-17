// ============================================================
// API Route: Payroll Settings
// GET: Pengaturan payroll + tax config tahun berjalan (sumber kebenaran tarif)
// PUT: Update pengaturan (upsert baris tunggal payroll_settings dan/atau
//      payroll_tax_config per tahun)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, validateBody, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  PAYROLL_MANAGE_ROLES,
  PAYROLL_SETTINGS_WRITE_ROLES,
} from '@/lib/payroll/roles';

const percent = z.coerce.number().min(0).max(100);
const rupiah = z.coerce.number().min(0);

/**
 * Bracket PPh21 disimpan sebagai batas KUMULATIF — nilai yang dikirim
 * bersamaan harus naik ketat, kalau tidak lebar bracket jadi nol dan
 * pajak salah hitung diam-diam.
 */
function refineIncreasingLimits(
  keys: string[],
  data: Record<string, unknown>,
  ctx: z.RefinementCtx
) {
  let prevKey: string | null = null;
  for (const key of keys) {
    const value = data[key];
    if (value === undefined) continue;
    if (prevKey !== null) {
      const prev = data[prevKey];
      if (prev !== undefined && Number(value) <= Number(prev)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} harus lebih besar dari ${prevKey}`,
        });
      }
    }
    prevKey = key;
  }
}

const settingsSchema = z.object({
  company_name: z.string().min(1).optional(),
  npwp: z.string().nullable().optional(),
  bpjs_tk_jht_employee: percent.optional(),
  bpjs_tk_jht_employer: percent.optional(),
  bpjs_tk_jp_employee: percent.optional(),
  bpjs_tk_jp_employer: percent.optional(),
  bpjs_tk_jkk: percent.optional(),
  bpjs_tk_jkm: percent.optional(),
  bpjs_kes_employee: percent.optional(),
  bpjs_kes_employer: percent.optional(),
  bpjs_kes_max_upah: z.coerce.number().positive().optional(),
  tapera_employee: percent.optional(),
  tapera_employer: percent.optional(),
  ptkp_tk_0: rupiah.optional(),
  ptkp_tk_1: rupiah.optional(),
  ptkp_tk_2: rupiah.optional(),
  ptkp_tk_3: rupiah.optional(),
  ptkp_k_0: rupiah.optional(),
  ptkp_k_1: rupiah.optional(),
  ptkp_k_2: rupiah.optional(),
  ptkp_k_3: rupiah.optional(),
  pph21_bracket_1: rupiah.optional(),
  pph21_bracket_2: rupiah.optional(),
  pph21_bracket_3: rupiah.optional(),
  pph21_bracket_4: rupiah.optional(),
  thr_eligible_months: z.coerce.number().int().min(0).max(24).optional(),
  thr_prorate: z.boolean().optional(),
  payroll_day: z.coerce.number().int().min(1).max(31).optional(),
  overtime_multiplier: z.coerce.number().min(0).max(10).optional(),
  overtime_multiplier_holiday: z.coerce.number().min(0).max(10).optional(),
  overtime_hourly_divisor: z.coerce.number().positive().max(1000).optional(),
  late_deduction_mode: z.enum(["off", "per_minute", "flat"]).optional(),
  late_deduction_amount: rupiah.optional(),
  loan_max_installment_percent: percent.optional(),
  loan_max_active_per_employee: z.coerce.number().int().min(1).max(10).optional(),
}).superRefine((data, ctx) =>
  refineIncreasingLimits(
    ["pph21_bracket_1", "pph21_bracket_2", "pph21_bracket_3", "pph21_bracket_4"],
    data,
    ctx
  )
);

const taxConfigSchema = z.object({
  tax_year: z.coerce.number().int().min(2000).max(2100),
  ptkp_tk_0: rupiah.optional(),
  ptkp_tk_1: rupiah.optional(),
  ptkp_tk_2: rupiah.optional(),
  ptkp_tk_3: rupiah.optional(),
  ptkp_k_0: rupiah.optional(),
  ptkp_k_1: rupiah.optional(),
  ptkp_k_2: rupiah.optional(),
  ptkp_k_3: rupiah.optional(),
  bracket_1_limit: rupiah.optional(),
  bracket_1_rate: percent.optional(),
  bracket_2_limit: rupiah.optional(),
  bracket_2_rate: percent.optional(),
  bracket_3_limit: rupiah.optional(),
  bracket_3_rate: percent.optional(),
  bracket_4_limit: rupiah.optional(),
  bracket_4_rate: percent.optional(),
  bracket_5_rate: percent.optional(),
  jabatan_expense_percentage: percent.optional(),
  jabatan_expense_max: rupiah.optional(),
  is_active: z.boolean().optional(),
}).superRefine((data, ctx) =>
  refineIncreasingLimits(
    ["bracket_1_limit", "bracket_2_limit", "bracket_3_limit", "bracket_4_limit"],
    data,
    ctx
  )
);

const putSchema = z.object({
  settings: settingsSchema.optional(),
  tax_config: taxConfigSchema.optional(),
});

// ============================================================
// GET /api/hris/payroll-settings?tax_year=2026
// ============================================================

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisCompensation);
    const db = await createServerPgClient();
    const { searchParams } = new URL(request.url);
    const taxYear = Number(searchParams.get('tax_year')) || new Date().getFullYear();

    const [{ data: settings }, { data: taxConfig }] = await Promise.all([
      db
        .from('payroll_settings')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      db
        .from('payroll_tax_config')
        .select('*')
        .eq('tax_year', taxYear)
        .maybeSingle(),
    ]);

    return NextResponse.json({
      data: {
        settings: settings ?? null,
        tax_config: taxConfig ?? null,
        tax_year: taxYear,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error fetching payroll settings:', error);
    return NextResponse.json(
      { error: 'Gagal mengambil pengaturan payroll' },
      { status: 500 }
    );
  }
}

// ============================================================
// PUT /api/hris/payroll-settings
// ============================================================

export async function PUT(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisCompensation);
    const db = await createServerPgClient();
    const body = await validateBody(request, putSchema);

    if (!body.settings && !body.tax_config) {
      return NextResponse.json(
        { error: 'Tidak ada perubahan yang dikirim' },
        { status: 400 }
      );
    }

    let savedSettings = null;
    let savedTaxConfig = null;

    if (body.settings) {
      const { data: existing } = await db
        .from('payroll_settings')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      const payload = {
        ...body.settings,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        const { data, error } = await db
          .from('payroll_settings')
          .update(payload)
          .eq('id', existing.id)
          .select('*')
          .single();
        if (error) throw ApiError.server(`Gagal menyimpan pengaturan: ${error.message}`);
        savedSettings = data;
      } else {
        const { data, error } = await db
          .from('payroll_settings')
          .insert({
            company_name: body.settings.company_name ?? 'Perusahaan',
            ...payload,
          })
          .select('*')
          .single();
        if (error) throw ApiError.server(`Gagal menyimpan pengaturan: ${error.message}`);
        savedSettings = data;
      }
    }

    if (body.tax_config) {
      const { tax_year, ...taxFields } = body.tax_config;
      const { data: existing } = await db
        .from('payroll_tax_config')
        .select('id')
        .eq('tax_year', tax_year)
        .maybeSingle();

      const payload = {
        ...taxFields,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        const { data, error } = await db
          .from('payroll_tax_config')
          .update(payload)
          .eq('id', existing.id)
          .select('*')
          .single();
        if (error) throw ApiError.server(`Gagal menyimpan tax config: ${error.message}`);
        savedTaxConfig = data;
      } else {
        const { data, error } = await db
          .from('payroll_tax_config')
          .insert({ tax_year, ...payload })
          .select('*')
          .single();
        if (error) throw ApiError.server(`Gagal menyimpan tax config: ${error.message}`);
        savedTaxConfig = data;
      }
    }

    return NextResponse.json({
      data: { settings: savedSettings, tax_config: savedTaxConfig },
      message: 'Pengaturan payroll tersimpan',
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error saving payroll settings:', error);
    return NextResponse.json(
      { error: 'Gagal menyimpan pengaturan payroll' },
      { status: 500 }
    );
  }
}
