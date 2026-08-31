import { NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import { queryOne } from "@/lib/db";
import { apiErrorResponse, isMissingCrmSchema, toNumber } from "@/lib/crm/server";

const POS_CUSTOMER_COLUMNS = "id, name, phone, email, membership_tier, ark_coin_balance, total_xp, total_spent, visit_count, is_active";

type CustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email?: string | null;
  membership_tier: string | null;
  ark_coin_balance: number | string | null;
  total_xp: number | string | null;
  total_spent: number | string | null;
  visit_count: number | string | null;
  is_active: boolean | null;
};

type PosOrderArkRow = {
  customer_id: string | null;
  ark_coins_used: number | string | null;
};

function normalizeCustomer(customer: CustomerRow) {
  return {
    id: customer.id,
    name: customer.name ?? "Walk-in Customer",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    membership_tier: customer.membership_tier ?? "regular",
    ark_coin_balance: toNumber(customer.ark_coin_balance),
    total_xp: toNumber(customer.total_xp),
    total_spent: toNumber(customer.total_spent),
    visit_count: toNumber(customer.visit_count),
    is_active: customer.is_active !== false,
  };
}

async function countTable(db: import("@/lib/pg/types").DbClient, table: string) {
  const { count, error } = await db
    .from(table)
    .select("id", { count: "exact", head: true });

  if (error) {
    if (isMissingCrmSchema(error)) return { count: 0, ready: false };
    throw error;
  }

  return { count: count ?? 0, ready: true };
}

