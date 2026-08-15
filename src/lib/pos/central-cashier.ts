import {
  posCartHasItems,
  type ActiveStallMode,
} from "@/lib/pos/pos-sell-stall";

export const CENTRAL_CASHIER_MENU = "pos.cashier.central";

export function canSellMixedStall(input: {
  hasCentralMenu: boolean;
  canCentralCheckout: boolean;
  activeMode: ActiveStallMode;
}): boolean {
  return (
    input.hasCentralMenu &&
    input.canCentralCheckout &&
    input.activeMode === "all"
  );
}

export function uniqueStallIds(
  warehouseIds: Array<string | null | undefined>
): string[] {
  return [...new Set(warehouseIds.filter((id): id is string => Boolean(id)))];
}

export function shouldCreateCheckout(stallIds: string[]): boolean {
  return uniqueStallIds(stallIds).length >= 2;
}

export function canAddItemToSingleStallCart(
  existingStallIds: string[],
  incomingWarehouseId: string | null | undefined
): { ok: true } | { ok: false; message: string } {
  if (!incomingWarehouseId) {
    return {
      ok: false,
      message: "Ada produk tanpa stall — tidak bisa dimasukkan ke keranjang",
    };
  }
  const existing = uniqueStallIds(existingStallIds);
  if (existing.length === 0 || existing[0] === incomingWarehouseId) {
    return { ok: true };
  }
  return {
    ok: false,
    message:
      "Keranjang hanya boleh dari satu stall. Kosongkan keranjang atau ganti filter stall",
  };
}

export function shouldConfirmClearCart(raw: string | null | undefined): boolean {
  return posCartHasItems(raw);
}
