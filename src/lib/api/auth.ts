import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@/types";
import { z } from "zod";
import { resolveRoleIds } from "@/lib/iam/get-user-menus";
import { hasAnyIamMenuPrefix, loadGrantedMenuCodes } from "@/lib/iam/has-menu";

export interface ApiUser {
  id: string;
  full_name: string;
  role: UserRole;
  brand_id: string | null;
}

/**
 * Get authenticated user from JWT session
 * Used in API route handlers (not pages)
 */
export async function getApiUser(): Promise<ApiUser | null> {
  const db = await createServerPgClient();
  const { data: { user } } = await db.auth.getUser();
  
  if (!user) return null;

  const { data: profile } = await db
    .from("users")
    .select("full_name, role, brand_id")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  return {
    id: user.id,
    full_name: profile.full_name,
    role: profile.role as UserRole,
    brand_id: profile.brand_id,
  };
}

/**
 * Lightweight session check for POS routes.
 * Only verifies JWT is valid — does not require a users table record.
 */
export async function getPosSession(): Promise<string | null> {
  const db = await createServerPgClient();
  const { data: { user } } = await db.auth.getUser();
  return user?.id ?? null;
}

/**
 * Require authenticated user, returns 401 if not authenticated
 */
export async function requireApiUser(): Promise<ApiUser> {
  const user = await getApiUser();
  if (!user) {
    throw ApiError.unauthorized("Authentication required");
  }
  return user;
}

/**
 * Require specific roles, returns 403 if not authorized
 */
export async function requireApiRole(roles: UserRole[]): Promise<ApiUser> {
  const user = await requireApiUser();
  if (!roles.includes(user.role)) {
    throw ApiError.forbidden("Insufficient permissions");
  }
  return user;
}

/**
 * Gate API pakai grant IAM, bukan daftar role di kode.
 * Prefix `items.product` loloskan `items.product.master.products`, dst.
 */
export async function requireIamMenuPrefix(prefixes: string[]): Promise<ApiUser> {
  const user = await requireApiUser();
  const roleIds = await resolveRoleIds(user.id, user.role);
  const granted = await loadGrantedMenuCodes(roleIds);
  if (!hasAnyIamMenuPrefix(granted, prefixes)) {
    throw ApiError.forbidden("Insufficient permissions");
  }
  return user;
}

/**
 * Standardized API error class
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = "Authentication required") {
    return new ApiError(401, message);
  }

  static forbidden(message = "Insufficient permissions") {
    return new ApiError(403, message);
  }

  static notFound(message = "Resource not found") {
    return new ApiError(404, message);
  }

  static conflict(message: string) {
    return new ApiError(409, message);
  }

  static server(message = "Internal server error") {
    return new ApiError(500, message);
  }

  toResponse() {
    return NextResponse.json(
      {
        success: false,
        error: this.message,
        ...(this.details != null ? { details: this.details as Record<string, unknown> } : {}),
      },
      { status: this.status }
    );
  }
}

/**
 * Validate request body with Zod schema
 */
export async function validateBody<T extends z.ZodSchema>(
  request: NextRequest,
  schema: T
): Promise<z.infer<T>> {
  try {
    const body = await request.json();
    return schema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw ApiError.badRequest("Validation failed", error.issues);
    }
    throw error;
  }
}

/**
 * Parse and validate query params
 */
export function parseQueryParams(
  request: NextRequest,
  schema: z.ZodSchema
): Record<string, unknown> {
  const params: Record<string, string | null> = {};
  const url = new URL(request.url);

  for (const [key, value] of url.searchParams.entries()) {
    params[key] = value;
  }

  const parsed = schema.parse(params) as Record<string, unknown>;
  return parsed;
}

/**
 * Standard paginated response
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages?: number;
}

export function paginatedResponse<T>(
  data: T[],
  meta: PaginationMeta,
  message?: string
) {
  return NextResponse.json({
    success: true,
    data,
    ...(message && { message }),
    pagination: meta,
  });
}

export function successResponse<T>(data: T, message?: string) {
  return NextResponse.json({
    success: true,
    data,
    ...(message && { message }),
  });
}

export function createdResponse<T>(data: T, message = "Created successfully") {
  return NextResponse.json(
    {
      success: true,
      data,
      message,
    },
    { status: 201 }
  );
}

export function noContentResponse() {
  return new NextResponse(null, { status: 204 });
}
