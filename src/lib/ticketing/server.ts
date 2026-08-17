import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/api/auth";
import {
  getApiUserScope,
  importBusinessIds,
  type UserScope,
} from "@/lib/api/scope";
import { query } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { userHasIamPrefix } from "@/lib/iam/has-menu";
import type { UserRole } from "@/types";

/** @deprecated Gate memakai menu IAM. Konstanta tetap agar call site lama compile. */
export const TICKETING_ADMIN_ROLES: UserRole[] = ["super_admin"];
export const TICKETING_OPERATOR_ROLES: UserRole[] = [
  "super_admin",
  "pos_supervisor",
  "pos",
];

export type TicketingUser = { id: string; role: UserRole };

function ticketingMenusForAccess(access: readonly string[]): readonly string[] {
  if (access.some((item) => item.includes(".") || item === "ticketing")) {
    return access;
  }
  if (access.includes("pos")) return IAM.ticketingOperator;
  if (access.includes("pos_supervisor")) return IAM.ticketingReports;
  return IAM.ticketingAdmin;
}

/**
 * Guard modul Ticketing via grant IAM (bukan daftar role).
 * Argumen role lama di-map ke prefix menu agar 44 route tidak diubah satu-satu.
 */
export async function requireTicketingRole(
  access: readonly string[] = TICKETING_ADMIN_ROLES
): Promise<
  { error: NextResponse; user: null } | { error: null; user: TicketingUser }
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
  const prefixes = ticketingMenusForAccess(access);
  if (!(await userHasIamPrefix(user.id, user.role, prefixes))) {
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

export const requireTicketingAdmin = () =>
  requireTicketingRole(TICKETING_ADMIN_ROLES);

export const SEASON_KINDS = ["regular", "high"] as const;
export type SeasonKind = (typeof SEASON_KINDS)[number];

export const BAND_STATUSES = [
  "tersedia",
  "dipakai",
  "hilang",
  "rusak",
  // dipegang karyawan (staff pass Fase E) — bukan stok kunjungan
  "karyawan",
] as const;

export const RE_ENTRY_POLICIES = ["sekali-masuk", "bebas-keluar-masuk"] as const;

export const PAYMENT_MODES = ["postpaid", "prepaid"] as const;

/**
 * Venue untuk data ticketing: scope bisnis user dulu, lalu fallback venue
 * default dari crm.crm_settings (default_company_id/default_branch_id) —
 * pola resolveSalesVenue, operasi masih single-venue.
 */
export async function resolveTicketingVenue(scope: UserScope | null): Promise<{
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
    // crm_settings belum ada → biarkan null, route menolak dengan 400
  }
  return { companyId, branchId };
}

/** Response 400 standar bila venue belum bisa di-resolve. */
export function venueNotConfiguredResponse(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error:
        "Venue belum dikonfigurasi — set default_company_id/default_branch_id di CRM Settings atau lengkapi scope bisnis user",
    },
    { status: 400 }
  );
}

export type TicketingContext = {
  user: TicketingUser;
  companyId: string;
  branchId: string;
};

/**
 * Guard + resolusi venue sekali jalan untuk route ticketing:
 * role → scope bisnis → venue (fail-closed bila venue tak ter-resolve).
 * Default role admin (Fase A); route operasional Fase B mengoper
 * TICKETING_OPERATOR_ROLES.
 */
export async function requireTicketingContext(
  roles: UserRole[] = TICKETING_ADMIN_ROLES
): Promise<
  { error: NextResponse; ctx: null } | { error: null; ctx: TicketingContext }
> {
  const { error, user } = await requireTicketingRole(roles);
  if (error) return { error, ctx: null };

  const scope = await getApiUserScope();
  const { companyId, branchId } = await resolveTicketingVenue(scope);
  if (!companyId || !branchId) {
    return { error: venueNotConfiguredResponse(), ctx: null };
  }
  return { error: null, ctx: { user, companyId, branchId } };
}

/** Normalisasi UID NFC dari reader/wedge: hex uppercase tanpa separator. */
export function normalizeNfcUid(raw: string): string {
  return raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

const MIN_NFC_UID_LENGTH = 8;

/** Valid bila hasil normalisasi masih layak jadi UID kartu (≥ 4 byte hex). */
export function isValidNfcUid(uid: string): boolean {
  return uid.length >= MIN_NFC_UID_LENGTH && uid.length <= 64;
}