export async function GET() {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = createPgClient();

    const { count: totalCustomers, error: customerCountError } = await db
      .from("pos_customers")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);

    if (customerCountError) throw customerCountError;

    // Skema baru EPIC-011: breakdown tipe member + liabilitas ARK beredar.
    const memberSummary = await queryOne(
      `SELECT
         COUNT(*) FILTER (WHERE member_type = 'card') AS card_members,
         COUNT(*) FILTER (WHERE member_type = 'registered') AS registered_members,
         COALESCE(SUM(ark_coin_balance), 0) AS ark_outstanding
       FROM pos.pos_customers
       WHERE is_active`
    );

    const [
      memberCount,
      tierCount,
      xpRuleCount,
      rewardCount,
      avatarCount,
      redemptionCount,
      eventCount,
    ] = await Promise.all([
      countTable(db, "crm_member_profiles"),
      countTable(db, "crm_membership_tiers"),
      countTable(db, "crm_xp_rules"),
      countTable(db, "crm_rewards"),
      countTable(db, "crm_collectible_avatars"),
      countTable(db, "crm_redemptions"),
      countTable(db, "crm_external_events"),
    ]);

    const schemaReady = [
      memberCount,
      tierCount,
      xpRuleCount,
      rewardCount,
      avatarCount,
      redemptionCount,
      eventCount,
    ].every((item) => item.ready);

    const { data: loyalCustomers, error: loyalError } = await db
      .from("pos_customers")
      .select(POS_CUSTOMER_COLUMNS)
      .eq("is_active", true)
      .order("total_xp", { ascending: false })
      .limit(5);

    if (loyalError) throw loyalError;

    const { data: topTransactionCustomers, error: spenderError } = await db
      .from("pos_customers")
      .select(POS_CUSTOMER_COLUMNS)
      .eq("is_active", true)
      .order("total_spent", { ascending: false })
      .limit(5);

    if (spenderError) throw spenderError;

    const { data: arkOrders, error: arkOrderError } = await db
      .from("pos_orders")
      .select("customer_id, ark_coins_used")
      .not("customer_id", "is", null)
      .gt("ark_coins_used", 0)
      .limit(1000);

    const topArkMap = new Map<string, number>();
    if (!arkOrderError) {
      ((arkOrders ?? []) as PosOrderArkRow[]).forEach((order) => {
        if (!order.customer_id) return;
        topArkMap.set(order.customer_id, (topArkMap.get(order.customer_id) ?? 0) + toNumber(order.ark_coins_used));
      });
    }

    const topArkCustomerIds = Array.from(topArkMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([customerId]) => customerId);

    const topArkCustomersById = new Map<string, CustomerRow>();
    if (topArkCustomerIds.length > 0) {
      const { data: topArkCustomers } = await db
        .from("pos_customers")
        .select(POS_CUSTOMER_COLUMNS)
        .in("id", topArkCustomerIds);

      ((topArkCustomers ?? []) as CustomerRow[]).forEach((customer) => topArkCustomersById.set(customer.id, customer));
    }

    const { count: posMemberFallbackCount, error: posMemberFallbackError } = await db
      .from("pos_customers")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .gt("total_xp", 0);

    let recentXpActivity: unknown[] = [];
    if (schemaReady) {
      const { data: ledgerRows, error: ledgerError } = await db
        .from("crm_xp_ledger")
        .select("id, direction, source_channel, source_type, xp_delta, balance_after, description, created_at, reference_table, reference_id, metadata, member:crm_member_profiles(member_code, customer_id)")
        .order("created_at", { ascending: false })
        .limit(8);

      // Rapikan deskripsi lama yang menyimpan UUID internal (owner
      // 2026-08-31): tampilkan nomor order kasir / nominal topup, bukan
      // UUID. Baris baru sudah manusiawi sejak ditulis (loyalty-engine);
      // pemetaan ini menutup riwayat lama tanpa migrasi data.
      interface LedgerRow {
        description: string | null;
        reference_table: string | null;
        reference_id: string | null;
        metadata: { amount?: number | string } | null;
        [key: string]: unknown;
      }
      const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      const rows = (ledgerRows ?? []) as LedgerRow[];
      const orderIds = [
        ...new Set(
          rows
            .filter((r) => r.reference_table === "pos_orders" && r.reference_id)
            .map((r) => r.reference_id as string)
        ),
      ];
      const orderNumbers = new Map<string, string>();
      if (orderIds.length > 0) {
        const { data: orderRows } = await db
          .from("pos_orders")
          .select("id, order_number")
          .in("id", orderIds);
        for (const o of (orderRows ?? []) as { id: string; order_number: string | null }[]) {
          if (o.order_number) orderNumbers.set(o.id, o.order_number);
        }
      }
      if (!ledgerError) {
        recentXpActivity = rows.map((row) => {
          const desc = row.description ?? "";
          if (!uuidRe.test(desc)) return row;
          const prefix = desc.split(/ untuk /)[0] || desc.replace(uuidRe, "").trim();
          if (row.reference_table === "pos_orders" && row.reference_id) {
            const num = orderNumbers.get(row.reference_id);
            return { ...row, description: `${prefix} — order ${num ? `#${num}` : row.reference_id.slice(0, 8)}` };
          }
          const amount = Number(row.metadata?.amount);
          if (Number.isFinite(amount) && amount > 0) {
            return { ...row, description: `${prefix} — Rp ${Math.round(amount).toLocaleString("id-ID")}` };
          }
          return { ...row, description: desc.replace(uuidRe, desc.match(uuidRe)![0].slice(0, 8)) };
        });
      }
    }

    if (posMemberFallbackError) throw posMemberFallbackError;

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          totalCustomers: totalCustomers ?? 0,
          totalMembers: schemaReady ? memberCount.count : (posMemberFallbackCount ?? 0),
          cardMembers: toNumber(memberSummary?.card_members),
          registeredMembers: toNumber(memberSummary?.registered_members),
          arkOutstanding: toNumber(memberSummary?.ark_outstanding),
          tierCount: tierCount.count,
          xpRuleCount: xpRuleCount.count,
          rewardCount: rewardCount.count,
          avatarCount: avatarCount.count,
          redemptionCount: redemptionCount.count,
          externalEventCount: eventCount.count,
        },
        topLoyalMembers: ((loyalCustomers ?? []) as CustomerRow[]).map(normalizeCustomer),
        topTransactionSpenders: ((topTransactionCustomers ?? []) as CustomerRow[]).map(normalizeCustomer),
        topArkSpenders: topArkCustomerIds.map((customerId) => ({
          customer: topArkCustomersById.get(customerId) ? normalizeCustomer(topArkCustomersById.get(customerId)!) : null,
          ark_coins_used: topArkMap.get(customerId) ?? 0,
        })),
        recentXpActivity,
      },
      meta: {
        schemaReady,
      },
    });
  } catch (error) {
    console.error("Error fetching CRM dashboard:", error);
    return apiErrorResponse(error);
  }
}
