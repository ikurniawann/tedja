import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUser } from "@/lib/api/auth";
import type { UserRole } from "@/types";

// Endpoint konfigurasi CRM (tier, reward, xp-rule, avatar, settings) hanya
// boleh diubah Super Admin — keputusan owner EPIC-011.
export const CRM_CONFIG_ROLES: UserRole[] = ["super_admin"];

/**
 * Guard role untuk endpoint konfigurasi CRM. Mengembalikan NextResponse
 * (401/403) jika tidak berwenang, atau null jika lolos.
 */
export async function requireCrmConfigRole(): Promise<NextResponse | null> {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }
  if (!CRM_CONFIG_ROLES.includes(user.role)) {
    return NextResponse.json(
      { success: false, error: "Insufficient permissions" },
      { status: 403 }
    );
  }
  return null;
}

// Klaim/approve redeem reward adalah operasi harian di venue, bukan konfigurasi —
// kasir & supervisor boleh, selain itu ditolak (EPIC-011 Fase F).
export const CRM_OPERATOR_ROLES: UserRole[] = [
  "super_admin",
  "admin",
  "pos",
  "pos_supervisor",
];

// Data redemption memuat PII member (nama, telepon, XP). Hanya peran dengan
// kebutuhan bisnis yang boleh membacanya — direksi ikut karena laporan CRM.
export const CRM_READ_ROLES: UserRole[] = [...CRM_OPERATOR_ROLES, "direksi"];

// Inbox WhatsApp CS (EPIC-012 Fase C) — isi chat customer adalah PII paling
// sensitif di CRM; kasir biasa (pos) sengaja TIDAK termasuk, hanya supervisor.
export const CRM_INBOX_ROLES: UserRole[] = ["super_admin", "admin", "pos_supervisor"];

async function requireCrmRoles(allowed: UserRole[]): Promise<
  { error: NextResponse; user: null } | { error: null; user: { id: string; role: UserRole } }
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
  if (!allowed.includes(user.role)) {
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

/**
 * Guard role untuk operasi redeem reward (klaim/approve). Mengembalikan
 * NextResponse (401/403) bila tidak berwenang, atau user yang lolos.
 */
export function requireCrmOperator() {
  return requireCrmRoles(CRM_OPERATOR_ROLES);
}

/** Guard role untuk membaca data redemption yang memuat PII member. */
export function requireCrmReader() {
  return requireCrmRoles(CRM_READ_ROLES);
}

/** Guard role untuk inbox chat WhatsApp CS. */
export function requireCrmInboxAgent() {
  return requireCrmRoles(CRM_INBOX_ROLES);
}

export const CRM_DEFAULT_TIERS = [
  {
    code: "regular",
    name: "Regular",
    rank: 0,
    min_lifetime_xp: 0,
    min_total_spend: 0,
    xp_multiplier: 1,
    discount_percent: 0,
    display_color: "#6B7280",
  },
  {
    code: "bronze",
    name: "Bronze",
    rank: 1,
    min_lifetime_xp: 0,
    min_total_spend: 0,
    xp_multiplier: 1,
    discount_percent: 0,
    display_color: "#B7791F",
  },
  {
    code: "silver",
    name: "Silver",
    rank: 2,
    min_lifetime_xp: 10000,
    min_total_spend: 2000000,
    xp_multiplier: 1.2,
    discount_percent: 5,
    display_color: "#94A3B8",
  },
  {
    code: "gold",
    name: "Gold",
    rank: 3,
    min_lifetime_xp: 30000,
    min_total_spend: 7000000,
    xp_multiplier: 1.5,
    discount_percent: 10,
    display_color: "#F59E0B",
  },
];

export function isMissingCrmSchema(error: unknown) {
  if (!error) return false;
  const candidate = error as { code?: string; message?: string };
  const message = candidate.message ?? "";

  return (
    candidate.code === "42P01"
    || candidate.code === "42703"
    || message.includes("Could not find the table")
    || message.includes("Could not find a relationship")
    || message.includes("schema cache")
  );
}

export function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function validationErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { success: false, error: "Validation failed", details: error.issues },
      { status: 400 }
    );
  }

  return null;
}

interface CrmSettingsClient {
  from: (table: string) => {
    select: (cols: string) => {
      in: (col: string, values: string[]) => PromiseLike<{
        data: Array<{ key: string; value: unknown }> | null;
        error: unknown;
      }>;
    };
  };
}

/**
 * Venue default (single-venue) dari crm_settings untuk stempel transaksi
 * wallet/XP — dasar rekonsiliasi antar-venue (EPIC-011). Gagal baca → null.
 */
export async function getCrmDefaultVenue(db: CrmSettingsClient): Promise<{
  companyId: string | null;
  branchId: string | null;
}> {
  try {
    const { data, error } = await db
      .from("crm_settings")
      .select("key, value")
      .in("key", ["default_company_id", "default_branch_id"]);
    if (error || !data) return { companyId: null, branchId: null };

    const map = Object.fromEntries(
      data.map((row) => [row.key, typeof row.value === "string" ? row.value : null])
    );
    return {
      companyId: map.default_company_id ?? null,
      branchId: map.default_branch_id ?? null,
    };
  } catch {
    return { companyId: null, branchId: null };
  }
}

/**
 * Persen bonus topup dari crm_settings (`topup_bonus_percent`) — EPIC-011
 * Fase C. Gagal baca/absen → 0 (tanpa bonus), tidak pernah melempar.
 */
export async function getCrmTopupBonusPercent(
  db: CrmSettingsClient
): Promise<number> {
  try {
    const { data, error } = await db
      .from("crm_settings")
      .select("value")
      .eq("key", "topup_bonus_percent")
      .maybeSingle();
    if (error || !data) return 0;
    const value = toNumber(data.value);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : 0;
  } catch {
    return 0;
  }
}

export function apiErrorResponse(error: unknown, fallback = "Internal server error") {
  // Detail error (pesan Postgres dsb.) hanya di log server — jangan bocorkan
  // struktur internal ke client (temuan audit EPIC-011 Fase A).
  console.error("CRM API error:", error);
  return NextResponse.json({ success: false, error: fallback }, { status: 500 });
}
