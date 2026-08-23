import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";

type Period = "today" | "week" | "month";

/** Order dibatalkan/di-void/di-merge: uangnya tidak dihitung sebagai revenue. */
const VOIDED_STATUSES = new Set(["cancelled", "voided", "merged"]);
const VOIDED_STATUSES_SQL = '("cancelled","voided","merged")';

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
      .select(
        "id, total_amount, cashier_id, ordered_at, ark_coins_used, payment_method, status, payment_status"
      )
      .gte("ordered_at", startIso)
      .lte("ordered_at", endIso);

    // Revenue = order yang DIBAYAR. Status order sengaja tidak dipakai:
    // kasir membuat order paid dengan status 'pending', dan status baru jadi
    // 'completed' setelah semua item F&B di-serve lewat KDS — venue yang tidak
    // disiplin KDS membuat dashboard nol padahal uang sudah masuk.
    const paidOrders = (periodOrders ?? []).filter(
      (order) =>
        order.payment_status === "paid" && !VOIDED_STATUSES.has(String(order.status))
    );
    const todayRevenue = paidOrders.reduce((sum, order) => sum + toNumber(order.total_amount), 0);
    const todayOrders = paidOrders.length;
    const averageOrderValue = todayOrders > 0 ? todayRevenue / todayOrders : 0;
    const activeCashiers = new Set(
      (periodOrders ?? []).map((order) => order.cashier_id).filter(Boolean)
    ).size;

    const { data: prevRevenueData } = await db
      .from("pos_orders")
      .select("total_amount")
      .eq("payment_status", "paid")
      .not("status", "in", VOIDED_STATUSES_SQL)
      .gte("ordered_at", prevStart.toISOString())
      .lte("ordered_at", prevEnd.toISOString());

    const prevRevenue = (prevRevenueData ?? []).reduce((sum, order) => sum + toNumber(order.total_amount), 0);
    const revenueChange = prevRevenue > 0 ? ((todayRevenue - prevRevenue) / prevRevenue) * 100 : 0;

    const { count: prevOrders } = await db
      .from("pos_orders")
      .select("*", { count: "exact", head: true })
      .eq("payment_status", "paid")
      .not("status", "in", VOIDED_STATUSES_SQL)
      .gte("ordered_at", prevStart.toISOString())
      .lte("ordered_at", prevEnd.toISOString());

    const prevOrdersCount = prevOrders || 0;
    const ordersChange = prevOrdersCount > 0 ? ((todayOrders - prevOrdersCount) / prevOrdersCount) * 100 : 0;

    const { data: topProductsRaw } = await db
      .from("pos_order_items")
      .select("order_id, product_id, product_name, quantity, total_amount")
      .gte("created_at", startIso)
      .lte("created_at", endIso);

    // Hanya item milik order yang dibayar — tanpa ini, order unpaid/void ikut
    // mendongkrak produk terlaris.
    const paidOrderIds = new Set(paidOrders.map((order) => String(order.id)));
    const paidItems = (topProductsRaw ?? []).filter((item) =>
      paidOrderIds.has(String(item.order_id))
    );

    const productMap = new Map<string, { name: string; sold: number; revenue: number }>();
    paidItems.forEach((item) => {
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

    // Recent Orders dulu SELALU kosong: embed `cashier:hrd_employees(...)`
    // memakai alias yang tidak terdaftar di schema-map shim, query gagal
    // diam-diam (bug sekeluarga dengan "Kasir: —" di order detail). Nama
    // kasir kini diresolve terpisah dari hris.employees per cashier_id.
    const { data: recentOrdersRaw, error: recentErr } = await db
      .from("pos_orders")
      .select("id, order_number, total_amount, status, payment_status, ordered_at, cashier_id")
      .order("ordered_at", { ascending: false })
      .limit(8);
    if (recentErr) console.error("[pos] dashboard recent orders:", recentErr.message);

    const cashierIds = [
      ...new Set(
        (recentOrdersRaw ?? [])
          .map((order: { cashier_id?: string | null }) => order.cashier_id)
          .filter(Boolean)
      ),
    ] as string[];
    const cashierNameById = new Map<string, string>();
    if (cashierIds.length > 0) {
      const { data: cashierRows } = await db
        .from("employees")
        .select("id, full_name")
        .in("id", cashierIds);
      for (const row of (cashierRows ?? []) as Array<{ id: string; full_name?: string | null }>) {
        if (row.full_name) cashierNameById.set(String(row.id), row.full_name);
      }
    }

    const recentOrders = (recentOrdersRaw ?? []).map(
      (order: {
        id: string;
        order_number?: string | null;
        total_amount?: number | string | null;
        status?: string | null;
        payment_status?: string | null;
        ordered_at: string;
        cashier_id?: string | null;
      }) => ({
        id: order.order_number || order.id,
        cashier:
          cashierNameById.get(String(order.cashier_id || "")) ||
          String(order.id).slice(0, 8),
        total: toNumber(order.total_amount),
        status: order.status || "pending",
        payment_status: order.payment_status || "unpaid",
        // WIB eksplisit — tanpa timeZone, jam ikut TZ server production (UTC)
        // dan Recent Orders tampil 7 jam lebih awal dari kenyataan.
        time: new Date(order.ordered_at).toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Jakarta",
        }),
      })
    );

    const totalArkUsed = paidOrders.reduce((sum, order) => sum + toNumber(order.ark_coins_used), 0);
    const arkPaymentOrders = paidOrders.filter(
      (order) => order.payment_method === "ark_coin" || toNumber(order.ark_coins_used) > 0
    ).length;

    // "ARK Masuk": koin yang MASUK ke wallet member pada periode ini —
    // top-up + bonus. Kolom pos_orders.ark_coins_earned tidak pernah ditulis
    // siapa pun (fitur cashback per order tidak ada), jadi metrik lama abadi 0.
    const { data: arkCreditRows } = await db
      .from("pos_wallet_transactions")
      .select("amount, type, created_at")
      .in("type", ["topup", "topup_bonus", "bonus"])
      .gte("created_at", startIso)
      .lte("created_at", endIso);

    const totalArkEarned = (arkCreditRows ?? []).reduce(
      (sum: number, row: { amount?: number | string | null }) =>
        sum + Math.abs(toNumber(row.amount)),
      0
    );

    // XP dicatat di crm_xp_ledger (loyalty engine) — pos_xp_transactions hanya
    // data lama (bug yang sama dengan detail order portal member): keduanya
    // dijumlah karena berasal dari era berbeda, tidak dobel hitung.
    const { data: xpLedgerRows } = await db
      .from("crm_xp_ledger")
      .select("xp_delta, created_at")
      .eq("source_channel", "pos")
      .eq("direction", "earn")
      .gte("created_at", startIso)
      .lte("created_at", endIso);

    const { data: xpLegacyRows } = await db
      .from("pos_xp_transactions")
      .select("xp_earned, created_at")
      .gte("created_at", startIso)
      .lte("created_at", endIso);

    const xpRows = [
      ...(xpLedgerRows ?? []).map((row) => ({
        xp_earned: toNumber((row as { xp_delta?: unknown }).xp_delta),
        created_at: String((row as { created_at?: unknown }).created_at),
      })),
      ...(xpLegacyRows ?? []).map((row) => ({
        xp_earned: toNumber((row as { xp_earned?: unknown }).xp_earned),
        created_at: String((row as { created_at?: unknown }).created_at),
      })),
    ];

    const totalXpEarned = xpRows.reduce((sum, row) => sum + toNumber(row.xp_earned), 0);

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

    paidOrders.forEach((order) => {
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
