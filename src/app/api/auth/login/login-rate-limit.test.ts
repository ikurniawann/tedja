import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimits } from "@/lib/public/rate-limit";

// Cerminan aturan di src/app/api/auth/login/route.ts.
const PER_ACCOUNT = { limit: 8, windowMs: 5 * 60_000 };
const PER_IP = { limit: 60, windowMs: 5 * 60_000 };

describe("login rate limit", () => {
  beforeEach(() => resetRateLimits());

  it("akun yang sama diblokir (429) setelah 8 percobaan", () => {
    const key = "login:acc:admin@tedjacoffee.id";
    for (let i = 0; i < 8; i++) expect(checkRateLimit(key, PER_ACCOUNT)).toBe(true);
    expect(checkRateLimit(key, PER_ACCOUNT)).toBe(false); // ke-9 ditolak
  });

  it("akun berbeda punya jatah sendiri (satu akun jahat tak mengunci yang lain)", () => {
    for (let i = 0; i < 8; i++) checkRateLimit("login:acc:a", PER_ACCOUNT);
    expect(checkRateLimit("login:acc:a", PER_ACCOUNT)).toBe(false);
    expect(checkRateLimit("login:acc:b", PER_ACCOUNT)).toBe(true);
  });

  it("batas per-IP jauh lebih longgar (banyak kasir di balik satu NAT)", () => {
    const ip = "login:ip:203.0.113.9";
    // 20 percobaan (mis. 20 kasir) tak menyentuh batas 60
    for (let i = 0; i < 20; i++) expect(checkRateLimit(ip, PER_IP)).toBe(true);
  });
});
