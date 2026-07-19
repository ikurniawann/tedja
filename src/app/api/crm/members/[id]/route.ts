import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPosSession } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import { apiErrorResponse, isMissingCrmSchema, toNumber, validationErrorResponse } from "@/lib/crm/server";

const POS_CUSTOMER_COLUMNS = "id, name, phone, email, membership_tier, ark_coin_balance, total_xp, total_spent, visit_count, is_active";

type CustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  membership_tier: string | null;
  ark_coin_balance: number | string | null;
  total_xp: number | string | null;
  total_spent: number | string | null;
  visit_count: number | string | null;
  is_active: boolean | null;
};

type TierRow = {
  id: string;
  code: string;
  name: string;
  rank: number;
  xp_multiplier?: number | string | null;
  discount_percent?: number | string | null;
  min_lifetime_xp?: number | string | null;
  min_total_spend?: number | string | null;
};

type MemberProfileRow = {
  id: string;
  customer_id: string;
  member_code: string;
  tier_id: string;
  lifetime_xp: number | string;
  loyalty_score: number | string;
  active_avatar_id: string | null;
  joined_at: string;
  last_activity_at: string | null;
  status: string;
  metadata: Record<string, unknown>;
  tier?: TierRow | null;
};

type LedgerRow = {
  id: string;
  direction: string;
  source_channel: string;
  source_type: string;
  source_id: string | null;
  xp_delta: number | string;
  balance_after: number | string;
  description: string | null;
  reference_table: string | null;
  reference_id: string | null;
  created_at: string;
};

const updateMemberSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(1).max(160).optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    email: z.string().trim().email().or(z.literal("")).nullable().optional(),
    is_active: z.boolean().optional(),
  }).optional(),
  member: z.object({
    tier_id: z.string().uuid().optional(),
    status: z.enum(["active", "inactive", "suspended", "merged"]).optional(),
  }).optional(),
});

