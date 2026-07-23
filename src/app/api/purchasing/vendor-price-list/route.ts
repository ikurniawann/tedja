import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  requireApiRole,
  ApiError,
  createdResponse,
} from "@/lib/api/auth";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
  effectiveCompanyId,
  effectiveBranchId,
} from "@/lib/api/scope";

const priceListSchema = z.object({
  vendor_id: z.string().uuid("Vendor is required"),
  product_id: z.string().uuid("Product is required"),
  harga: z.number().min(0, "Price cannot be negative"),
  satuan_id: z.string().uuid().optional(),
  minimum_qty: z.number().min(0).default(1),
  lead_time_days: z.number().min(0).default(0),
  is_preferred: z.boolean().default(false),
  berlaku_dari: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date format must be YYYY-MM-DD")
    .optional(),
  berlaku_sampai: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date format must be YYYY-MM-DD")
    .optional(),
  catatan: z.string().optional(),
});

const queryParamsSchema = z.object({
  search: z.string().optional(),
  vendor_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  status: z.enum(["all", "active", "inactive"]).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
});

const LIST_SELECT = `
  *,
  vendor:vendors!vendor_id (
    id,
    code,
    name
  ),
  product:products!product_id (
    id,
    kode,
    nama,
    satuan_id
  ),
  unit:units!satuan_id (
    id,
    kode,
    nama
  )
`;

async function resolveProductUnit(
  db: Awaited<ReturnType<typeof createServerPgClient>>,
  productId: string,
  satuanId?: string
) {
  const { data: product, error } = await db
    .from("products")
    .select("id, satuan_id")
    .eq("id", productId)
    .is("deleted_at", null)
    .single();

  if (error || !product) {
    throw ApiError.badRequest("Product not found");
  }

  const resolvedUnitId = satuanId || product.satuan_id;
  if (!resolvedUnitId) {
    throw ApiError.badRequest("Product unit is not configured");
  }

  if (satuanId && product.satuan_id && satuanId !== product.satuan_id) {
    throw ApiError.badRequest("Unit must match the product base unit");
  }

  return resolvedUnitId as string;
}

export async function GET(request: NextRequest) {
  try {
    await requireApiRole([
      "admin",
      "purchasing_admin",
      "purchasing_staff",
      "purchasing_manager",
      "super_admin",
    ]);

    const url = new URL(request.url);
    const params = queryParamsSchema.parse(Object.fromEntries(url.searchParams));
    const { page, limit, search, vendor_id, product_id, status } = params;
    const offset = (page - 1) * limit;

    const db = await createServerPgClient();
    let query = db
      .from("vendor_price_lists")
      .select(LIST_SELECT, { count: "exact" })
      .order("is_preferred", { ascending: false })
      .order("created_at", { ascending: false });

    const scope = await getApiUserScope();
    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    if (status === "active") {
      query = query.eq("is_active", true);
    } else if (status === "inactive") {
      query = query.eq("is_active", false);
    }

    if (vendor_id) {
      query = query.eq("vendor_id", vendor_id);
    }
    if (product_id) {
      query = query.eq("product_id", product_id);
    }

    if (search) {
      const term = `%${search}%`;
      const [{ data: vendorMatches }, { data: productMatches }] = await Promise.all([
        db.from("vendors").select("id").or(`name.ilike.${term},code.ilike.${term}`),
        db
          .from("products")
          .select("id")
          .or(`nama.ilike.${term},kode.ilike.${term}`)
          .is("deleted_at", null),
      ]);

      const vendorIds = (vendorMatches ?? []).map((row) => row.id as string);
      const productIds = (productMatches ?? []).map((row) => row.id as string);

      if (vendorIds.length === 0 && productIds.length === 0) {
        return Response.json({
          data: [],
          pagination: { page, limit, total: 0, total_pages: 1 },
        });
      }

      const orFilters: string[] = [];
      if (vendorIds.length > 0) {
        orFilters.push(`vendor_id.in.(${vendorIds.join(",")})`);
      }
      if (productIds.length > 0) {
        orFilters.push(`product_id.in.(${productIds.join(",")})`);
      }
      query = query.or(orFilters.join(","));
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) throw error;

    const total = count ?? 0;
    return Response.json({
      data: data ?? [],
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Invalid query parameters", error.issues).toResponse();
    }
    console.error("Error fetching vendor price lists:", error);
    return ApiError.server("Failed to load price lists").toResponse();
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireApiRole([
      "admin",
      "purchasing_admin",
      "purchasing_staff",
      "purchasing_manager",
      "super_admin",
    ]);

    const db = await createServerPgClient();
    const body = await request.json();
    const validated = priceListSchema.parse(body);
    const scope = await getApiUserScope();
    const companyId = effectiveCompanyId(scope);
    const branchId = effectiveBranchId(scope);

    if (!validated.berlaku_dari) {
      validated.berlaku_dari = new Date().toISOString().split("T")[0];
    }

    const satuanId = await resolveProductUnit(db, validated.product_id, validated.satuan_id);

    const { data: vendor, error: vendorError } = await db
      .from("vendors")
      .select("id, is_active")
      .eq("id", validated.vendor_id)
      .single();

    if (vendorError || !vendor) {
      throw ApiError.badRequest("Vendor not found");
    }
    if (!vendor.is_active) {
      throw ApiError.badRequest("Vendor is inactive");
    }

    const { data, error } = await db
      .from("vendor_price_lists")
      .insert({
        vendor_id: validated.vendor_id,
        product_id: validated.product_id,
        harga: validated.harga,
        satuan_id: satuanId,
        minimum_qty: validated.minimum_qty,
        lead_time_days: validated.lead_time_days,
        is_preferred: validated.is_preferred,
        berlaku_dari: validated.berlaku_dari,
        berlaku_sampai: validated.berlaku_sampai ?? null,
        catatan: validated.catatan ?? null,
        company_id: companyId,
        branch_id: branchId,
        is_active: true,
      })
      .select(LIST_SELECT)
      .single();

    if (error) {
      if (error.code === "23505") {
        throw ApiError.badRequest("A price list for this vendor and product already exists");
      }
      throw error;
    }

    return createdResponse(data, "Price list created successfully");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validation failed", error.issues).toResponse();
    }
    console.error("Error creating vendor price list:", error);
    return ApiError.server("Failed to create price list").toResponse();
  }
}
