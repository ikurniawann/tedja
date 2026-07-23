import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  requireCompanyScope,
  requireSalesFunnelRole,
} from "@/lib/sales-funnel/server";

/**
 * Pencarian bahan baku untuk editor resep (Fase F3) — bidang minimal.
 * raw_materials BER-tenant (company_id/branch_id) — wajib difilter scope,
 * beda dari pos_products yang memang global (temuan HIGH security gate F3).
 */
export async function GET(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  const rate = checkRateLimit(`sales-funnel-raw-materials:${user.id}`, 60);
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

    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return successResponse([]);

    const conditions = [
      "rm.is_active = true",
      "rm.deleted_at IS NULL",
      "(rm.nama ILIKE $1 OR rm.kode ILIKE $1)",
    ];
    const params: unknown[] = [`%${q}%`];
    if (scope?.companyId) {
      params.push(scope.companyId);
      conditions.push(`(rm.company_id IS NULL OR rm.company_id = $${params.length})`);
    }
    if (scope?.businessScope === "branch" && scope.branchId) {
      params.push(scope.branchId);
      conditions.push(`(rm.branch_id IS NULL OR rm.branch_id = $${params.length})`);
    }

    const rows = await query(
      `SELECT rm.id, rm.kode, rm.nama, u.nama AS satuan_kecil
       FROM item.raw_materials rm
       LEFT JOIN item.units u ON u.id = rm.satuan_kecil_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY rm.nama ASC
       LIMIT 20`,
      params
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[sales-funnel] search raw materials error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mencari bahan baku" },
      { status: 500 }
    );
  }
}
