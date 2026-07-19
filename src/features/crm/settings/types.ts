export type CrmSettings = {
  topup_bonus_percent: number;
  profile_completion_free_xp: number;
};

export type CrmTierConfig = {
  id?: string;
  code: string;
  name: string;
  rank: number;
  min_lifetime_xp: number;
  min_total_spend: number;
  xp_multiplier: number;
  discount_percent: number;
  display_color?: string | null;
  is_active: boolean;
};

export type PosProductXp = {
  id: string;
  sku: string;
  name: string;
  base_price: number;
  xp: number;
  category?: { name: string } | null;
};

export type CrmXpRuleConfig = {
  id?: string;
  code: string;
  name: string;
  source_channel: string;
  source_type: string;
  source_id?: string | null;
  outlet_scope?: "all" | "specific";
  outlet_id?: string | null;
  xp_mode: "fixed" | "per_item" | "per_amount" | "multiplier" | "percentage";
  xp_value: number;
  amount_step: number;
  min_amount: number;
  max_xp_per_event: number | null;
  tier_multiplier_enabled: boolean;
  priority: number;
  is_active: boolean;
};
