import { describe, expect, it } from "vitest";
import {
  buildQrImageUrl,
  parseXenditQrWebhook,
  verifyXenditWebhookToken,
} from "./xendit";

describe("verifyXenditWebhookToken", () => {
  it("allows when expected token is empty", () => {
    expect(verifyXenditWebhookToken(null, null)).toBe(true);
    expect(verifyXenditWebhookToken("abc", null)).toBe(true);
  });

  it("requires match when configured", () => {
    expect(verifyXenditWebhookToken("tok", "tok")).toBe(true);
    expect(verifyXenditWebhookToken("wrong", "tok")).toBe(false);
    expect(verifyXenditWebhookToken(null, "tok")).toBe(false);
  });
});

describe("parseXenditQrWebhook", () => {
  it("detects paid qr.payment payload", () => {
    const parsed = parseXenditQrWebhook({
      event: "qr.payment",
      data: {
        id: "qrpy_1",
        qr_id: "qr_abc",
        reference_id: "topup_xyz",
        status: "SUCCEEDED",
        amount: 50000,
      },
    });
    expect(parsed.paid).toBe(true);
    expect(parsed.qrId).toBe("qr_abc");
    expect(parsed.referenceId).toBe("topup_xyz");
    expect(parsed.amount).toBe(50000);
  });

  it("ignores non-paid status", () => {
    const parsed = parseXenditQrWebhook({
      data: { status: "PENDING", qr_id: "qr_1" },
    });
    expect(parsed.paid).toBe(false);
  });
});

describe("buildQrImageUrl", () => {
  it("encodes qr string", () => {
    const url = buildQrImageUrl("000201");
    expect(url).toContain("create-qr-code");
    expect(url).toContain("000201");
  });
});
