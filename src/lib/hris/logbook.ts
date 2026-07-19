import { createServerPgClient } from "@/lib/pg/create-client";
import { ANNOUNCEMENT_SANITIZE_CONFIG } from "@/lib/hris/announcements";

/**
 * Kebijakan akses & status modul Logbook Department (EPIC-009).
 * Helper murni di file ini diuji unit; route hanya merangkainya.
 */

/** Boleh melihat & mengelola logbook SEMUA department. */
export const LOGBOOK_FULL_ACCESS_ROLES = [
  "super_admin",
  "admin",
  "hrd",
] as const;

/**
 * Boleh Review/Reject entry. Keputusan owner 2026-07-18: super_admin + hrd;
 * disiapkan mudah diperluas ke head department lain nanti — cukup tambah
 * role di sini (atau ganti ke pengecekan berbasis department bila sudah ada
 * role head dept formal).
 */
export const LOGBOOK_REVIEW_ROLES = ["super_admin", "hrd"] as const;

/** Allowlist sanitasi notes checklist — samakan dgn pengumuman agar konsisten. */
export const LOGBOOK_NOTE_SANITIZE_CONFIG = ANNOUNCEMENT_SANITIZE_CONFIG;

export type LogbookEntryStatus = "draft" | "submitted" | "reviewed" | "rejected";

export function hasFullLogbookAccess(role: string): boolean {
  return (LOGBOOK_FULL_ACCESS_ROLES as readonly string[]).includes(role);
}

export function canReviewLogbook(role: string): boolean {
  return (LOGBOOK_REVIEW_ROLES as readonly string[]).includes(role);
}

/** Submit hanya dari draft. */
export function canSubmitEntry(status: string): boolean {
  return status === "draft";
}

/** Review/Reject hanya dari submitted. */
export function canReviewEntry(status: string): boolean {
  return status === "submitted";
}

/** Entry hanya boleh dihapus selagi draft. */
export function canDeleteEntry(status: string): boolean {
  return status === "draft";
}

/** Item checklist hanya boleh diubah selagi entry-nya draft. */
export function canEditEntryItems(status: string): boolean {
  return status === "draft";
}

export interface LogbookActor {
  userId: string;
  role: string;
  /** id hris.employees yang tertaut; null utk akun non-karyawan */
  employeeId: string | null;
  /** department karyawan yang tertaut; null bila tidak ada */
  departmentId: string | null;
  isFullAccess: boolean;
  canReview: boolean;
}

export interface DepartmentScope {
  /** true bila permintaan diizinkan */
  allowed: boolean;
  /**
   * Filter department yang WAJIB dipakai query (null = tanpa filter,
   * hanya utk full-access).
   */
  departmentId: string | null;
}

/**
 * Resolusi scope department server-side:
 * - full-access: bebas (boleh minta department tertentu atau semua);
 * - selainnya: dikunci ke department sendiri — permintaan department lain
 *   ditolak, tanpa department karyawan → ditolak.
 */
export function resolveDepartmentScope(
  actor: Pick<LogbookActor, "isFullAccess" | "departmentId">,
  requestedDepartmentId: string | null | undefined
): DepartmentScope {
  if (actor.isFullAccess) {
    return { allowed: true, departmentId: requestedDepartmentId || null };
  }
  if (!actor.departmentId) return { allowed: false, departmentId: null };
  if (requestedDepartmentId && requestedDepartmentId !== actor.departmentId) {
    return { allowed: false, departmentId: null };
  }
  return { allowed: true, departmentId: actor.departmentId };
}

/** Aktor logbook dari sesi login; null bila tidak terautentikasi. */
export async function getLogbookActor(): Promise<LogbookActor | null> {
  const db = await createServerPgClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;

  const [{ data: userData }, { data: employee }] = await Promise.all([
    db.from("users").select("role").eq("id", user.id).single(),
    db
      .from("employees")
      .select("id, department_id")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const role: string = userData?.role ?? "";
  return {
    userId: user.id,
    role,
    employeeId: employee?.id ?? null,
    departmentId: employee?.department_id ?? null,
    isFullAccess: hasFullLogbookAccess(role),
    canReview: canReviewLogbook(role),
  };
}
