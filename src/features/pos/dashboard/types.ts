export type DashboardPeriod = "today" | "week" | "month";

export interface DashboardStats {
  todayRevenue: number;
  todayOrders: number;
  averageOrderValue: number;
  activeCashiers: number;
  revenueChange: number;
  ordersChange: number;
}

export interface TopProduct {
  id: string;
  name: string;
  sold: number;
  revenue: number;
}

export interface RecentOrder {
  id: string;
  cashier: string;
  total: number;
  status: string;
  payment_status?: string;
  time: string;
}

export interface ArkXpStats {
  totalArkUsed: number;
  totalArkEarned: number;
  totalXpEarned: number;
  arkPaymentOrders: number;
  membersWithXp: number;
  totalArkBalance: number;
}

export interface TrendPoint {
  label: string;
  revenue: number;
  orders: number;
  arkUsed: number;
  xpEarned: number;
}

export interface LoyalMember {
  id: string;
  name: string;
  membershipTier: string;
  totalXp: number;
  currentXp: number;
  arkBalance: number;
}

export interface DashboardBundle {
  stats: DashboardStats | null;
  topProducts: TopProduct[];
  recentOrders: RecentOrder[];
  arkXp: ArkXpStats | null;
  trend: TrendPoint[];
  topLoyalMembers: LoyalMember[];
}
