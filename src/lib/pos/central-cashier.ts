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
  incomingWarehouseId: string | null | undefined,
  options?: { centralAllMode?: boolean }
): { ok: true } | { ok: false; message: string } {
  if (!incomingWarehouseId) {
    if (options?.centralAllMode) {
      return {
        ok: false,
        message: "Ada produk tanpa stall — tidak bisa dimasukkan ke keranjang",
      };
    }
    return { ok: true };
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

/** Phase 1: one stall in the cart + kasir pusat mode all → sell as that stall. */
export function resolveSingleStallSellFromAllMode(input: {
  itemWarehouses: Array<string | null | undefined>;
  canSellMixed: boolean;
}): string | null {
  const stallIds = uniqueStallIds(input.itemWarehouses);
  if (stallIds.length === 1 && input.canSellMixed) {
    return stallIds[0] ?? null;
  }
  return null;
}

/** After resolving stallIds[0] in all-mode, require it is in the user's allowed set. */
export function assertAllModeSellStallAssigned(
  warehouseId: string,
  allowedStallIds: readonly string[]
): { ok: true } | { ok: false; message: string } {
  if (allowedStallIds.includes(warehouseId)) {
    return { ok: true };
  }
  return {
    ok: false,
    message: "Stall aktif di luar penempatan Anda",
  };
}

export type CheckoutChargeSlice = {
  warehouseId: string;
  subtotal: number;
};

export type AllocatedCheckoutSlice = CheckoutChargeSlice & {
  discount: number;
  tax: number;
  serviceCharge: number;
  otherCharges: number;
  total: number;
};

function allocateAmount(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => Math.floor((total * w) / sum));
  let remainder = total - raw.reduce((a, b) => a + b, 0);
  const largest = weights.indexOf(Math.max(...weights));
  if (remainder !== 0 && largest >= 0) raw[largest] += remainder;
  return raw;
}

export function allocateCheckoutCharges(input: {
  slices: CheckoutChargeSlice[];
  discount: number;
  tax: number;
  serviceCharge: number;
  otherCharges: number;
}): AllocatedCheckoutSlice[] {
  const weights = input.slices.map((s) => s.subtotal);
  const discounts = allocateAmount(input.discount, weights);
  const taxes = allocateAmount(input.tax, weights);
  const services = allocateAmount(input.serviceCharge, weights);
  const others = allocateAmount(input.otherCharges, weights);
  return input.slices.map((slice, index) => {
    const discount = discounts[index] ?? 0;
    const tax = taxes[index] ?? 0;
    const serviceCharge = services[index] ?? 0;
    const otherCharges = others[index] ?? 0;
    return {
      ...slice,
      discount,
      tax,
      serviceCharge,
      otherCharges,
      total: slice.subtotal - discount + tax + serviceCharge + otherCharges,
    };
  });
}
