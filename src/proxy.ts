import { NextResponse, type NextRequest } from "next/server";

/**
 * Serves the member portal at its own hostname.
 *
 *   member.suluinwounderland.com/            -> /member
 *   member.suluinwounderland.com/classic     -> /member/classic
 *
 * The pages keep living under src/app/member; only the public URL changes.
 * dashboard.suluinwounderland.com is untouched and still serves /member too,
 * so nothing breaks while the new hostname is being rolled out.
 *
 * Next.js 16 renamed this file convention from `middleware.ts` to `proxy.ts`
 * and the export from `middleware` to `proxy`. The old names are silently
 * ignored on 16 -- the file exists, nothing runs.
 *
 * Requires the tunnel to pass the original Host through: if the Public
 * Hostname entry sets an "HTTP Host Header" override, every request arrives
 * as the dashboard host and this never fires.
 */

const MEMBER_HOST_PREFIX = "member.";

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!host.startsWith(MEMBER_HOST_PREFIX)) return NextResponse.next();

  const { pathname } = request.nextUrl;

  // /api/* must pass through untouched: the portal calls /api/member-portal/*
  // with absolute paths in ~30 places, and prefixing those would 404 the whole
  // portal while the pages themselves still rendered.
  // /member/* is already correct -- links in the app emit absolute /member/...
  // paths, so they must not get prefixed twice.
  if (pathname.startsWith("/api") || pathname.startsWith("/member")) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = pathname === "/" ? "/member" : `/member${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Static assets are served from the same origin under the member host too,
  // so they must not be rewritten into /member/_next/...
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
