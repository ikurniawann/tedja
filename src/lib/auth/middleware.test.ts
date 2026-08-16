import { describe, expect, it } from "vitest";
import { isPublicAuthPath } from "./middleware";

describe("isPublicAuthPath", () => {
  it("allows Xendit POS webhook without a session", () => {
    expect(isPublicAuthPath("/api/payments/xendit/webhook")).toBe(true);
  });

  it("still protects POS APIs", () => {
    expect(isPublicAuthPath("/api/pos/qris")).toBe(false);
    expect(isPublicAuthPath("/api/pos/orders")).toBe(false);
  });
});