function normalizeCustomer(customer: CustomerRow) {
  return {
    id: customer.id,
    name: customer.name ?? "",
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

function normalizeMember(profile: MemberProfileRow, customer: CustomerRow | null) {
  return {
    id: profile.id,
    customer_id: profile.customer_id,
    member_code: profile.member_code,
    tier: profile.tier ?? null,
    lifetime_xp: toNumber(profile.lifetime_xp),
    loyalty_score: toNumber(profile.loyalty_score),
    active_avatar_id: profile.active_avatar_id,
    joined_at: profile.joined_at,
    last_activity_at: profile.last_activity_at,
    status: profile.status,
    metadata: profile.metadata ?? {},
    customer: customer ? normalizeCustomer(customer) : null,
  };
}

function syntheticMemberFromCustomer(customer: CustomerRow) {
  const normalized = normalizeCustomer(customer);

  return {
    id: `pos-${normalized.id}`,
    customer_id: normalized.id,
    member_code: normalized.phone || normalized.id.slice(0, 8),
    tier: {
      code: normalized.membership_tier,
      name: normalized.membership_tier,
    },
    lifetime_xp: normalized.total_xp,
    loyalty_score: normalized.total_xp,
    active_avatar_id: null,
    joined_at: null,
    last_activity_at: null,
    status: normalized.is_active ? "active" : "inactive",
    metadata: {},
    customer: normalized,
  };
}

function normalizeLedger(row: LedgerRow) {
  return {
    ...row,
    xp_delta: toNumber(row.xp_delta),
    balance_after: toNumber(row.balance_after),
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const { id } = await params;
    const customerFallbackId = id.startsWith("pos-") ? id.replace("pos-", "") : id;

    if (!isUuid(id)) {
      return getSyntheticCustomerDetail(db, customerFallbackId);
    }

    const { data: profile, error: profileError } = await db
      .from("crm_member_profiles")
      .select("*, tier:crm_membership_tiers(id, code, name, rank, xp_multiplier, discount_percent, min_lifetime_xp, min_total_spend)")
      .or(`id.eq.${id},customer_id.eq.${id}`)
      .maybeSingle();

    if (profileError) {
      if (isMissingCrmSchema(profileError)) {
        return NextResponse.json(
          { success: false, error: "CRM schema belum aktif" },
          { status: 409 }
        );
      }
      throw profileError;
    }

    if (!profile) {
      return getSyntheticCustomerDetail(db, customerFallbackId);
    }

    const profileRow = profile as MemberProfileRow;
    const { data: customer } = await db
      .from("pos_customers")
      .select(POS_CUSTOMER_COLUMNS)
      .eq("id", profileRow.customer_id)
      .maybeSingle();

    const { data: ledgerRows, error: ledgerError } = await db
      .from("crm_xp_ledger")
      .select("id, direction, source_channel, source_type, source_id, xp_delta, balance_after, description, reference_table, reference_id, created_at")
      .eq("member_id", profileRow.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (ledgerError) throw ledgerError;

    const { data: orders } = await db
      .from("pos_orders")
      .select("id, order_number, total_amount, payment_status, status, ordered_at")
      .eq("customer_id", profileRow.customer_id)
      .order("ordered_at", { ascending: false })
      .limit(10);

    return NextResponse.json({
      success: true,
      data: {
        member: normalizeMember(profileRow, customer as CustomerRow | null),
        xpLedger: ((ledgerRows ?? []) as LedgerRow[]).map(normalizeLedger),
        recentOrders: orders ?? [],
      },
      meta: { schemaReady: true },
    });
  } catch (error) {
    console.error("Error fetching CRM member detail:", error);
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const payload = updateMemberSchema.parse(await request.json());
    const db = createPgClient();
    const { id } = await params;
    const customerFallbackId = id.startsWith("pos-") ? id.replace("pos-", "") : id;

    let profile: MemberProfileRow | null = null;
    if (isUuid(id)) {
      const { data: profileData, error: profileError } = await db
        .from("crm_member_profiles")
        .select("*, tier:crm_membership_tiers(id, code, name, rank, xp_multiplier, discount_percent, min_lifetime_xp, min_total_spend)")
        .or(`id.eq.${id},customer_id.eq.${id}`)
        .maybeSingle();

      if (profileError) {
        if (isMissingCrmSchema(profileError)) {
          return NextResponse.json(
            { success: false, error: "CRM schema belum aktif" },
            { status: 409 }
          );
        }
        throw profileError;
      }

      profile = (profileData as MemberProfileRow | null) ?? null;
    }

    const customerId = profile?.customer_id ?? customerFallbackId;
    if (payload.customer && Object.keys(payload.customer).length > 0) {
      const customerUpdate = {
        ...payload.customer,
        email: payload.customer.email === "" ? null : payload.customer.email,
      };

      const { error: customerUpdateError } = await db
        .from("pos_customers")
        .update(customerUpdate)
        .eq("id", customerId);

      if (customerUpdateError) throw customerUpdateError;
    }

    if (payload.member && profile) {
      const memberUpdate = {
        ...payload.member,
        last_activity_at: new Date().toISOString(),
      };

      const { error: memberUpdateError } = await db
        .from("crm_member_profiles")
        .update(memberUpdate)
        .eq("id", profile.id);

      if (memberUpdateError) throw memberUpdateError;
    }

    if (payload.member?.tier_id) {
      const { data: tier } = await db
        .from("crm_membership_tiers")
        .select("code")
        .eq("id", payload.member.tier_id)
        .maybeSingle();

      if ((tier as { code?: string } | null)?.code) {
        await db
          .from("pos_customers")
          .update({ membership_tier: (tier as { code: string }).code })
          .eq("id", customerId);
      }
    }

    const detailId = profile?.id ?? (id.startsWith("pos-") ? id : customerId);
    return getMemberDetail(db, detailId);
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;

    console.error("Error updating CRM member detail:", error);
    return apiErrorResponse(error);
  }
}

async function getMemberDetail(
  db: import("@/lib/pg/types").DbClient,
  id: string
) {
  const customerFallbackId = id.startsWith("pos-") ? id.replace("pos-", "") : id;

  if (!isUuid(id)) {
    return getSyntheticCustomerDetail(db, customerFallbackId);
  }

  const { data: profile, error: profileError } = await db
    .from("crm_member_profiles")
    .select("*, tier:crm_membership_tiers(id, code, name, rank, xp_multiplier, discount_percent, min_lifetime_xp, min_total_spend)")
    .or(`id.eq.${id},customer_id.eq.${id}`)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) return getSyntheticCustomerDetail(db, customerFallbackId);

  const profileRow = profile as MemberProfileRow;
  const { data: customer } = await db
    .from("pos_customers")
    .select(POS_CUSTOMER_COLUMNS)
    .eq("id", profileRow.customer_id)
    .maybeSingle();

  return NextResponse.json({
    success: true,
    data: {
      member: normalizeMember(profileRow, customer as CustomerRow | null),
    },
    meta: { schemaReady: true },
  });
}

async function getSyntheticCustomerDetail(
  db: import("@/lib/pg/types").DbClient,
  customerId: string
) {
  const { data: customer, error: customerError } = await db
    .from("pos_customers")
    .select(POS_CUSTOMER_COLUMNS)
    .eq("id", customerId)
    .maybeSingle();

  if (customerError) throw customerError;
  if (!customer) {
    return NextResponse.json({ success: false, error: "Member tidak ditemukan" }, { status: 404 });
  }

  const { data: orders } = await db
    .from("pos_orders")
    .select("id, order_number, total_amount, payment_status, status, ordered_at")
    .eq("customer_id", customerId)
    .order("ordered_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    success: true,
    data: {
      member: syntheticMemberFromCustomer(customer as CustomerRow),
      xpLedger: [],
      recentOrders: orders ?? [],
    },
    meta: { schemaReady: true },
  });
}
