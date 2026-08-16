export type {
  Order,
  OrderItem,
  Customer,
} from "@/lib/pos-api";

export interface OrderListParams {
  status?: string;
  customer_id?: string;
  payment_status?: string;
  order_type?: string;
  payment_method?: string;
  date_from?: string;
  date_to?: string;
  q?: string;
  active_only?: boolean;
  limit?: number;
}

export interface UpdateOrderStatusPayload {
  status: string;
  payment_status?: string;
  payment_method?: string;
  amount_paid?: number;
  ark_coins_used?: number;
  cancelled_reason?: string;
}

export interface CustomerListParams {
  search?: string;
  phone?: string;
}
