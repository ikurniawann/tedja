export interface ProfitBucket {
  id: string;
  label: string;
  quantity: number;
  revenue: number;
  cogs: number;
  gross_profit: number;
  gross_margin_pct: number;
}

export interface ProfitReport {
  filters: {
    date_from: string;
    date_to: string;
  };
  summary: {
    orders: number;
    items: number;
    quantity: number;
    revenue: number;
    cogs: number;
    gross_profit: number;
    gross_margin_pct: number;
    zero_cost_items: number;
  };
  breakdowns: {
    products: ProfitBucket[];
    categories: ProfitBucket[];
    stations: ProfitBucket[];
    cashiers: ProfitBucket[];
    dates: ProfitBucket[];
  };
}

export interface ProfitReportParams {
  date_from: string;
  date_to: string;
}

export interface ClosingReportParams {
  date: string;
  shift_id?: string;
}

export interface ClosingCategoryRow {
  name: string;
  amount: number;
  percentage: number;
}

export interface ClosingPromoRow {
  name: string;
  qty: number;
}

export interface ClosingTargetRow {
  target: number;
  actual: number;
  variance: number;
}

export interface ClosingReport {
  filters: {
    date: string;
    shift_id: string | null;
  };
  header: {
    title: string;
    outlet_line: string;
    report_date: string;
  };
  shift_sessions: Array<{
    label: string;
    last_order: string;
    closed_at: string;
  }>;
  sales_summary: {
    net_sales: number;
    service: number;
    tax: number;
    discount: number;
    gross: number;
  };
  guests: {
    count: number;
    average_per_pax: number;
  };
  categories_by_segment: Array<{
    segment: string;
    title: string;
    rows: ClosingCategoryRow[];
  }>;
  targets: {
    daily: ClosingTargetRow;
    monthly: ClosingTargetRow;
    month_to_date: ClosingTargetRow;
  };
  promos_by_segment: Array<{
    segment: string;
    title: string;
    rows: ClosingPromoRow[];
  }>;
  footer: {
    printed_by: string;
  };
}

export interface ReportStallOption {
  id: string;
  code: string;
  name: string;
}

export interface TransactionReportParams {
  date_from: string;
  date_to: string;
  warehouse_id?: string;
}

export interface TransactionReportRow {
  id: string;
  order_number: string | null;
  ordered_at: string | null;
  status: string | null;
  payment_status: string | null;
  payment_method: string | null;
  total_amount: number;
  ark_coins_used: number;
  cashier_id: string | null;
  warehouse_id: string | null;
  stall_code: string | null;
  stall_name: string | null;
  checkout_id?: string | null;
  checkout_number?: string | null;
  sold_from?: string | null;
  xendit_qr_id?: string | null;
  xendit_external_id?: string | null;
}

export interface TransactionReport {
  filters: {
    date_from: string;
    date_to: string;
    warehouse_id: string | null;
  };
  stall_options: ReportStallOption[];
  stall_locked: boolean;
  summary: {
    transactions: number;
    total_sales: number;
    total_ark_used: number;
  };
  rows: TransactionReportRow[];
}

export interface ProductSalesReportParams {
  date_from: string;
  date_to: string;
  warehouse_id?: string;
}

export interface ProductSalesReportRow {
  product_id: string | null;
  product_name: string;
  product_sku: string | null;
  warehouse_id: string | null;
  stall_code: string | null;
  stall_name: string | null;
  quantity: number;
  revenue: number;
  order_count: number;
}

export interface ProductSalesReport {
  filters: {
    date_from: string;
    date_to: string;
    warehouse_id: string | null;
  };
  stall_options: ReportStallOption[];
  stall_locked: boolean;
  summary: {
    products: number;
    quantity: number;
    revenue: number;
  };
  rows: ProductSalesReportRow[];
}
