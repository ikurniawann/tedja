/**
 * Kebijakan akses area kerja.
 *
 * Role "full access" melihat desktop Arkiv OS + seluruh modul bisnis. Role
 * lain dikunci ke Area Karyawan (ESS/HRIS) di /dashboard/me: login langsung
 * ke sana, sidebar hanya menu karyawan, dan URL modul lain dilempar balik.
 *
 * Daftar full-access sengaja kecil & terpusat di sini agar mudah diperluas
 * ke depan tanpa menyentuh logika di banyak tempat.
 */

export const FULL_ACCESS_ROLES = ["super_admin", "hrd"] as const;

/** Role dengan akses penuh (desktop + semua modul). */
export function isFullAccessRole(role: string | null | undefined): boolean {
  return !!role && (FULL_ACCESS_ROLES as readonly string[]).includes(role);
}

/** Role yang dikunci hanya ke Area Karyawan (ESS). Kebalikan full-access. */
export function isEssOnlyRole(role: string | null | undefined): boolean {
  return !isFullAccessRole(role);
}

/** Beranda / akar Area Karyawan (ESS). */
export const ESS_HOME_PATH = "/dashboard/me";

/** True bila path berada di dalam Area Karyawan (ESS). */
export function isEssPath(pathname: string): boolean {
  return pathname === ESS_HOME_PATH || pathname.startsWith(`${ESS_HOME_PATH}/`);
}

/**
 * Modul tambahan untuk role non-full-access (EPIC-022): role di daftar ini
 * tetap ESS-only untuk modul lain, tapi boleh masuk prefix modulnya sendiri.
 * Sengaja BUKAN lewat FULL_ACCESS_ROLES agar tidak membuka seluruh dashboard.
 */
export const ROLE_MODULE_PATHS: Record<string, readonly string[]> = {
  sales: ["/dashboard/sales-funnel"],
  // EPIC-025: finance memproses invoice & pembayaran AR
  finance_staff: ["/dashboard/finance"],
};

/** Prefix modul tambahan yang boleh diakses sebuah role (di luar ESS). */
export function allowedModulePaths(
  role: string | null | undefined
): readonly string[] {
  return role ? ROLE_MODULE_PATHS[role] ?? [] : [];
}

/** True bila role boleh membuka pathname (full access, ESS, atau modulnya). */
export function canAccessPath(
  role: string | null | undefined,
  pathname: string
): boolean {
  if (isFullAccessRole(role)) return true;
  if (isEssPath(pathname)) return true;
  return allowedModulePaths(role).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
