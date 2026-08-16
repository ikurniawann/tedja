import { describe, expect, it } from "vitest";
import {
  canRenamePaymentMethodCode,
  cashierMethodFromHandler,
  isDrawerCashMethod,
  isManualPaymentHandler,
  resolvePaymentCatalogStamp,
  slugifyPaymentMethodCode,
} from "./payment-methods";

describe("cashierMethodFromHandler", () => {
  it("maps catalog handlers to cashier keys", () => {
    expect(cashierMethodFromHandler("cash")).toBe("cash");
    expect(cashierMethodFromHandler("credit")).toBe("credit_card");
    expect(cashierMethodFromHandler("qris")).toBe("qris");
  });
});

describe("isManualPaymentHandler", () => {
  it("allows cash and card, not Xendit QRIS", () => {
    expect(isManualPaymentHandler("cash")).toBe(true);
    expect(isManualPaymentHandler("credit")).toBe(true);
    expect(isManualPaymentHandler("qris")).toBe(false);
  });
});

describe("canRenamePaymentMethodCode", () => {
  it("locks built-in cashier codes", () => {
    expect(canRenamePaymentMethodCode("cash")).toBe(false);
    expect(canRenamePaymentMethodCode("qris")).toBe(false);
    expect(canRenamePaymentMethodCode("transfer_bca")).toBe(true);
  });
});

describe("slugifyPaymentMethodCode", () => {
  it("builds a stable catalog code", () => {
    expect(slugifyPaymentMethodCode("Transfer BCA")).toBe("transfer_bca");
    expect(slugifyPaymentMethodCode("  EDC-Mandiri  ")).toBe("edc_mandiri");
  });
});

describe("resolvePaymentCatalogStamp", () => {
  it("sanitizes catalog identity for the paid order", () => {
    expect(
      resolvePaymentCatalogStamp({
        code: "Transfer BCA",
        name: "  Transfer BCA  ",
      })
    ).toEqual({
      payment_method_code: "transfer_bca",
      payment_method_name: "Transfer BCA",
    });
  });
});

describe("isDrawerCashMethod", () => {
  it("counts only built-in cash toward the drawer", () => {
    expect(isDrawerCashMethod({ paymentMethod: "cash" })).toBe(true);
    expect(
      isDrawerCashMethod({
        paymentMethod: "cash",
        paymentMethodCode: "cash",
      })
    ).toBe(true);
    expect(
      isDrawerCashMethod({
        paymentMethod: "cash",
        paymentMethodCode: "transfer_bca",
      })
    ).toBe(false);
  });
});
