import { describe, expect, it } from "vitest";
import {
  canDeleteEntry,
  canEditEntryItems,
  canReviewEntry,
  canReviewLogbook,
  canSubmitEntry,
  hasFullLogbookAccess,
  resolveDepartmentScope,
} from "@/lib/hris/logbook";

describe("logbook role guards", () => {
  it("grants full access to super_admin, admin, hrd only", () => {
    expect(hasFullLogbookAccess("super_admin")).toBe(true);
    expect(hasFullLogbookAccess("admin")).toBe(true);
    expect(hasFullLogbookAccess("hrd")).toBe(true);
    expect(hasFullLogbookAccess("purchasing_manager")).toBe(false);
    expect(hasFullLogbookAccess("")).toBe(false);
  });

  it("allows review only for super_admin and hrd", () => {
    expect(canReviewLogbook("super_admin")).toBe(true);
    expect(canReviewLogbook("hrd")).toBe(true);
    expect(canReviewLogbook("admin")).toBe(false);
    expect(canReviewLogbook("employee")).toBe(false);
  });
});

describe("logbook status flow guards", () => {
  it("submit only from draft", () => {
    expect(canSubmitEntry("draft")).toBe(true);
    expect(canSubmitEntry("submitted")).toBe(false);
    expect(canSubmitEntry("reviewed")).toBe(false);
    expect(canSubmitEntry("rejected")).toBe(false);
  });

  it("review only from submitted", () => {
    expect(canReviewEntry("submitted")).toBe(true);
    expect(canReviewEntry("draft")).toBe(false);
    expect(canReviewEntry("reviewed")).toBe(false);
  });

  it("delete and item edits only while draft", () => {
    expect(canDeleteEntry("draft")).toBe(true);
    expect(canDeleteEntry("submitted")).toBe(false);
    expect(canEditEntryItems("draft")).toBe(true);
    expect(canEditEntryItems("submitted")).toBe(false);
  });
});

describe("resolveDepartmentScope", () => {
  const dept = "dept-1";
  const other = "dept-2";

  it("full access: free to pick any department or all", () => {
    const actor = { isFullAccess: true, departmentId: null };
    expect(resolveDepartmentScope(actor, null)).toEqual({
      allowed: true,
      departmentId: null,
    });
    expect(resolveDepartmentScope(actor, other)).toEqual({
      allowed: true,
      departmentId: other,
    });
  });

  it("non full access: locked to own department even without explicit request", () => {
    const actor = { isFullAccess: false, departmentId: dept };
    expect(resolveDepartmentScope(actor, null)).toEqual({
      allowed: true,
      departmentId: dept,
    });
    expect(resolveDepartmentScope(actor, dept)).toEqual({
      allowed: true,
      departmentId: dept,
    });
  });

  it("non full access: requesting another department is denied", () => {
    const actor = { isFullAccess: false, departmentId: dept };
    expect(resolveDepartmentScope(actor, other).allowed).toBe(false);
  });

  it("non full access without linked department is denied", () => {
    const actor = { isFullAccess: false, departmentId: null };
    expect(resolveDepartmentScope(actor, null).allowed).toBe(false);
    expect(resolveDepartmentScope(actor, dept).allowed).toBe(false);
  });
});
