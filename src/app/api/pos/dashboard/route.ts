import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";

type Period = "today" | "week" | "month";

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getPeriodRange(period: Period) {
  const startDate = new Date();
  const endDate = new Date();

  if (period === "today") {
    startDate.setHours(0, 0, 0, 0);
  } else if (period === "week") {
    const dayOfWeek = startDate.getDay();
    const diff = startDate.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    startDate.setDate(diff);
    startDate.setHours(0, 0, 0, 0);
  } else {
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);
  }

  return { startDate, endDate };
}

function getPreviousPeriodRange(startDate: Date, endDate: Date) {
  const periodDuration = endDate.getTime() - startDate.getTime();
  return {
    prevStart: new Date(startDate.getTime() - periodDuration),
    prevEnd: new Date(startDate.getTime() - 1),
  };
}

function dateKey(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

function hourKey(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}

function fillDailyTrend(
  startDate: Date,
  endDate: Date,
  buckets: Map<string, { revenue: number; orders: number; arkUsed: number; xpEarned: number }>
) {
  const points: Array<{
    label: string;
    revenue: number;
    orders: number;
    arkUsed: number;
    xpEarned: number;
  }> = [];

  const cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    const bucket = buckets.get(key) ?? { revenue: 0, orders: 0, arkUsed: 0, xpEarned: 0 };
    points.push({
      label: cursor.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      ...bucket,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
}

function fillHourlyTrend(
  buckets: Map<string, { revenue: number; orders: number; arkUsed: number; xpEarned: number }>
) {
  const points = [];
  const nowHour = new Date().getHours();

  for (let hour = 0; hour <= nowHour; hour += 1) {
    const key = `${String(hour).padStart(2, "0")}:00`;
    const bucket = buckets.get(key) ?? { revenue: 0, orders: 0, arkUsed: 0, xpEarned: 0 };
    points.push({ label: key, ...bucket });
  }

  return points;
}

// GET /api/pos/dashboard — POS dashboard statistics
export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const searchParams = request.nextUrl.searchParams;
    const period = (searchParams.get("period") || "today") as Period;
    const { startDate, endDate } = getPeriodRange(period);
    const { prevStart, prevEnd } = getPreviousPeriodRange(startDate, endDate);

    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();

    const { data: periodOrders } = await db
      .from("pos_orders")
      .select("id, total_amount, cashier_id, ordered_at, ark_coins_used, payment_method, status")
      .gte("ordered_at", startIso)
      .lte("ordered_at", endIso);

    const completedOrders = (periodOrders ?? []).filter((order) => order.status === "completed");
    const todayRevenue = completedOrders.reduce((sum, order) => sum + toNumber(order.total_amount), 0);
    const todayOrders = completedOrders.length;
    const averageOrderValue = todayOrders > 0 ? todayRevenue / todayOrders : 0;
    const activeCashiers = new Set(
      (periodOrders ?? []).map((order) => order.cashier_id).filter(Boolean)
    ).size;

    const { data: prevRevenueData } = await db
      .from("pos_orders")
      .select("total_amount")
      .eq("status", "completed")
      .gte("ordered_at", prevStart.toISOString())
      .lte("ordered_at", prevEnd.toISOString());

    const prevRevenue = (prevRevenueData ?? []).reduce((sum, order) => sum + toNumber(order.total_amount), 0);
    const revenueChange = prevRevenue > 0 ? ((todayRevenue - prevRevenue) / prevRevenue) * 100 : 0;

    const { count: prevOrders } = await db
      .from("pos_orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("ordered_at", prevStart.toISOString())
      .lte("ordered_at", prevEnd.toISOString());

    const prevOrdersCount = prevOrders || 0;
    const ordersChange = prevOrdersCount > 0 ? ((todayOrders - prevOrdersCount) / prevOrdersCount) * 100 : 0;

    const { data: topProductsRaw } = await db
      .from("pos_order_items")
      .select("product_id, product_name, quantity, total_amount")
      .gte("created_at", startIso)
      .lte("created_at", endIso);

    const productMap = new Map<string, { name: string; sold: number; revenue: number }>();
    topProductsRaw?.forEach((item) => {
      const pid = String(item.product_id);
      const existing = productMap.get(pid);
      if (existing) {
        existing.sold += toNumber(item.quantity);
        existing.revenue += toNumber(item.total_amount);
      } else {
        productMap.set(pid, {
          name: item.product_name || "Unknown",
          sold: toNumber(item.quantity),
          revenue: toNumber(item.total_amount),
        });
      }
    });

    const topProducts = Array.from(productMap.entries())
      .map(([id, product]) => ({ id, ...product }))
      .sort((a, b) => b.sold - a.sold)
      .slice(0, 5);

    const { data: recentOrdersRaw } = await db
      .from("pos_orders")
      .select(`
        id,
        order_number,
        total_amount,
        status,
        payment_status,
        ordered_at,
        cashier:hrd_employees(full_name)
      `)
      .order("ordered_at", { ascending: false })
      .limit(8);

    const recentOrders = (recentOrdersRaw ?? []).map((order) => ({
      id: order.order_number || order.id,
      cashier:
        (order.cashier as { full_name?: string } | null)?.full_name ||
        String(order.id).slice(0, 8),
      total: toNumber(order.total_amount),
      status: order.status || "pending",
      payment_status: order.payment_status || "unpaid",
      time: new Date(order.ordered_at).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    }));

    const totalArkUsed = completedOrders.reduce((sum, order) => sum + toNumber(order.ark_coins_used), 0);
    const arkPaymentOrders = completedOrders.filter(
      (order) => order.payment_method === "ark_coin" || toNumber(order.ark_coins_used) > 0
    ).length;

    const { data: arkEarnedRows } = await db
      .from("pos_orders")
      .select("ark_coins_earned")
      .eq("status", "completed")
      .gte("ordered_at", startIso)
      .lte("ordered_at", endIso);

    const totalArkEarned = (arkEarnedRows ?? []).reduce(
      (sum, order) => sum + toNumber(order.ark_coins_earned),
      0
    );

    const { data: xpRows } = await db
      .from("pos_xp_transactions")
      .select("xp_earned, created_at")
      .gte("created_at", startIso)
      .lte("created_at", endIso);

    const totalXpEarned = (xpRows ?? []).reduce((sum, row) => sum + toNumber(row.xp_earned), 0);

    const { count: membersWithXp } = await db
      .from("pos_customers")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .gt("total_xp", 0);

    const { data: arkBalanceRows } = await db
      .from("pos_customers")
      .select("ark_coin_balance")
      .eq("is_active", true);

    const totalArkBalance = (arkBalanceRows ?? []).reduce(
      (sum, customer) => sum + toNumber(customer.ark_coin_balance),
      0
    );

    const { data: loyalMembersRaw } = await db
      .from("pos_customers")
      .select("id, name, membership_tier, total_xp, ark_coin_balance")
      .eq("is_active", true)
      .or("total_xp.gt.0,ark_coin_balance.gt.0")
      .order("total_xp", { ascending: false })
      .limit(5);

    const topLoyalMembers = (loyalMembersRaw ?? []).map((member) => ({
      id: member.id,
      name: member.name || "Member",
      membershipTier: member.membership_tier || "regular",
      totalXp: toNumber(member.total_xp),
      arkBalance: toNumber(member.ark_coin_balance),
    }));

    const trendBuckets = new Map<
      string,
      { revenue: number; orders: number; arkUsed: number; xpEarned: number }
    >();

    const bucketKey = period === "today" ? hourKey : dateKey;

    completedOrders.forEach((order) => {
      const key = bucketKey(String(order.ordered_at));
      const bucket = trendBuckets.get(key) ?? { revenue: 0, orders: 0, arkUsed: 0, xpEarned: 0 };
      bucket.revenue += toNumber(order.total_amount);
      bucket.orders += 1;
      bucket.arkUsed += toNumber(order.ark_coins_used);
      trendBuckets.set(key, bucket);
    });

    (xpRows ?? []).forEach((row) => {
      const key = bucketKey(String(row.created_at));
      const bucket = trendBuckets.get(key) ?? { revenue: 0, orders: 0, arkUsed: 0, xpEarned: 0 };
      bucket.xpEarned += toNumber(row.xp_earned);
      trendBuckets.set(key, bucket);
    });

    const trend =
      period === "today"
        ? fillHourlyTrend(trendBuckets)
        : fillDailyTrend(startDate, endDate, trendBuckets);

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          todayRevenue,
          todayOrders,
          averageOrderValue: Math.round(averageOrderValue),
          activeCashiers,
          revenueChange: Math.round(revenueChange * 10) / 10,
          ordersChange: Math.round(ordersChange * 10) / 10,
        },
        topProducts,
        recentOrders,
        arkXp: {
          totalArkUsed,
          totalArkEarned,
          totalXpEarned,
          arkPaymentOrders,
          membersWithXp: membersWithXp ?? 0,
          totalArkBalance,
        },
        trend,
        topLoyalMembers,
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching dashboard stats:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch dashboard stats";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
