/**
 * Wallpaper desktop Arkiv OS yang diunggah admin — disimpan sebagai JSON di
 * configuration.app_settings (key `desktop_wallpapers`), berkasnya di bucket
 * publik `desktop-wallpapers`. Helper murni tanpa DB/FS supaya mudah diuji.
 */

export const DESKTOP_WALLPAPERS_SETTING_KEY = "desktop_wallpapers";
export const DESKTOP_WALLPAPER_BUCKET = "desktop-wallpapers";
export const DESKTOP_WALLPAPER_MAX_BYTES = 8 * 1024 * 1024;
export const DESKTOP_WALLPAPER_MAX_ITEMS = 24;
export const DESKTOP_WALLPAPER_NAME_MAX = 60;

export interface DesktopWallpaper {
  id: string;
  name: string;
  /** URL publik gambar (/api/files/desktop-wallpapers/…). */
  src: string;
  created_at: string;
  created_by?: string | null;
}

export function parseDesktopWallpapers(raw: string | null | undefined): DesktopWallpaper[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is DesktopWallpaper =>
          !!item &&
          typeof item === "object" &&
          typeof (item as DesktopWallpaper).id === "string" &&
          typeof (item as DesktopWallpaper).src === "string" &&
          typeof (item as DesktopWallpaper).name === "string"
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        src: item.src,
        created_at: typeof item.created_at === "string" ? item.created_at : new Date(0).toISOString(),
        created_by: item.created_by ?? null,
      }));
  } catch {
    return [];
  }
}

export function serializeDesktopWallpapers(items: DesktopWallpaper[]): string {
  return JSON.stringify(items);
}

/** Nama tampilan: dari input admin, atau nama berkas tanpa ekstensi. */
export function normalizeWallpaperName(input: string | null | undefined, fileName: string): string {
  const fromInput = (input ?? "").trim();
  if (fromInput) return fromInput.slice(0, DESKTOP_WALLPAPER_NAME_MAX);
  const base = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  return (base || "Wallpaper").slice(0, DESKTOP_WALLPAPER_NAME_MAX);
}

export function addDesktopWallpaper(
  items: DesktopWallpaper[],
  next: DesktopWallpaper
): { ok: true; items: DesktopWallpaper[] } | { ok: false; error: string } {
  if (items.length >= DESKTOP_WALLPAPER_MAX_ITEMS) {
    return { ok: false, error: `Maksimal ${DESKTOP_WALLPAPER_MAX_ITEMS} wallpaper — hapus yang lama dulu` };
  }
  if (items.some((item) => item.id === next.id)) {
    return { ok: false, error: "ID wallpaper sudah dipakai" };
  }
  return { ok: true, items: [next, ...items] };
}

export function removeDesktopWallpaper(
  items: DesktopWallpaper[],
  id: string
): { items: DesktopWallpaper[]; removed: DesktopWallpaper | null } {
  const removed = items.find((item) => item.id === id) ?? null;
  return { items: items.filter((item) => item.id !== id), removed };
}
