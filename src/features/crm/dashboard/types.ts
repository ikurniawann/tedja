export type CrmCustomer = {
  id: string;
  name: string;
  phone: string;
  membership_tier: string;
  ark_coin_balance: number;
  total_xp: number;
  total_spent: number;
  visit_count: number;
};

export type CrmXpActivity = {
  id: string;
  direction: string;
  source_channel: string;
  source_type: string;
  xp_delta: number;
  balance_after: number;
  description: string | null;
  created_at: string;
  member?: {
    member_code: string;
    customer_id: string;
  } | null;
};

export type CrmDashboardData = {
  stats: {
    totalCustomers: number;
    totalMembers: number;
    tierCount: number;
    xpRuleCount: number;
    rewardCount: number;
    avatarCount: number;
    redemptionCount: number;
    externalEventCount: number;
  };
  topLoyalMembers: CrmCustomer[];
  topTransactionSpenders: CrmCustomer[];
  topArkSpenders: { customer: CrmCustomer | null; ark_coins_used: number }[];
  recentXpActivity: CrmXpActivity[];
};

export type CrmDashboardResult = {
  data: CrmDashboardData;
  schemaReady: boolean;
};

export type CrmXpRule = {
  id: string;
  code: string;
  name: string;
  source_channel: "pos" | "photobooth" | "studio_game" | "manual" | "campaign";
  source_type: string;
  source_id: string | null;
  outlet_scope: "all" | "specific";
  outlet_id: string | null;
  xp_mode: "fixed" | "per_item" | "per_amount" | "multiplier" | "percentage";
  xp_value: number;
  amount_step: number;
  min_amount: number;
  max_xp_per_event: number | null;
  tier_multiplier_enabled: boolean;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
};

export type CrmTier = {
  id?: string;
  code: string;
  name: string;
  rank: number;
  min_lifetime_xp: number;
  min_total_spend: number;
  xp_multiplier: number;
  discount_percent: number;
  benefits?: string[];
  display_color: string;
  is_active: boolean;
};

export type PosProduct = {
  id: string;
  sku: string;
  name: string;
  base_price: number;
  xp: number;
  xp_points?: number;
  category?: { name: string } | null;
};

export type XpConfigBundle = {
  rules: CrmXpRule[];
  products: PosProduct[];
  productDraft: Record<string, number>;
  globalRuleDraft: {
    xp_value: number;
    amount_step: number;
    tier_multiplier_enabled: boolean;
  };
};

export type TierConfigBundle = {
  tiers: CrmTier[];
  draft: Record<string, CrmTier>;
};

export type XpConfigState = {
  loading: boolean;
  savingKey: string | null;
  message: string | null;
  error: string | null;
  rules: CrmXpRule[];
  products: PosProduct[];
  productDraft: Record<string, number>;
  globalRuleDraft: {
    xp_value: number;
    amount_step: number;
    tier_multiplier_enabled: boolean;
  };
};

export type TierConfigState = {
  loading: boolean;
  savingCode: string | null;
  message: string | null;
  error: string | null;
  tiers: CrmTier[];
  draft: Record<string, CrmTier>;
};
