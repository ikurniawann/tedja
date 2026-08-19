/**
 * Bypass OTP khusus pengembangan lokal (permintaan owner 2026-08-19).
 *
 * Login portal member butuh OTP WhatsApp. Di lokal gateway WA tidak aktif,
 * jadi developer harus mengorek kode dari log dev setiap kali login — lambat
 * dan bikin QA malas menguji portal.
 *
 * TIGA lapis pengaman, semuanya harus benar. Satu saja gagal → bypass mati
 * dan OTP asli tetap berlaku:
 *
 *   1. NODE_ENV !== "production" — build produksi selalu menyetelnya, jadi
 *      kode ini mati total di server produksi.
 *   2. MEMBER_OTP_DEV_CODE terisi — opt-in eksplisit; tidak ada default,
 *      jadi lingkungan yang tidak menyetelnya tidak terpengaruh sama sekali.
 *   3. DATABASE_URL menunjuk localhost/127.0.0.1 — pola yang sama dipakai
 *      seeder & runner migrasi repo ini untuk menolak target non-lokal.
 *      Mencegah .env dev "nyasar" menunjuk database staging/produksi.
 *
 * JANGAN pernah menyetel MEMBER_OTP_DEV_CODE di .env produksi/staging.
 */

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isLocalDatabase(url = process.env.DATABASE_URL): boolean {
  const host = hostOf(url);
  return host === "localhost" || host === "127.0.0.1";
}

/** Kode bypass aktif, atau null bila salah satu lapis pengaman tidak lolos. */
export function memberOtpDevCode(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  const code = String(process.env.MEMBER_OTP_DEV_CODE ?? "").trim();
  if (!code) return null;
  if (!isLocalDatabase()) return null;
  return code;
}

/** True bila `code` adalah kode bypass dev yang sah. */
export function isDevBypassCode(code: string): boolean {
  const devCode = memberOtpDevCode();
  return devCode !== null && code === devCode;
}
