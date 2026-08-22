import { NextResponse } from "next/server";
import { authenticateCredentials, createSession, setSessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
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
  } catch (err: any) {
    console.error("[auth/login] POST failed:", err);
    return NextResponse.json({ error: err.message || "Login failed" }, { status: 500 });
  }
}
