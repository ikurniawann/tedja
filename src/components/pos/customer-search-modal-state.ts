export type CustomerSearchView = "choice" | "select" | "create";

export function resolveCustomerSearchInitialView(input: {
  open: boolean;
  initialNfcUid?: string | null;
}): CustomerSearchView {
  if (!input.open) return "select";
  return input.initialNfcUid?.trim() ? "choice" : "select";
}

export function cardLinkConflictMessage(input: {
  existingNfcUid?: string | null;
  pendingNfcUid: string;
}): string | null {
  const existing = input.existingNfcUid?.trim().toUpperCase();
  const pending = input.pendingNfcUid.trim().toUpperCase();
  if (!existing || !pending || existing === pending) return null;
  return `Customer already has Card ${input.existingNfcUid?.trim()}. Unlink it first or pick another customer.`;
}

export function shouldShowGuestOption(input: {
  allowGuest?: boolean;
  isLinkingCard: boolean;
}): boolean {
  if (input.isLinkingCard) return false;
  return input.allowGuest !== false;
}
