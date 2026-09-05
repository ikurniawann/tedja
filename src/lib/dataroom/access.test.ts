import { describe, expect, it } from "vitest";
import { evaluateAccess, isDataroomAdminRole } from "./access";

describe("dataroom evaluateAccess", () => {
  it("folder tanpa konfigurasi terbuka untuk siapa pun", () => {
    expect(evaluateAccess([], "hrd", false)).toBe(true);
    expect(evaluateAccess([[], null, undefined], null, false)).toBe(true);
  });

  it("konfigurasi di jalur harus memuat departemen user", () => {
    expect(evaluateAccess([["hrd", "fin"]], "hrd", false)).toBe(true);
    expect(evaluateAccess([["hrd", "fin"]], "ops", false)).toBe(false);
    expect(evaluateAccess([["hrd"], ["hrd", "fin"]], "hrd", false)).toBe(true);
    // subfolder dibuka untuk fin, tapi induknya hanya hrd → tetap ditolak
    expect(evaluateAccess([["fin"], ["hrd"]], "fin", false)).toBe(false);
  });

  it("user tanpa departemen hanya bisa folder terbuka; super admin selalu bisa", () => {
    expect(evaluateAccess([["hrd"]], null, false)).toBe(false);
    expect(evaluateAccess([["hrd"]], null, true)).toBe(true);
    expect(isDataroomAdminRole("super_admin")).toBe(true);
    expect(isDataroomAdminRole("admin")).toBe(false);
  });
});
