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
