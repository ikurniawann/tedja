/**
 * EPIC-050 Fase 5 — sisi server segmen: gate akses, eksekusi pratinjau,
 * dan pemuatan segmen tersimpan untuk dipakai kampanye.
 */
import { NextResponse } from "next/server";
import { getApiUser, type ApiUser } from "@/lib/api/auth";
import { getApiUserScope, type UserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { userHasIamPrefix } from "@/lib/iam/has-menu";
import {
  buildSegmentQuery,
  segmentDefinitionSchema,
  type SegmentDefinition,
  type SegmentSource,
} from "./segments";

/** Segmen berada di bawah menu Marketing; gate mengikuti prefix kampanye/promo. */
export async function requireSegmentUser(): Promise<
  { error: NextResponse; user: null; scope: null } | { error: null; user: ApiUser; scope: UserScope | null }
> {
  const user = await getApiUser();
  if (!user) {
    return { error: NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 }), user: null, scope: null };
  }
  const allowed =
    (await userHasIamPrefix(user.id, user.role, IAM.crmPromo)) ||
    (await userHasIamPrefix(user.id, user.role, IAM.crm));
  if (!allowed) {
    return { error: NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 }), user: null, scope: null };
  }
  return { error: null, user, scope: await getApiUserScope() };
}

export function segmentCompanyId(user: ApiUser, scope: UserScope | null): string | null {
  if (user.role === "super_admin" && !scope?.companyId) return null;
  return scope?.companyId ?? null;
}

export interface SegmentRow {
  id: string;
  company_id: string | null;
  name: string;
  description: string | null;
  source: SegmentSource;
  definition: unknown;
  is_active: boolean;
  last_count: number | null;
  last_counted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function loadAccessibleSegment(
  id: string,
  scope: UserScope | null
): Promise<SegmentRow | null> {
  const params: unknown[] = [id];
  let where = "s.id = $1 AND s.deleted_at IS NULL";
  if (scope?.companyId) {
    params.push(scope.companyId);
    where += ` AND (s.company_id IS NULL OR s.company_id = $${params.length})`;
  }
  return queryOne<SegmentRow>(
    `SELECT s.id, s.company_id, s.name, s.description, s.source, s.definition, s.is_active,
            s.last_count, s.last_counted_at, s.created_by, s.created_at, s.updated_at
     FROM crm.crm_segments s WHERE ${where}`,
    params
  );
}

/** Definisi tersimpan → objek tervalidasi; baris rusak tidak menjatuhkan API. */
export function parseStoredSegment(source: SegmentSource, raw: unknown): SegmentDefinition {
  const parsed = segmentDefinitionSchema.safeParse({ ...(raw && typeof raw === "object" ? raw : {}), source });
  return parsed.success ? parsed.data : segmentDefinitionSchema.parse({ source });
}

export interface SegmentPreviewResult {
  total: number;
  sample: Array<{ id: string; name: string; phone: string | null; r_score?: number; f_score?: number; m_score?: number; total_spent?: string | number; visit_count?: number }>;
  with_rfm: boolean;
}

/** Jumlah anggota + contoh baris. Dipakai pratinjau builder dan kartu kampanye. */
export async function previewSegment(
  def: SegmentDefinition,
  scope: UserScope | null,
  sampleSize = 10
): Promise<SegmentPreviewResult> {
  const companyId = scope?.companyId ?? null;
  const counted = buildSegmentQuery(def, { companyId, countOnly: true });
  const countRow = await queryOne<{ total: number }>(counted.sql, counted.params);
  const listed = buildSegmentQuery({ ...def, limit: Math.min(def.limit, sampleSize) }, { companyId });
  const sample = await query<SegmentPreviewResult["sample"][number]>(listed.sql, listed.params);
  return { total: Number(countRow?.total ?? 0), sample, with_rfm: listed.withRfm };
}

/** Simpan hasil hitung terakhir supaya daftar segmen ringan. */
export async function rememberSegmentCount(id: string, total: number): Promise<void> {
  await query(
    `UPDATE crm.crm_segments SET last_count = $2, last_counted_at = now(), updated_at = now() WHERE id = $1`,
    [id, total]
  );
}
