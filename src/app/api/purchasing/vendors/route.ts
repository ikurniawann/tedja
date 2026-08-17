import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, createdResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
  effectiveCompanyId,
  effectiveBranchId,
} from "@/lib/api/scope";
import { generateVendorCode } from "@/lib/purchasing/utils";

const vendorCategoryEnum = z.enum([
  "it",
  "office",
  "stationery",
  "services",
  "raw_material",
  "other",
]);

const vendorUsageEnum = z.enum(["fnb", "operasional", "keduanya"]);

const vendorSchema = z.object({
  name: z.string().min(1, "Vendor name is required"),
  contact_person: z.string().min(1, "Contact person is required"),
  phone: z.string().min(1, "Phone number is required"),
  email: z.string().email("Invalid email address"),
  address: z.string().min(1, "Address is required"),
  category: vendorCategoryEnum,
  usage_scope: vendorUsageEnum.default("keduanya"),
  npwp: z.string().optional(),
  bank_name: z.string().optional(),
  bank_account: z.string().optional(),
  bank_account_name: z.string().optional(),
  notes: z.string().optional(),
});

const queryParamsSchema = z.object({
  search: z.string().optional(),
  category: vendorCategoryEnum.optional(),
  usage_scope: vendorUsageEnum.optional(),
  status: z.enum(["all", "active", "inactive"]).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
});

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.items);

    const url = new URL(request.url);
    const params = queryParamsSchema.parse(Object.fromEntries(url.searchParams));
    const { page, limit, search, category, usage_scope, status } = params;
    const offset = (page - 1) * limit;

    const db = await createServerPgClient();
    let query = db.from("vendors").select("*", { count: "exact" }).order("name");

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

    if (category) {
      query = query.eq("category", category);
    }

    // Filter peruntukan: modul yang meminta vendor "operasional"/"fnb" tetap
    // ikut menampilkan vendor "keduanya".
    if (usage_scope) {
      query =
        usage_scope === "keduanya"
          ? query.eq("usage_scope", "keduanya")
          : query.in("usage_scope", [usage_scope, "keduanya"]);
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%,contact_person.ilike.%${search}%`);
    }

    const { data: vendors, error, count } = await query.range(offset, offset + limit - 1);

    if (error) throw error;

    const total = count ?? 0;
    return NextResponse.json({
      data: vendors ?? [],
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
    console.error("Error fetching vendors:", error);
    return ApiError.server("Failed to load vendors").toResponse();
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.items);

    const db = await createServerPgClient();
    const body = await request.json();
    const validated = vendorSchema.parse(body);
    const scope = await getApiUserScope();
    const companyId = effectiveCompanyId(scope);
    const branchId = effectiveBranchId(scope);
    const code = await generateVendorCode(db);

    const { data: vendor, error } = await db
      .from("vendors")
      .insert({
        code,
        ...validated,
        company_id: companyId,
        branch_id: branchId,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    return createdResponse(vendor, "Vendor created successfully");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validation failed", error.issues).toResponse();
    }
    console.error("Error creating vendor:", error);
    return ApiError.server("Failed to create vendor").toResponse();
  }
}
