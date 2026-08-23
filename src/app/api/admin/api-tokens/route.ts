import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getSessionUserFromCookies } from "@/lib/auth/session";
import { query, queryOne } from "@/lib/db";
import {
  API_SCOPE_MODULES,
  isApiTokenSession,
  mintApiToken,
} from "@/lib/auth/api-token";

/**
 * EPIC-042: kelola Open API token (list + create).
 *
 * HANYA sesi manusia (cookie) dengan menu settings.integrations — token TIDAK bisa
 * membuat/mencabut token (mencegah agent memperbanyak aksesnya sendiri).
 */

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Terjadi kesalahan";
}

async function requireHumanTokenAdmin() {
  const sessionUser = await getSessionUserFromCookies();
  if (isApiTokenSession(sessionUser)) {
    return NextResponse.json(
      { success: false, error: "Kelola token hanya lewat login dashboard, bukan token" },
      { status: 403 }
    );
  }
  await requireIamMenuPrefix(IAM.settingsIntegrations);
  return sessionUser;
}

function isValidScope(scope: string): boolean {
  if (scope === "*") return true;
  const [moduleKey, access] = scope.split(":");
  return (
    (API_SCOPE_MODULES as readonly string[]).includes(moduleKey ?? "") &&
    (access === "read" || access === "write")
  );
}

export async function GET() {
  try {
    const guard = await requireHumanTokenAdmin();
    if (guard instanceof NextResponse) return guard;

    const rows = await query(
      `SELECT t.id, t.name, t.token_prefix, t.scopes, t.user_id,
              u.full_name AS user_name, t.created_at, t.expires_at,
              t.revoked_at, t.last_used_at
       FROM configuration.api_tokens t
       LEFT JOIN configuration.users u ON u.id = t.user_id
       ORDER BY t.created_at DESC`
    );
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    if ((error as { code?: string })?.code === "42P01") {
      return NextResponse.json({ success: true, data: [], migration_pending: true });
    }
    const status = (error as { status?: number })?.status ?? 500;
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireHumanTokenAdmin();
    if (guard instanceof NextResponse) return guard;
    const admin = guard;

    const body = (await request.json()) as {
      name?: string;
      scopes?: string[];
      user_id?: string;
      expires_in_days?: number;
    };

    const name = String(body.name || "").trim();
    if (!name) {
      return NextResponse.json(
        { success: false, error: "Nama token wajib diisi" },
        { status: 400 }
      );
    }
    const scopes = Array.isArray(body.scopes) ? body.scopes.map(String) : [];
    if (scopes.length === 0 || !scopes.every(isValidScope)) {
      return NextResponse.json(
        {
          success: false,
          error: `Scope tidak valid. Pakai '*' atau '<modul>:read|write' (modul: ${API_SCOPE_MODULES.join(", ")})`,
        },
        { status: 400 }
      );
    }

    // Token berjalan sebagai akun ini — default: admin yang membuatnya.
    const userId = String(body.user_id || admin?.id || "");
    const userRow = await queryOne<{ id: string }>(
      `SELECT id FROM configuration.users WHERE id = $1`,
      [userId]
    );
    if (!userRow) {
      return NextResponse.json(
        { success: false, error: "user_id tidak dikenal" },
        { status: 400 }
      );
    }

    const expiresAt =
      Number(body.expires_in_days) > 0
        ? new Date(Date.now() + Number(body.expires_in_days) * 86_400_000).toISOString()
        : null;

    const minted = mintApiToken();
    const rows = await query(
      `INSERT INTO configuration.api_tokens
         (name, token_hash, token_prefix, user_id, scopes, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, token_prefix, scopes, user_id, created_at, expires_at`,
      [name, minted.hash, minted.prefix, userId, scopes, admin?.id ?? null, expiresAt]
    );

    // Nilai token hanya dikirim SEKALI di respons ini — DB cuma menyimpan hash.
    return NextResponse.json(
      { success: true, data: { ...rows[0], token: minted.token } },
      { status: 201 }
    );
  } catch (error) {
    if ((error as { code?: string })?.code === "42P01") {
      return NextResponse.json(
        {
          success: false,
          error: "Tabel api_tokens belum ada — jalankan migrations/013_api_tokens.sql dulu",
        },
        { status: 503 }
      );
    }
    const status = (error as { status?: number })?.status ?? 500;
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status }
    );
  }
}
