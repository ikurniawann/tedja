import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";

const PUBLIC_AUTH_PREFIXES = [
  "/arkiv-os",
  "/qa",
  "/login",
  "/portal",
  "/career",
  "/table-order",
  "/photobooth",
  "/api/job-openings/public",
  "/api/portal",
  "/psikotes",
  "/api/psikotes/session",
  "/interview",
  "/api/interview/session",
  "/offer",
  "/api/offer/session",
  "/api/table-order",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/settings/appearance",
  "/api/files",
  "/member",
  "/api/member-portal",
  "/api/wa/inbound",
  "/api/crm/instagram/webhook",
  "/api/payments/xendit/webhook",
  "/booking",
  "/api/public/booking",
  "/pass",
  "/shop",
  "/api/public/shop",
];

export function isPublicAuthPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    PUBLIC_AUTH_PREFIXES.some((route) => pathname.startsWith(route))
  );
}

/**
 * Middleware Edge-compatible — cek keberadaan cookie session saja.
 * Validasi session penuh (DB) dilakukan di API route / server component.
 */
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  // EPIC-042: request API dgn Bearer token Open API (arkiv_...) divalidasi DI
  // SINI (proxy Next 16 = Node runtime, DB bisa diakses) — wajib, karena
  // sebagian route lama tidak punya cek sesi sendiri dan mengandalkan gerbang
  // middleware. Token tidak dikenal / scope tidak cocok → 401 sebelum route.
  const bearerMatch =
    pathname.startsWith("/api/") &&
    /^Bearer\s+(arkiv_\S+)$/i.exec(request.headers.get("authorization") ?? "");
  let hasApiBearer = false;
  if (bearerMatch && !hasSession) {
    const { verifyApiTokenRequest } = await import("@/lib/auth/api-token");
    hasApiBearer = await verifyApiTokenRequest(bearerMatch[1], {
      pathname,
      method: request.method,
    });
    if (!hasApiBearer) {
      return NextResponse.json(
        { success: false, error: "Token tidak valid atau scope tidak mengizinkan" },
        { status: 401 }
      );
    }
  }
  const isPublicRoute = isPublicAuthPath(pathname);

  if (!hasSession && !hasApiBearer && !isPublicRoute) {
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
  // x-request-method dipakai pengecekan scope token Open API (EPIC-042).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  requestHeaders.set("x-request-method", request.method);
  return NextResponse.next({ request: { headers: requestHeaders } });
}
