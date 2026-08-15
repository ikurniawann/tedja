export interface CampaignSegmentForm {
  last_visit_days: number | null;
  tiers: string[];
  min_xp: number | null;
}

export interface CrmCampaign {
  id: string;
  name: string;
  message_template: string;
  segment: CampaignSegmentForm;
  promo_campaign_id: string | null;
  promo_mode: "public" | "batch" | null;
  voucher_prefix: string | null;
  status: "draft" | "sending" | "paused" | "done" | "cancelled";
  daily_cap: number | null;
  recipients_built: boolean;
  created_at: string;
  pending_count: string;
  sent_count: string;
  failed_count: string;
}

export interface SegmentPreview {
  count: number;
  optedOut: number;
  sample: { name: string; phone: string; last_visit: string | null }[];
}

export interface CampaignReport {
  campaign: { id: string; name: string; status: string };
  funnel: {
    total: number;
    pending: number;
    sent: number;
    failed: number;
    skipped: number;
    redeemed: number;
    redeemed_value: number;
  };
}

export interface CampaignConfig {
  enabled: boolean;
  daily_cap: number;
}

export interface MarketingOptout {
  id: string;
  phone: string;
  source: "manual" | "keyword";
  note: string | null;
  created_at: string;
}
