export type PaymentMethod = "qris" | "credit_card" | "cash";
export type TopupStatus = "idle" | "enter_amount" | "payment" | "processing" | "success";

export interface TopupCustomer {
  id: string;
  name?: string | null;
  phone: string;
  membership_tier?: string | null;
  ark_coin_balance: number;
  nfc_uid?: string | null;
}

export interface TopupResult {
  transaction?: {
    id: string;
    payment_method?: string;
    created_at?: string;
  };
  balance_before: number;
  balance_after: number;
  ark_coins: number;
  qr_code_url?: string | null;
}

export interface CustomerListParams {
  search?: string;
}

export interface ProcessTopupPayload {
  customer_id: string;
  amount: number;
  payment_method: string;
}
