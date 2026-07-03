import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  requireApiUser,
  ApiError,
  paginatedResponse,
} from "@/lib/api/auth";
import { effectiveBranchId, getApiUserScope } from "@/lib/api/scope";

// GET /api/purchasing/inventory/movements?bahan_id=xxx&date_from=xxx&date_to=xxx

const querySchema = z.object({
  bahan_id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  tipe: z.enum(["in", "out", "adjustment", "transfer", "return"]).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  reference_type: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireApiUser();
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const branchId = effectiveBranchId(scope);

    const { searchParams } = new URL(request.url);
    const params = querySchema.parse(Object.fromEntries(searchParams));
    const { bahan_id, page, limit, tipe, date_from, date_to, reference_type } =
      params;
    const offset = (page - 1) * limit;

    let query = db
      .from("inventory_movements")
      .select(
        `
        *,
        inventory:inventory_id(id),
        raw_material:raw_material_id(id, kode, nama),
        creator:created_by(full_name)
      `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (branchId) query = query.eq("branch_id", branchId);

    if (bahan_id) query = query.eq("raw_material_id", bahan_id);
    if (tipe) query = query.eq("tipe", tipe);
    if (reference_type) query = query.eq("reference_type", reference_type);
    if (date_from) query = query.gte("created_at", date_from);
    if (date_to) query = query.lte("created_at", date_to);

    const { data, error, count } = await query;

    if (error) throw error;

    return paginatedResponse(data || [], {
      page,
      limit,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Invalid query params", error.issues).toResponse();
    }
    console.error("Error fetching movements:", error);
    return ApiError.server("Failed to fetch inventory movements").toResponse();
  }
}
