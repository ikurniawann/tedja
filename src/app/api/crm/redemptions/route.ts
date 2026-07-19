import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import { apiErrorResponse, isMissingCrmSchema } from "@/lib/crm/server";

// GET dipertahankan sebagai arsip riwayat redemption lama.
export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const memberId = request.nextUrl.searchParams.get("member_id");
    const customerId = request.nextUrl.searchParams.get("customer_id");
    const status = request.nextUrl.searchParams.get("status");

    let query = db
      .from("crm_redemptions")
      .select("*, reward:crm_rewards(id, code, name, reward_type, xp_cost), member:crm_member_profiles(id, member_code, customer_id)")
      .order("requested_at", { ascending: false })
      .limit(100);

    if (memberId) query = query.eq("member_id", memberId);
    if (customerId) query = query.eq("customer_id", customerId);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      if (isMissingCrmSchema(error)) {
        return NextResponse.json({ success: true, data: [], meta: { schemaReady: false } });
      }
      throw error;
    }

    return NextResponse.json({ success: true, data: data ?? [], meta: { schemaReady: true } });
  } catch (error) {
    console.error("Error fetching CRM redemptions:", error);
    return apiErrorResponse(error);
  }
}

// Alur redeem reward dengan potong XP PENSIUN (EPIC-011 Fase B): XP adalah
// skor seumur hidup dan tidak pernah berkurang. Penggantinya adalah privilege
// produk khusus ber-syarat min XP/tier di kasir (Fase C).
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: "Redeem reward sudah dipensiunkan — XP tidak dapat ditukar/dipotong (EPIC-011)",
    },
    { status: 410 }
  );
}
