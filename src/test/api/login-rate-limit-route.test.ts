/**
 * Route-level: brute force login benar-benar diblokir oleh handler
 * /api/auth/login (audit 2026-09-17). Sebelumnya route ini tanpa proteksi.
 * Autentikasi di-mock gagal supaya yang diuji murni pembatas lajunya.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/public/rate-limit";

const authenticateCredentials = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  authenticateCredentials: (...args: unknown[]) => authenticateCredentials(...args),
  createSession: vi.fn(async () => ({ token: "t", expiresAt: new Date(Date.now() + 3600_000) })),
  setSessionCookie: vi.fn(),
}));

const loginRequest = (email: string, ip = "203.0.113.5") =>
  new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ email, password: "salah" }),
  });

beforeEach(() => {
  resetRateLimits();
  authenticateCredentials.mockReset();
  authenticateCredentials.mockResolvedValue({ user: null, error: { message: "Invalid login credentials" } });
});

describe("POST /api/auth/login — rate limit", () => {
  it("8 percobaan gagal masih 401, percobaan ke-9 diblokir 429", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    for (let i = 0; i < 8; i++) {
      const res = await POST(loginRequest("korban@tedjacoffee.id"));
      expect(res.status, `percobaan ke-${i + 1}`).toBe(401);
    }
    const blocked = await POST(loginRequest("korban@tedjacoffee.id"));
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error).toMatch(/terlalu banyak/i);
  });

  it("saat diblokir, autentikasi TIDAK dipanggil lagi (hemat & tak bocorkan timing)", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    for (let i = 0; i < 8; i++) await POST(loginRequest("a@tedjacoffee.id"));
    const callsBefore = authenticateCredentials.mock.calls.length;
    await POST(loginRequest("a@tedjacoffee.id"));
    expect(authenticateCredentials.mock.calls.length).toBe(callsBefore);
  });

  it("akun lain tidak ikut terkunci (batas per-akun, bukan global)", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    for (let i = 0; i < 9; i++) await POST(loginRequest("a@tedjacoffee.id"));
    const other = await POST(loginRequest("b@tedjacoffee.id"));
    expect(other.status).toBe(401); // bukan 429
  });

  it("pesan blokir generik — tidak membocorkan apakah akun ada", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    for (let i = 0; i < 8; i++) await POST(loginRequest("tidakada@tedjacoffee.id"));
    const res = await POST(loginRequest("tidakada@tedjacoffee.id"));
    const body = await res.json();
    expect(body.error).not.toMatch(/tidak ditemukan|not found|unknown user/i);
  });
});
