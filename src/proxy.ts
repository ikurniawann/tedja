import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/auth/middleware";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Portal member: subdomain member.* (member.suluindwounderland.com via
  // Cloudflare Tunnel) di-rewrite ke /member — API & asset tidak disentuh.
  const host = request.headers.get("host") ?? "";
  if (host.startsWith("member.")) {
    if (
      !pathname.startsWith("/member") &&
      !pathname.startsWith("/api") &&
      !pathname.startsWith("/_next")
    ) {
      const target = pathname === "/" ? "/member" : `/member${pathname}`;
      return NextResponse.rewrite(new URL(`${target}${search}`, request.url));
    }
  }

  // Legacy employees path (was under /dashboard/hris/employees).
  if (pathname.startsWith("/dashboard/hris/employees")) {
    const target = pathname.replace("/dashboard/hris/employees", "/dashboard/employees");
    return NextResponse.redirect(new URL(`${target}${search}`, request.url));
  }

  // Legacy create URL: .../new → .../insert
  const legacyNew = pathname.match(/^(\/dashboard\/(?:[^/]+\/)+)new$/);
  if (legacyNew) {
    return NextResponse.redirect(new URL(`${legacyNew[1]}insert${search}`, request.url));
  }

  // Legacy edit URL: .../{id}/edit → .../edit/{id}
  const legacyEdit = pathname.match(/^(\/dashboard\/(?:.+\/)+)([^/]+)\/edit$/);
  if (legacyEdit) {
    return NextResponse.redirect(
      new URL(`${legacyEdit[1]}edit/${legacyEdit[2]}${search}`, request.url)
    );
  }

  // Redirect old HRIS paths to new /dashboard/hris/* structure.
  // Must run before the session check so the redirect target is also authenticated.
  // "staff" sengaja tidak ada di daftar: /dashboard/hris/staff tidak pernah dibuat,
  // jadi redirect-nya hanya mengantar ke 404 (EPIC-015).
  const hrisModules = ["candidates", "pipeline", "talent-pool", "analytics"];
  for (const hrisModule of hrisModules) {
    // Match /dashboard/{module}/* but NOT /dashboard/hris/{module}/*
    if (
      pathname.startsWith(`/dashboard/${hrisModule}`) &&
      !pathname.startsWith("/dashboard/hris/")
    ) {
      const newPath = pathname.replace(
        `/dashboard/${hrisModule}`,
        `/dashboard/hris/${hrisModule}`
      );
      return NextResponse.redirect(new URL(newPath, request.url));
    }
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)",
  ],
};
