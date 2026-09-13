import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createdResponse, noContentResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import { requireSalesFunnelRole, validateAssignableOwner } from "@/lib/sales-funnel/server";

/** EPIC-050 T-3.1 — deal team: banyak orang per deal (owner tetap di deals.owner_user_id). */
const addSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["owner", "support", "pre_sales", "account_manager", "finance"]).default("support"),
  split_percent: z.number().min(0).max(100).default(0),
});

async function guard(id: string, user: { id: string; role: import("@/types").UserRole }) {
  const { deal, forbidden } = await findAccessibleDeal(id, user);
  if (forbidden) return { deal: null, res: NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 }) };
  if (!deal) return { deal: null, res: NextResponse.json({ success: false, error: "Deal tidak ditemukan" }, { status: 404 }) };
  return { deal, res: null };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  const { id } = await params;
  const g = await guard(id, user);
  if (g.res) return g.res;
  const rows = await query(
    `SELECT m.id, m.user_id, m.role, m.split_percent, m.created_at, u.full_name, u.role AS user_role
     FROM crm.crm_deal_members m JOIN configuration.users u ON u.id = m.user_id
     WHERE m.deal_id = $1 ORDER BY m.created_at`,
    [id]
  );
  return successResponse(rows);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  const { id } = await params;
  const g = await guard(id, user);
  if (g.res || !g.deal) return g.res;
  const parsed = addSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const ownerError = await validateAssignableOwner(parsed.data.user_id, g.deal.company_id);
  if (ownerError) return NextResponse.json({ success: false, error: ownerError }, { status: 400 });
  const row = await queryOne(
    `INSERT INTO crm.crm_deal_members (deal_id, user_id, role, split_percent, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (deal_id, user_id) DO UPDATE SET role = EXCLUDED.role, split_percent = EXCLUDED.split_percent
     RETURNING id, user_id, role, split_percent`,
    [id, parsed.data.user_id, parsed.data.role, parsed.data.split_percent, user.id]
  );
  return createdResponse(row, "Anggota tim ditambahkan");
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  const { id } = await params;
  const g = await guard(id, user);
  if (g.res) return g.res;
  const memberId = new URL(request.url).searchParams.get("member_id");
  if (!memberId) return NextResponse.json({ success: false, error: "member_id wajib" }, { status: 400 });
  await query(`DELETE FROM crm.crm_deal_members WHERE id = $1 AND deal_id = $2`, [memberId, id]);
  return noContentResponse();
}
