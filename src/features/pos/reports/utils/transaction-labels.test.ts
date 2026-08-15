import { describe, expect, it } from "vitest";
import {
  formatKitchenStatusLabel,
  formatOrderTypeLabel,
  formatPaymentMethodLabel,
  formatPaymentStatusLabel,
  formatSoldFromLabel,
  formatXenditPaymentLabel,
  formatXenditSettlementNote,
  isPaidPaymentStatus,
  isQrisPaymentMethod,
  resolveXenditExternalId,
} from "./transaction-labels";

describe("formatPaymentStatusLabel", () => {
  it("uses payment_status, not kitchen pending", () => {
    expect(formatPaymentStatusLabel("paid", "pending")).toBe("Lunas");
    expect(formatPaymentStatusLabel("unpaid", "pending")).toBe("Belum lunas");
  });

  it("treats completed kitchen as lunas when payment_status missing", () => {
    expect(formatPaymentStatusLabel(null, "completed")).toBe("Lunas");
  });
});

describe("formatPaymentMethodLabel", () => {
  it("maps POS codes to Indonesian labels", () => {
    expect(formatPaymentMethodLabel("qris")).toBe("QRIS");
    expect(formatPaymentMethodLabel("cash")).toBe("Tunai");
    expect(formatPaymentMethodLabel("credit")).toBe("Kartu");
  });
});

describe("formatKitchenStatusLabel", () => {
  it("does not call kitchen pending unpaid", () => {
    expect(formatKitchenStatusLabel("pending")).toBe("Antrian dapur");
  });
});

describe("isPaidPaymentStatus", () => {
  it("is true for paid even if kitchen is pending", () => {
    expect(isPaidPaymentStatus("paid", "pending")).toBe(true);
  });
});

describe("formatOrderTypeLabel", () => {
  it("maps POS order types", () => {
    expect(formatOrderTypeLabel("dine_in")).toBe("Dine-in");
    expect(formatOrderTypeLabel("takeaway")).toBe("Takeaway");
  });
});

describe("formatSoldFromLabel", () => {
  it("maps sold_from", () => {
    expect(formatSoldFromLabel("central")).toBe("Kasir pusat");
    expect(formatSoldFromLabel("stall")).toBe("Kasir stall");
  });
});

describe("resolveXenditExternalId", () => {
  it("uses stored id only", () => {
    expect(
      resolveXenditExternalId({
        storedExternalId: "pos-chk-abc",
      })
    ).toBe("pos-chk-abc");
  });

  it("does not invent pos-{orderId} for stall QRIS", () => {
    expect(resolveXenditExternalId({})).toBeNull();
  });
});

describe("formatXenditSettlementNote", () => {
  it("shows Xendit as the settlement source", () => {
    expect(formatXenditSettlementNote()).toBe("Xendit");
  });
});

describe("formatXenditPaymentLabel", () => {
  it("does not treat settlement pending as failed pay", () => {
    expect(formatXenditPaymentLabel("paid", "pending")).toBe("Success");
    expect(isQrisPaymentMethod("qris")).toBe(true);
  });
});
