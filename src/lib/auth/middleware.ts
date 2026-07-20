import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";

/**
 * Middleware Edge-compatible — cek keberadaan cookie session saja.
 * Validasi session penuh (DB) dilakukan di API route / server component.
 */
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  const publicRoutes = [
    "/arkiv-os",
    "/qa",
    "/login",
    "/portal",
    "/career",
    "/table-order",
    "/photobooth",
    "/api/job-openings/public",
    "/api/portal",
    // portal psikotes kandidat (anonim, identitas = token sesi);
    // /api/psikotes lainnya (instruments/questions/files) tetap ber-auth
    "/psikotes",
    "/api/psikotes/session",
    // portal interview AI kandidat (anonim, identitas = token sesi);
    // /api/interview lainnya (sessions/files) tetap ber-auth
    "/interview",
    "/api/interview/session",
    // portal offer kandidat (anonim, identitas = token offer)
    "/offer",
    "/api/offer/session",
    "/api/table-order",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/files",
    // Portal member publik (member.suluindwounderland.com) — identitas =
    // sesi OTP WA sendiri (cookie member_session), bukan arkiv_session.
    "/member",
    "/api/member-portal",
    // Penerima event dari wa-gateway (mesin yang sama) — auth = header
    // x-gateway-token, bukan sesi user.
    "/api/wa/inbound",
    // Webhook Instagram dari Meta — dipanggil server Meta tanpa sesi.
    // Auth = tanda tangan HMAC X-Hub-Signature-256 atas raw body, diperiksa
    // di dalam route itu sendiri.
    "/api/crm/instagram/webhook",
  ];
  const isPublicRoute =
    pathname === "/" ||
    publicRoutes.some((route) => pathname.startsWith(route));

  if (!hasSession && !isPublicRoute) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (hasSession && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Teruskan pathname ke server component (guard role ESS-only membacanya via
  // `headers()`) — middleware Edge tak punya role, jadi enforcement di layout.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}
