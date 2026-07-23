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

const vendorCategoryEnum = z.enum([
  "it",
  "office",
  "stationery",
  "services",
  "raw_material",
  "other",
]);

const updateVendorSchema = z.object({
  name: z.string().min(1).optional(),
  contact_person: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  email: z.string().email().optional(),
  address: z.string().min(1).optional(),
  category: vendorCategoryEnum.optional(),
  npwp: z.string().optional(),
  bank_name: z.string().optional(),
  bank_account: z.string().optional(),
  bank_account_name: z.string().optional(),
  notes: z.string().optional(),
  is_active: z.boolean().optional(),
});

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

    const { data: vendor, error } = await db.from("vendors").select("*").eq("id", id).single();

    if (error || !vendor) {
      throw ApiError.notFound("Vendor not found");
    }

    if (!isRowInBusinessScope(vendor, scope)) {
      throw ApiError.notFound("Vendor not found");
    }

    return successResponse(vendor);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching vendor:", error);
    return ApiError.server("Failed to load vendor").toResponse();
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
    const body = await request.json();
    const validated = updateVendorSchema.parse(body);

    const db = await createServerPgClient();
    const scope = await getApiUserScope();

    const { data: existing, error: existingError } = await db
      .from("vendors")
      .select("*")
      .eq("id", id)
      .single();

    if (existingError || !existing) {
      throw ApiError.notFound("Vendor not found");
    }

    if (!isRowInBusinessScope(existing, scope)) {
      throw ApiError.notFound("Vendor not found");
    }

    const { data, error } = await db
      .from("vendors")
      .update(validated)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return successResponse(data, "Vendor updated successfully");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validation failed", error.issues).toResponse();
    }
    console.error("Error updating vendor:", error);
    return ApiError.server("Failed to update vendor").toResponse();
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
      "purchasing_manager",
      "super_admin",
    ]);

    const { id } = await params;
    const db = await createServerPgClient();
    const scope = await getApiUserScope();

    const { data: existing, error: existingError } = await db
      .from("vendors")
      .select("*")
      .eq("id", id)
      .single();

    if (existingError || !existing) {
      throw ApiError.notFound("Vendor not found");
    }

    if (!isRowInBusinessScope(existing, scope)) {
      throw ApiError.notFound("Vendor not found");
    }

    const { error } = await db.from("vendors").update({ is_active: false }).eq("id", id);

    if (error) throw error;

    return noContentResponse();
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error deactivating vendor:", error);
    return ApiError.server("Failed to deactivate vendor").toResponse();
  }
}
