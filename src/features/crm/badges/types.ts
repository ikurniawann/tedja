export type Badge = {
  id: string;
  code: string;
  name: string;
  image_url: string | null;
  min_lifetime_xp: number;
  is_active: boolean;
  awarded_count: number;
  created_at: string;
};

export interface BadgesListResult {
  badges: Badge[];
}

export interface SaveBadgePayload {
  id?: string;
  code: string;
  name: string;
  image_url: string | null;
  min_lifetime_xp: number;
  is_active: boolean;
}

export type BadgeForm = {
  id: string;
  code: string;
  name: string;
  image_url: string;
  min_lifetime_xp: string;
  is_active: boolean;
};
