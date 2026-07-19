export type CrmReportTopSpender = {
  id: string;
  name: string;
  phone: string;
  membership_tier: string;
  member_type: string;
  order_count: number;
  total_spend: number;
  ark_spend: number;
  last_order_at: string | null;
};

export type CrmReportFrequentVisitor = {
  id: string;
  name: string;
  phone: string;
  membership_tier: string;
  member_type: string;
  order_count: number;
  visit_days: number;
  lifetime_visits: number;
  last_visit_at: string | null;
};

export type CrmReportVenueRow = {
  company_id: string | null;
  branch_id: string | null;
  company_name: string;
  branch_name: string;
  topup_amount: number;
  bonus_amount: number;
  spend_amount: number;
  other_amount: number;
  topup_count: number;
  payment_count: number;
  net_flow: number;
};

export type CrmReportData = {
  period: { from: string; to: string };
  topSpenders: CrmReportTopSpender[];
  frequentVisitors: CrmReportFrequentVisitor[];
  reconciliation: {
    venues: CrmReportVenueRow[];
    totals: {
      topup_amount: number;
      bonus_amount: number;
      spend_amount: number;
      net_flow: number;
    };
    outstanding_balance: number;
  };
  members: {
    card: number;
    registered: number;
  };
};

export type CrmReportPeriodInput = {
  from: string;
  to: string;
};
