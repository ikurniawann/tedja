import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/api/auth";
import { importBusinessIds, type UserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import type { UserRole } from "@/types";

// Modul Sales Funneling (EPIC-022) — keputusan owner 2026-07-21:
// hanya super_admin + tim sales; role sales route-aware, bukan full access.
export const SALES_FUNNEL_ROLES: UserRole[] = ["super_admin", "sales"];

export type SalesFunnelUser = { id: string; role: UserRole };

/**
 * Guard role modul Sales Funneling. Mengembalikan NextResponse (401/403)
 * bila tidak berwenang, atau user yang lolos — pola sama dengan
 * requireCrmRoles di src/lib/crm/server.ts.
 */
export async function requireSalesFunnelRole(): Promise<
  { error: NextResponse; user: null } | { error: null; user: SalesFunnelUser }
> {
  const user = await getApiUser();
  if (!user) {
    return {
      error: NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      ),
      user: null,
    };
  }
  if (!SALES_FUNNEL_ROLES.includes(user.role)) {
    return {
      error: NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      ),
      user: null,
    };
  }
  return { error: null, user: { id: user.id, role: user.role } };
}

export const LEAD_ORG_TYPES = [
  "corporate",
  "sekolah",
  "komunitas",
  "travel-agent",
  "pemerintah",
  "perorangan",
  "lainnya",
] as const;

export const LEAD_SOURCES = [
  "wa",
  "instagram",
  "referral",
  "google",
  "pameran",
  "canvassing",
  "lainnya",
] as const;

export const LEAD_TEMPERATURES = ["panas", "hangat", "dingin"] as const;

export const DEAL_EVENT_TYPES = [
  "gathering",
  "field-trip",
  "ulang-tahun",
  "buyout-venue",
  "lainnya",
] as const;

export const LEAD_STATUSES = [
  "baru",
  "dihubungi",
  "qualified",
  "tidak-cocok",
] as const;

/**
 * Validasi penanggung jawab (owner_user_id) — temuan security gate Fase B:
 * harus user ber-role sales/super_admin dan satu company dengan lead/deal-nya
 * (super_admin/holding tanpa company tetap boleh). Mengembalikan pesan error
 * atau null bila valid.
 */
export async function validateAssignableOwner(
  ownerUserId: string,
  companyId: string | null
): Promise<string | null> {
  const owner = await queryOne<{
    role: UserRole;
    company_id: string | null;
  }>(
    `SELECT role, company_id FROM configuration.users WHERE id = $1`,
    [ownerUserId]
  );
  if (!owner) return "Penanggung jawab tidak ditemukan";
  if (!SALES_FUNNEL_ROLES.includes(owner.role)) {
    return "Penanggung jawab harus user ber-role sales atau super admin";
  }
  if (companyId && owner.company_id && owner.company_id !== companyId) {
    return "Penanggung jawab berada di luar venue lead/deal ini";
  }
  return null;
}

/** Valid bila string YYYY-MM-DD adalah tanggal kalender sungguhan. */
export function isValidCalendarDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** Normalisasi nomor WA ke digit kanonik 62… (0812/812/+62 → 62812…). */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

const MIN_PHONE_DIGITS = 10;

/** Valid bila hasil normalisasi masih layak jadi nomor WA Indonesia. */
export function isValidNormalizedPhone(phone: string): boolean {
  return phone.length >= MIN_PHONE_DIGITS && phone.startsWith("62");
}

/**
 * Tenant isolation WAJIB fail-closed (acceptance criteria EPIC-022): selain
 * super_admin, user tanpa company_id di scope bisnisnya DITOLAK — jangan
 * pernah melewatkan filter company diam-diam.
 */
export function requireCompanyScope(
  user: SalesFunnelUser,
  scope: UserScope | null
): NextResponse | null {
  if (user.role === "super_admin") return null;
  if (scope?.companyId) return null;
  return NextResponse.json(
    {
      success: false,
      error: "Scope bisnis user belum dikonfigurasi — hubungi admin",
    },
    { status: 403 }
  );
}

/**
 * Venue untuk stempel lead/deal baru: scope bisnis user dulu, lalu fallback
 * venue default dari crm.crm_settings (default_company_id/default_branch_id,
 * pola sama dengan getCrmDefaultVenue di CRM loyalty — operasi masih
 * single-venue).
 */
export async function resolveSalesVenue(scope: UserScope | null): Promise<{
  companyId: string | null;
  branchId: string | null;
}> {
  const ids = importBusinessIds(scope);
  let companyId = ids.companyId;
  let branchId = ids.branchId;
  if (companyId && branchId) return { companyId, branchId };

  try {
    const rows = await query<{ key: string; value: unknown }>(
      `SELECT key, value FROM crm.crm_settings
       WHERE key IN ('default_company_id', 'default_branch_id')`
    );
    for (const row of rows) {
      const value = typeof row.value === "string" ? row.value : null;
      if (!value) continue;
      if (row.key === "default_company_id" && !companyId) companyId = value;
      if (row.key === "default_branch_id" && !branchId) branchId = value;
    }
  } catch {
    // crm_settings belum ada → biarkan null, route yang menolak dengan 400
  }
  return { companyId, branchId };
}
