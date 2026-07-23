import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  requireApiRole,
  ApiError,
  successResponse,
  noContentResponse,
} from "@/lib/api/auth";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
  isRowInBusinessScope,
} from "@/lib/api/scope";

const updatePriceListSchema = z.object({
  vendor_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  harga: z.number().min(0).optional(),
  satuan_id: z.string().uuid().optional(),
  minimum_qty: z.number().min(0).optional(),
  lead_time_days: z.number().min(0).optional(),
  is_preferred: z.boolean().optional(),
  berlaku_dari: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  berlaku_sampai: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  catatan: z.string().optional(),
  is_active: z.boolean().optional(),
});

const DETAIL_SELECT = `
  *,
  vendor:vendors!vendor_id (
    id,
    code,
    name,
    contact_person,
    phone,
    email
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiRole([
      "admin",
      "purchasing_admin",
      "purchasing_staff",
      "purchasing_manager",
      "super_admin",
    ]);

    const { id } = await params;
    const db = await createServerPgClient();
    const scope = await getApiUserScope();

    const { data, error } = await db
      .from("vendor_price_lists")
      .select(DETAIL_SELECT)
      .eq("id", id)
      .single();

    if (error || !data) {
      throw ApiError.notFound("Price list not found");
    }

    if (!isRowInBusinessScope(scope, data)) {
      throw ApiError.notFound("Price list not found");
    }

    return successResponse(data);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching vendor price list:", error);
    return ApiError.server("Failed to load price list").toResponse();
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiRole([
      "admin",
      "purchasing_admin",
      "purchasing_staff",
      "purchasing_manager",
      "super_admin",
    ]);

    const { id } = await params;
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const body = await request.json();
    const validated = updatePriceListSchema.parse(body);

    const { data: existing, error: existingError } = await db
      .from("vendor_price_lists")
      .select("*")
      .eq("id", id)
      .single();

    if (existingError || !existing) {
      throw ApiError.notFound("Price list not found");
    }

    if (!isRowInBusinessScope(scope, existing)) {
      throw ApiError.notFound("Price list not found");
    }

    const nextProductId = validated.product_id || existing.product_id;
    const updatePayload: Record<string, unknown> = {
      ...validated,
      updated_at: new Date().toISOString(),
    };

    if (validated.product_id || validated.satuan_id) {
      updatePayload.satuan_id = await resolveProductUnit(
        db,
        nextProductId,
        validated.satuan_id || existing.satuan_id
      );
    }

    const { data, error } = await db
      .from("vendor_price_lists")
      .update(updatePayload)
      .eq("id", id)
      .select(DETAIL_SELECT)
      .single();

    if (error) {
      if (error.code === "23505") {
        throw ApiError.badRequest("A price list for this vendor and product already exists");
      }
      throw error;
    }

    return successResponse(data, "Price list updated successfully");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validation failed", error.issues).toResponse();
    }
    console.error("Error updating vendor price list:", error);
    return ApiError.server("Failed to update price list").toResponse();
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiRole([
      "admin",
      "purchasing_admin",
      "purchasing_staff",
      "purchasing_manager",
      "super_admin",
    ]);

    const { id } = await params;
    const db = await createServerPgClient();
    const scope = await getApiUserScope();

    const { data: existing, error: existingError } = await db
      .from("vendor_price_lists")
      .select("*")
      .eq("id", id)
      .single();

    if (existingError || !existing) {
      throw ApiError.notFound("Price list not found");
    }

    if (!isRowInBusinessScope(scope, existing)) {
      throw ApiError.notFound("Price list not found");
    }

    const { error } = await db
      .from("vendor_price_lists")
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    return noContentResponse();
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error deleting vendor price list:", error);
    return ApiError.server("Failed to delete price list").toResponse();
  }
}
