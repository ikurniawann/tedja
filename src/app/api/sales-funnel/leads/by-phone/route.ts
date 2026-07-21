import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  isValidNormalizedPhone,
  normalizePhone,
  requireCompanyScope,
  requireSalesFunnelRole,
} from "@/lib/sales-funnel/server";

/**
 * Lookup PIC by no. WA (masukan owner 2026-07-22): satu PIC bisa membawa
 * banyak leads — form pakai ini untuk prefill data PIC yang sudah ada dan
 * menampilkan instansi apa saja yang ia bawa. Visibilitas mengikuti aturan
 * list leads (scope venue + sales own-or-unassigned).
 */
export async function GET(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  // Anti-scan nomor (pola /customers): data kontak PIC jangan bisa dipanen
  const rate = checkRateLimit(`sales-funnel-pic-lookup:${user.id}`, 30);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak pencarian — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const scope = await getApiUserScope();
    const scopeError = requireCompanyScope(user, scope);
    if (scopeError) return scopeError;

    const raw = new URL(request.url).searchParams.get("phone")?.trim() ?? "";
    const phone = normalizePhone(raw);
    if (!isValidNormalizedPhone(phone)) return successResponse(null);

    const conditions = ["l.deleted_at IS NULL", "l.pic_phone = $1"];
    const params: unknown[] = [phone];
    if (scope?.companyId) {
      params.push(scope.companyId);
      conditions.push(`l.company_id = $${params.length}`);
    }
    if (scope?.businessScope === "branch" && scope.branchId) {
      params.push(scope.branchId);
      conditions.push(`l.branch_id = $${params.length}`);
    }
    if (user.role === "sales") {
      params.push(user.id);
      conditions.push(
        `(l.owner_user_id = $${params.length} OR l.owner_user_id IS NULL)`
      );
    }

    const rows = await query<{
      id: string;
      org_name: string;
      status: string;
      pic_name: string;
      pic_title: string | null;
      pic_email: string | null;
    }>(
      `SELECT l.id, l.org_name, l.status, l.pic_name, l.pic_title, l.pic_email
       FROM crm.crm_sales_leads l
       WHERE ${conditions.join(" AND ")}
       ORDER BY l.updated_at DESC
       LIMIT 10`,
      params
    );
    if (rows.length === 0) return successResponse(null);

    return successResponse({
      pic: {
        name: rows[0].pic_name,
        title: rows[0].pic_title,
        email: rows[0].pic_email,
      },
      leads: rows.map((row) => ({
        id: row.id,
        org_name: row.org_name,
        status: row.status,
      })),
    });
  } catch (err) {
    console.error("[sales-funnel] lookup pic by phone error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mencari PIC" },
      { status: 500 }
    );
  }
}
