import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import {
  getApiUserScope,
  resolveWarehouseBranchFilter,
  resolveWarehouseCompanyFilter,
} from "@/lib/api/scope";
import { z } from "zod";

const querySchema = z.object({
  branch_id: z.string().uuid("Branch ID harus valid").optional(),
  is_active: z.coerce.boolean().optional().default(true),
});

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix([
      "items.product",
      "items.raw-material",
      "pos.catalog",
      "settings.users",
    ]);

    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const { searchParams } = new URL(request.url);
    const params = querySchema.parse(Object.fromEntries(searchParams));

    const branchFilter = resolveWarehouseBranchFilter(scope, params.branch_id);
    const companyFilter = resolveWarehouseCompanyFilter(scope);

    let query = db
      .from("warehouses", "configuration")
      .select("*")
      .eq("is_active", params.is_active);

    if (branchFilter) {
      query = query.eq("branch_id", branchFilter);
    } else if (companyFilter) {
      // User bercope company: hanya gudang milik cabang company-nya.
      const { data: branches, error: branchError } = await db
        .from("branches", "configuration")
        .select("id")
        .eq("company_id", companyFilter);
      if (branchError) throw branchError;
      const branchIds = (branches ?? []).map((b: { id: string }) => b.id);
      if (branchIds.length === 0) {
        return Response.json({ success: true, data: [] });
      }
      query = query.in("branch_id", branchIds);
    }

    const { data, error } = await query.order("name", { ascending: true });

    if (error) throw error;

    return Response.json({ success: true, data: data ?? [] });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Parameter tidak valid", error.issues).toResponse();
    }
    console.error("Error fetching warehouses:", error);
    return ApiError.server("Gagal memuat data stall").toResponse();
  }
}
