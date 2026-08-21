import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { getPool } from "@/lib/db";
import { hashSecret } from "./otp";
import { isSecureRequest } from "@/lib/auth/secure-cookie";

/**
 * Sesi portal member — cookie `member_session` TERPISAH total dari
 * `arkiv_session` (portal publik utk member, bukan user internal).
 * Token acak 32 byte; DB hanya menyimpan hash-nya.
 */

export const MEMBER_SESSION_COOKIE = "member_session";
export const MEMBER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

export interface MemberSession {
  customerId: string;
  sessionId: string;
}

export async function createMemberSession(customerId: string): Promise<string> {
  const pool = getPool();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + MEMBER_SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO crm.member_portal_sessions (token_hash, customer_id, expires_at)
     VALUES ($1, $2, $3)`,
    [hashSecret(token), customerId, expiresAt]
  );
  return token;
}

export async function getMemberSession(): Promise<MemberSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) return null;

  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE crm.member_portal_sessions
     SET last_seen_at = now()
     WHERE token_hash = $1 AND expires_at > now()
     RETURNING id, customer_id`,
    [hashSecret(token)]
  );
  if (rows.length === 0) return null;
  return { customerId: rows[0].customer_id, sessionId: rows[0].id };
}

export async function destroyMemberSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) return;
  const pool = getPool();
  await pool.query(
    `DELETE FROM crm.member_portal_sessions WHERE token_hash = $1`,
    [hashSecret(token)]
  );
}

/** Opsi cookie sesi member (dipakai route saat set/clear). */
export function memberSessionCookieOptions(request: Request) {
  return {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "lax" as const,
    path: "/",
    maxAge: MEMBER_SESSION_TTL_MS / 1000,
  };
}
