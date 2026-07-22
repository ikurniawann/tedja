import type { ReEntryPolicy } from "../masters/types";

export type TicketStatus = "draft" | "active";
export type ProductDateKind = "high-season" | "blok-online";

export interface TicketCategory {
  id: string;
  name: string;
}

export interface TicketProductListItem {
  id: string;
  code: string;
  name: string;
  category_name: string | null;
  status: TicketStatus;
  base_price: number;
  thumbnail_url: string | null;
  variant_count: number;
  distributed_channels: string[];
  updated_at: string;
}

export interface TicketVariant {
  id: string;
  code: string;
  name: string;
  price_regular: number | null;
  price_high: number | null;
  sort_order: number;
  is_active: boolean;
}

export interface TicketProductDate {
  id: string;
  date_kind: ProductDateKind;
  label: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

export interface TicketProductChannel {
  id: string;
  channel_code: string;
  channel_name: string;
  is_online: boolean;
  is_distributed: boolean;
}

export interface TicketProductDetail {
  product: {
    id: string;
    code: string;
    name: string;
    category_id: string | null;
    category_name: string | null;
    status: TicketStatus;
    base_price: number;
    thumbnail_url: string | null;
    description: string | null;
    re_entry_policy: ReEntryPolicy;
    created_at: string;
    updated_at: string;
  };
  variants: TicketVariant[];
  dates: TicketProductDate[];
  channels: TicketProductChannel[];
}

export interface CreateTicketValues {
  name: string;
  category_id?: string | null;
  category_name?: string | null;
  status?: TicketStatus;
  base_price?: number;
  description?: string | null;
}

export interface UpdateTicketValues {
  name?: string;
  category_id?: string | null;
  category_name?: string | null;
  status?: TicketStatus;
  base_price?: number;
  description?: string | null;
  re_entry_policy?: ReEntryPolicy;
  variants?: {
    id: string;
    name?: string;
    price_regular?: number | null;
    price_high?: number | null;
    is_active?: boolean;
  }[];
}

export interface CreateDateValues {
  date_kind: ProductDateKind;
  label: string;
  start_date: string;
  end_date: string;
}

export interface ChannelOverride {
  variant_id: string;
  price_regular: number | null;
  price_high: number | null;
}

export interface ChannelManagerChannel {
  channel_id: string;
  channel_code: string;
  channel_name: string;
  is_online: boolean;
  is_distributed: boolean;
  price_complete: boolean;
  overrides: ChannelOverride[];
}

export interface ChannelManagerItem {
  id: string;
  code: string;
  name: string;
  status: TicketStatus;
  thumbnail_url: string | null;
  variants: {
    id: string;
    name: string;
    price_regular: number | null;
    price_high: number | null;
  }[];
  channels: ChannelManagerChannel[];
}

export interface LoketOption {
  variant_id: string;
  variant_name: string;
  ticket_product_id: string;
  ticket_code: string;
  ticket_name: string;
  price_regular: number | null;
  price_high: number | null;
}
