/**
 * Kebijakan akses area kerja.
 *
 * Role "full access" melihat desktop Arkiv OS + seluruh modul bisnis. Role
 * lain dikunci ke Area Karyawan (ESS/HRIS) di /dashboard/me: login langsung
 * ke sana, sidebar hanya menu karyawan, dan URL modul lain dilempar balik.
 *
 * Daftar full-access sengaja kecil & terpusat di sini agar mudah diperluas
 * ke depan tanpa menyentuh logika di banyak tempat.
 *
 * CATATAN: penentuan utama kini berbasis IAM (`isEssOnlyUser` di
 * get-user-menus.ts) — user full-access bila role IAM-nya punya permission
 * menu non-ESS. Daftar di bawah dipakai sebagai jalur cepat & fallback bila
 * IAM tidak tersedia / belum ter-seed.
 */

export const FULL_ACCESS_ROLES = ["super_admin", "admin", "hrd"] as const;

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
