import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearSessionCookie, destroySession } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/constants";

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  await destroySession(token);
  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return response;
}

// Dipakai requireUser() saat cookie session ada tapi tidak valid lagi —
// tanpa ini browser terjebak redirect loop /login ↔ /dashboard.
export async function GET() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  await destroySession(token);
  // Location relatif — di belakang cloudflared, request.url berisi host
  // internal (localhost:3459), bukan domain publik.
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: "/login" },
  });
  clearSessionCookie(response);
  return response;
}
