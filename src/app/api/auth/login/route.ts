import { NextResponse } from "next/server";
import { authenticateCredentials, createSession, setSessionCookie } from "@/lib/auth/session";
import { checkRateLimit, clientIpFrom } from "@/lib/public/rate-limit";

export const dynamic = "force-dynamic";

// Rate limit login (audit 2026-09-17): sebelumnya tanpa proteksi brute force.
// Batas PER-AKUN ketat (menahan penebakan password satu akun), plus batas
// PER-IP yang LONGGAR — banyak kasir bisa berada di balik satu IP kantor
// (NAT), jadi IP tidak boleh jadi satu-satunya kunci yang ketat.
const PER_ACCOUNT: { limit: number; windowMs: number } = { limit: 8, windowMs: 5 * 60_000 };
const PER_IP: { limit: number; windowMs: number } = { limit: 60, windowMs: 5 * 60_000 };

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const ip = clientIpFrom(request.headers);
    const account = String(email).trim().toLowerCase();
    // Pesan sama untuk semua kasus limit — jangan bocorkan akun mana yang ada.
    if (
      !checkRateLimit(`login:acc:${account}`, PER_ACCOUNT) ||
      !checkRateLimit(`login:ip:${ip}`, PER_IP)
    ) {
      return NextResponse.json(
        { error: "Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi." },
        { status: 429 }
      );
    }

    const { user, error } = await authenticateCredentials(email, password);
    if (error || !user) {
      return NextResponse.json({ error: error?.message ?? "Invalid login credentials" }, { status: 401 });
    }

    const { token, expiresAt } = await createSession(user.id, {
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    const response = NextResponse.json({
      data: {
        user: { id: user.id, email: user.email },
        session: { access_token: token, expires_at: expiresAt.toISOString() },
      },
    });
    setSessionCookie(response, token, expiresAt, request);
    return response;
  } catch (err: unknown) {
    console.error("[auth/login] POST failed:", err);
    const message = err instanceof Error ? err.message : "Login failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
