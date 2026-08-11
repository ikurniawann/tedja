import { describe, expect, it } from "vitest";
import {
  cardLinkConflictMessage,
  resolveCustomerSearchInitialView,
  shouldShowGuestOption,
} from "./customer-search-modal-state";

describe("resolveCustomerSearchInitialView", () => {
  it("opens choice when modal has a pending unregistered card", () => {
    expect(
      resolveCustomerSearchInitialView({
        open: true,
        initialNfcUid: " 04aabbcc ",
      })
    ).toBe("choice");
  });

  it("opens select when opened without a card (Find customer)", () => {
    expect(
      resolveCustomerSearchInitialView({
        open: true,
        initialNfcUid: null,
      })
    ).toBe("select");
  });

  it("stays select when closed", () => {
    expect(
      resolveCustomerSearchInitialView({
        open: false,
        initialNfcUid: "04AABBCC",
      })
    ).toBe("select");
  });
});

describe("cardLinkConflictMessage", () => {
  it("allows linking when customer has no card", () => {
    expect(
      cardLinkConflictMessage({
        existingNfcUid: null,
        pendingNfcUid: "04AABBCC",
      })
    ).toBeNull();
  });

  it("allows relink when the same card is already on the customer", () => {
    expect(
      cardLinkConflictMessage({
        existingNfcUid: "04aabbcc",
        pendingNfcUid: "04AABBCC",
      })
    ).toBeNull();
  });

  it("blocks linking when customer already has a different card", () => {
    expect(
      cardLinkConflictMessage({
        existingNfcUid: "DEADBEEF",
        pendingNfcUid: "04AABBCC",
      })
    ).toMatch(/DEADBEEF/);
  });
});

describe("shouldShowGuestOption", () => {
  it("hides Guest while linking an unregistered card", () => {
    expect(shouldShowGuestOption({ allowGuest: true, isLinkingCard: true })).toBe(
      false
    );
  });

  it("hides Guest on topup even without a pending card", () => {
    expect(shouldShowGuestOption({ allowGuest: false, isLinkingCard: false })).toBe(
      false
    );
  });

  it("shows Guest on cashier Find customer", () => {
    expect(shouldShowGuestOption({ allowGuest: true, isLinkingCard: false })).toBe(
      true
    );
  });
});
