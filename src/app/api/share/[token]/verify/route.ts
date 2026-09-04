import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIp, resolveShareContext } from "@/lib/dataroom/api";
import {
  isEmailAllowed, logShareAccess, pendingSteps, sessionCookieName, upsertSession,
  verifyEmailCode, verifyPin,
} from "@/lib/dataroom/shares";

/**
 * POST /api/share/[token]/verify { email?, code?, pin? } — tukar kode email
 * dan/atau PIN menjadi sesi (cookie httpOnly). Kedua langkah bisa dikirim
 * sekaligus; yang sudah lolos di sesi tidak diminta lagi.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await resolveShareContext(request, token);
  if (!ctx.ok) return NextResponse.json({ success: false, error: ctx.error }, { status: ctx.status });
  const { share, session, steps } = ctx;
  const ip = clientIp(request) ?? "unknown";
  const ua = request.headers.get("user-agent");
  if (!checkRateLimit(`dataroom-verify:${token}:${ip}`, 10).allowed) {
    return NextResponse.json({ success: false, error: "Terlalu banyak percobaan. Coba lagi sebentar." }, { status: 429 });
  }
  const body = await request.json().catch(() => ({}));
  const email = String(body?.email ?? session?.email ?? "").trim().toLowerCase();
  const code = String(body?.code ?? "").trim();
  const pin = String(body?.pin ?? "").trim();

  let emailOk = false;
  if (steps.needEmail) {
    if (!email || !isEmailAllowed(share.allowed_emails, email)) {
      return NextResponse.json({ success: false, error: "Email tidak termasuk penerima link" }, { status: 403 });
    }
    if (!code) return NextResponse.json({ success: false, error: "Masukkan kode verifikasi" }, { status: 400 });
    const result = await verifyEmailCode(share.id, email, code);
    if (result !== "ok") {
      await logShareAccess({ shareId: share.id, action: "code_failed", email, ip, userAgent: ua });
      const msg = result === "expired" ? "Kode sudah kedaluwarsa, minta kode baru"
        : result === "too_many" ? "Terlalu banyak percobaan, minta kode baru"
        : result === "missing" ? "Minta kode verifikasi terlebih dahulu" : "Kode salah";
      return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }
    emailOk = true;
  }

  let pinOk = false;
  if (steps.needPin) {
    if (!pin) {
      // Email lolos tapi PIN belum diisi → simpan progres email, minta PIN.
      if (emailOk) {
        const s = await upsertSession({ existing: session, shareId: share.id, shareExpiresAt: share.expires_at, email, emailOk: true, ip, userAgent: ua });
        const res = NextResponse.json({ success: true, data: { steps: pendingSteps(share, s), verified: false } });
        setCookie(res, share.token, s.session_token, s.expires_at);
        return res;
      }
      return NextResponse.json({ success: false, error: "Masukkan PIN" }, { status: 400 });
    }
    if (!(await verifyPin(pin, share.pin_hash as string))) {
      await logShareAccess({ shareId: share.id, action: "pin_failed", email: email || null, ip, userAgent: ua });
      if (emailOk) {
        const s = await upsertSession({ existing: session, shareId: share.id, shareExpiresAt: share.expires_at, email, emailOk: true, ip, userAgent: ua });
        const res = NextResponse.json({ success: false, error: "PIN salah", data: { steps: pendingSteps(share, s) } }, { status: 400 });
        setCookie(res, share.token, s.session_token, s.expires_at);
        return res;
      }
      return NextResponse.json({ success: false, error: "PIN salah" }, { status: 400 });
    }
    pinOk = true;
  }

  const s = await upsertSession({
    existing: session, shareId: share.id, shareExpiresAt: share.expires_at,
    email: email || null, emailOk, pinOk, ip, userAgent: ua,
  });
  const nextSteps = pendingSteps(share, s);
  const verified = !nextSteps.needEmail && !nextSteps.needPin;
  if (verified && (emailOk || pinOk)) {
    await logShareAccess({ shareId: share.id, action: "verified", email: s.email, ip, userAgent: ua });
  }
  const res = NextResponse.json({ success: true, data: { steps: nextSteps, verified } });
  setCookie(res, share.token, s.session_token, s.expires_at);
  return res;
}

function setCookie(res: NextResponse, shareToken: string, sessionToken: string, expiresAt: string) {
  res.cookies.set(sessionCookieName(shareToken), sessionToken, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", expires: new Date(expiresAt),
  });
}
