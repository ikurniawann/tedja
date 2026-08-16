export type PosPaymentMethodCode =
  | "cash"
  | "qris"
  | "credit_card"
  | "ark_coin"
  | "nfc_tab"
  | "gift_card";

export type PosPaymentHandler =
  | "cash"
  | "qris"
  | "credit"
  | "ark_wallet"
  | "nfc_tab"
  | "gift_card";

export type PosPaymentMethod = {
  id: string;
  /** Kode bawaan (union di atas) ATAU slug metode kustom buatan admin */
  code: string;
  name: string;
  description: string;
  icon: string;
  handler: PosPaymentHandler;
  is_active: boolean;
  sort_order: number;
  requires_cash_input: boolean;
};

export const POS_PAYMENT_METHOD_CODES: PosPaymentMethodCode[] = [
  "cash",
  "qris",
  "credit_card",
  "ark_coin",
  "nfc_tab",
  "gift_card",
];

/** Kode bawaan ber-alur khusus — tidak boleh dihapus dari master. */
export const PROTECTED_PAYMENT_METHOD_CODES = new Set<string>(
  POS_PAYMENT_METHOD_CODES
);

/** Slug kode metode (bawaan maupun kustom): huruf kecil/angka/-/_ 2-40. */
export const PAYMENT_METHOD_CODE_PATTERN = /^[a-z0-9_-]{2,40}$/;

export function isValidPaymentMethodCode(code: string): boolean {
  return PAYMENT_METHOD_CODE_PATTERN.test(code);
}

/** Nama tampilan → slug kode ("Transfer BCA" → "transfer-bca"). */
export function slugifyPaymentMethodCode(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Fallback jika tabel belum ada / API gagal — sama dengan seed. */
export const DEFAULT_POS_PAYMENT_METHODS: PosPaymentMethod[] = [
  {
    id: "fallback-cash",
    code: "cash",
    name: "Cash",
    description: "Pay with cash",
    icon: "banknote",
    handler: "cash",
    is_active: true,
    sort_order: 10,
    requires_cash_input: true,
  },
  {
    id: "fallback-qris",
    code: "qris",
    name: "QRIS",
    description: "Scan QR code",
    icon: "qr-code",
    handler: "qris",
    is_active: true,
    sort_order: 20,
    requires_cash_input: false,
  },
  {
    id: "fallback-credit",
    code: "credit_card",
    name: "Credit Card",
    description: "Visa / Mastercard",
    icon: "credit-card",
    handler: "credit",
    is_active: true,
    sort_order: 30,
    requires_cash_input: false,
  },
  {
    id: "fallback-ark",
    code: "ark_coin",
    name: "ARK Coin",
    description: "Member balance",
    icon: "coins",
    handler: "ark_wallet",
    is_active: true,
    sort_order: 40,
    requires_cash_input: false,
  },
  {
    id: "fallback-nfc",
    code: "nfc_tab",
    name: "NFC Tab",
    description: "Gelang ticketing",
    icon: "ticket",
    handler: "nfc_tab",
    is_active: true,
    sort_order: 50,
    requires_cash_input: false,
  },
  {
    id: "fallback-gift",
    code: "gift_card",
    name: "Gift Card",
    description: "Saldo kartu hadiah",
    icon: "gift",
    handler: "gift_card",
    is_active: true,
    sort_order: 60,
    requires_cash_input: false,
  },
];

export function isPosPaymentMethodCode(value: string): value is PosPaymentMethodCode {
  return (POS_PAYMENT_METHOD_CODES as string[]).includes(value);
}
