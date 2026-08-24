import { afterEach, describe, expect, it, vi } from "vitest";
import { isDevBypassCode, isLocalDatabase, memberOtpDevCode } from "./dev-bypass";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllEnvs();
});

function setEnv(nodeEnv: string, code: string | undefined, dbUrl: string) {
  vi.stubEnv("NODE_ENV", nodeEnv);
  if (code === undefined) delete process.env.MEMBER_OTP_DEV_CODE;
  else process.env.MEMBER_OTP_DEV_CODE = code;
  process.env.DATABASE_URL = dbUrl;
}

const LOCAL = "postgresql://ilham@localhost:5432/arkiv";
const REMOTE = "postgresql://user:pw@db.suluinwounderland.com:5432/arkiv";

describe("isLocalDatabase", () => {
  it("hanya localhost/127.0.0.1 yang dianggap lokal", () => {
    expect(isLocalDatabase(LOCAL)).toBe(true);
    expect(isLocalDatabase("postgresql://u@127.0.0.1:5432/db")).toBe(true);
    expect(isLocalDatabase(REMOTE)).toBe(false);
    expect(isLocalDatabase(undefined)).toBe(false);
    expect(isLocalDatabase("bukan-url")).toBe(false);
  });
});

describe("memberOtpDevCode — tiga lapis pengaman", () => {
  it("aktif hanya bila ketiganya lolos", () => {
    setEnv("development", "000000", LOCAL);
    expect(memberOtpDevCode()).toBe("000000");
  });

  it("MATI di production walau env lain benar", () => {
    setEnv("production", "000000", LOCAL);
    expect(memberOtpDevCode()).toBeNull();
    expect(isDevBypassCode("000000")).toBe(false);
  });

  it("MATI bila MEMBER_OTP_DEV_CODE tidak disetel — tidak ada default", () => {
    setEnv("development", undefined, LOCAL);
    expect(memberOtpDevCode()).toBeNull();
    setEnv("development", "   ", LOCAL);
    expect(memberOtpDevCode()).toBeNull();
  });

  it("MATI bila DATABASE_URL bukan localhost", () => {
    setEnv("development", "000000", REMOTE);
    expect(memberOtpDevCode()).toBeNull();
    expect(isDevBypassCode("000000")).toBe(false);
  });
});

describe("isDevBypassCode", () => {
  it("hanya menerima kode yang sama persis", () => {
    setEnv("development", "000000", LOCAL);
    expect(isDevBypassCode("000000")).toBe(true);
    expect(isDevBypassCode("000001")).toBe(false);
    expect(isDevBypassCode("")).toBe(false);
  });
});
