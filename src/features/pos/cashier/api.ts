import {
  createSplitOrder,
  getCustomerFavoriteProducts,
  getPOSTables,
  openBill,
  saveCustomer,
  updateOrderStatus,
} from "@/lib/pos-api";
import type { Customer, PosTable, Product } from "@/lib/pos-api";

export type { Customer, PosTable, Product };

export interface CashierOrderItem {
  id?: string;
  product_id: string;
  product_name: string;
  quantity: number | string;
  unit_price?: number | string;
  subtotal?: number | string;
  total_amount?: number | string;
  variants?: Array<{ name?: string }>;
  modifiers?: Array<{ name?: string }>;
  station?: string;
}

export interface CashierOrder {
  id: string;
  order_number?: string;
  order_type?: string;
  table_id?: string | null;
  customer_id?: string | null;
  notes?: string | null;
  total_amount?: number;
  items?: CashierOrderItem[];
}

export interface PayOpenOrderPayload {
  status: string;
  payment_status: string;
  payment_method: string;
  amount_paid: number;
  ark_coins_used?: number;
  /** UID gelang ticketing — wajib saat payment_method 'nfc_tab' */
  nfc_tab_uid?: string;
}

export async function listCashierTables(): Promise<PosTable[]> {
  const res = await getPOSTables();
  if (!res.success) {
    throw new Error(res.error || "Failed to load tables");
  }
  return res.data ?? [];
}

export async function getCashierOrder(orderId: string): Promise<CashierOrder> {
  const response = await fetch(`/api/pos/orders/${orderId}`, { cache: "no-store" });
  const json = await response.json();
  if (!json.success || !json.data) {
    throw new Error(json.error || "Failed to load order");
  }
  return json.data as CashierOrder;
}

export async function payOpenOrder(orderId: string, payload: PayOpenOrderPayload) {
  return updateOrderStatus(orderId, payload.status, {
    payment_status: payload.payment_status,
    payment_method: payload.payment_method,
    amount_paid: payload.amount_paid,
    ark_coins_used: payload.ark_coins_used,
    nfc_tab_uid: payload.nfc_tab_uid,
  });
}

export async function listCustomerFavoriteProducts(customerId: string, products: Product[] = []) {
  return getCustomerFavoriteProducts(customerId, products);
}

export { saveCustomer, openBill, createSplitOrder };
