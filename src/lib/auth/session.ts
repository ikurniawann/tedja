import crypto from "crypto";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { SESSION_COOKIE, SESSION_TTL_DAYS } from "@/lib/auth/constants";
import { isSecureRequest } from "@/lib/auth/secure-cookie";

export interface SessionUser {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function sessionCookieOptions(expires: Date, secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

export async function createSession(
  userId: string,
  meta?: { userAgent?: string; ip?: string }
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO auth.sessions (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), meta?.userAgent ?? null, meta?.ip ?? null, expiresAt.toISOString()]
  );
  await query(`UPDATE auth.users SET last_sign_in_at = NOW() WHERE id = $1`, [userId]);
  return { token, expiresAt };
}

export async function destroySession(token: string | undefined | null) {
  if (!token) return;
  await query(`DELETE FROM auth.sessions WHERE token_hash = $1`, [hashToken(token)]);
}

export async function destroyAllUserSessions(userId: string) {
  await query(`DELETE FROM auth.sessions WHERE user_id = $1`, [userId]);
}

async function loadUserBySessionToken(token: string): Promise<SessionUser | null> {
  const row = await queryOne<{
    id: string;
    email: string;
    raw_user_meta_data: Record<string, unknown>;
    raw_app_meta_data: Record<string, unknown>;
  }>(
    `SELECT u.id, u.email, u.raw_user_meta_data, u.raw_app_meta_data
     FROM auth.sessions s
     JOIN auth.users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.expires_at > NOW()
       AND (u.banned_until IS NULL OR u.banned_until < NOW())`,
    [hashToken(token)]
  );
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    user_metadata: row.raw_user_meta_data ?? {},
    app_metadata: row.raw_app_meta_data ?? {},
  };
}

export async function getSessionUserFromRequest(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return loadUserBySessionToken(token);
}

export async function getSessionUserFromCookies() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return loadUserBySessionToken(token);
}

export function setSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date,
  request: Request
) {
  response.cookies.set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(expiresAt, isSecureRequest(request))
  );
}

export function clearSessionCookie(response: NextResponse, request: Request) {
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(new Date(0), isSecureRequest(request)),
    maxAge: 0,
  });
}

export async function authenticateCredentials(email: string, password: string) {
  const { verifyPassword } = await import("@/lib/auth/password");
  const row = await queryOne<{
    id: string;
    email: string;
    password_hash: string;
    banned_until: string | null;
  }>(
    `SELECT id, email, password_hash, banned_until
     FROM auth.users WHERE lower(email) = lower($1)`,
    [email.trim()]
  );
  if (!row) return { user: null, error: { message: "Invalid login credentials" } };
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return { user: null, error: { message: "Invalid login credentials" } };
  if (row.banned_until && new Date(row.banned_until) > new Date()) {
    return { user: null, error: { message: "This account is inactive. Contact your administrator." } };
  }
  return { user: { id: row.id, email: row.email }, error: null };
}
