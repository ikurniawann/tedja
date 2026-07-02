import { NextRequest } from "next/server";
import { z } from "zod";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import {
  buildOpnameScopeFilter,
  ensureProductInventoryId,
  fetchProductStockOpnameDetail,
  listProductInventoryForOpname,
  resolveOpnameScopeIds,
} from "@/lib/inventory/product-stock-opname";

const OPNAME_ROLES = ["super_admin", "warehouse_admin", "purchasing_admin"] as const;

const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.string().optional(),
  search: z.string().optional(),
  reason: z.enum(["stock_opname", "manual_adjustment"]).optional(),
});

const createSchema = z.object({
  opname_date: z.string().optional(),
  notes: z.string().optional(),
  reason: z.enum(["stock_opname", "manual_adjustment"]).default("stock_opname"),
});

export async function GET(request: NextRequest) {
  try {
    await requireApiRole([...OPNAME_ROLES]);
    const scope = await getApiUserScope();
    const params = listSchema.parse(
      Object.fromEntries(new URL(request.url).searchParams)
    );
    const offset = (params.page - 1) * params.limit;

    const conditions: string[] = ["1=1"];
    const values: unknown[] = [];
    let idx = 1;

    if (params.status && params.status !== "all") {
      conditions.push(`pso.status = $${idx++}`);
      values.push(params.status);
    }
    if (params.reason) {
      conditions.push(`pso.reason = $${idx++}`);
      values.push(params.reason);
    }
    if (params.search) {
      conditions.push(
        `(pso.opname_number ILIKE $${idx} OR pso.notes ILIKE $${idx})`
      );
      values.push(`%${params.search}%`);
      idx++;
    }

    const scopeFilter = buildOpnameScopeFilter(scope, "pso", idx);
    if (scopeFilter.sql !== "1=1") {
      conditions.push(scopeFilter.sql);
      values.push(...scopeFilter.values);
      idx = scopeFilter.nextIdx;
    }

    const where = conditions.join(" AND ");

    const countRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM inventory.product_stock_opnames pso
       WHERE ${where}`,
      values
    );
    const total = Number(countRow?.total || 0);

    const rows = await query<{
      id: string;
      opname_number: string;
      company_id: string | null;
      branch_id: string | null;
      opname_date: string;
      status: string;
      reason: string;
      notes: string | null;
      total_lines: number;
      lines_counted: number;
      lines_with_variance: number;
      completed_at: string | null;
      created_at: string;
      updated_at: string;
      branch_name: string | null;
      branch_code: string | null;
    }>(
      `SELECT pso.*,
              b.name AS branch_name,
              b.code AS branch_code
       FROM inventory.product_stock_opnames pso
       LEFT JOIN configuration.branches b ON b.id = pso.branch_id
       WHERE ${where}
       ORDER BY pso.opname_date DESC, pso.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, params.limit, offset]
    );

    const data = rows.map((row) => ({
      id: row.id,
      opname_number: row.opname_number,
      company_id: row.company_id,
      branch_id: row.branch_id,
      opname_date: row.opname_date,
      status: row.status,
      reason: row.reason,
      notes: row.notes,
      total_lines: row.total_lines,
      lines_counted: row.lines_counted,
      lines_with_variance: row.lines_with_variance,
      completed_at: row.completed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      branch: row.branch_id
        ? {
            id: row.branch_id,
            name: row.branch_name || "—",
            code: row.branch_code || "",
          }
        : null,
      lines: [],
    }));

    return Response.json({
      success: true,
      data,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / params.limit)),
      },
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("GET product-stock-opnames:", error);
    if (error instanceof z.ZodError) {
      return Response.json(
        { success: false, message: "Validasi gagal", errors: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    return Response.json(
      { success: false, message: "Gagal mengambil data stock opname produk" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiRole([...OPNAME_ROLES]);
    const scope = await getApiUserScope();
    const body = await request.json();
    const validated = createSchema.parse(body);

    const rows = await listProductInventoryForOpname(scope);
    if (rows.length === 0) {
      return Response.json(
        { success: false, message: "Tidak ada produk aktif dalam scope ini" },
        { status: 400 }
      );
    }

    const { companyId, branchId } = resolveOpnameScopeIds(scope);
    const db = await createServerPgClient();

    const { data: header, error: headerError } = await db
      .from("product_stock_opnames")
      .insert({
        company_id: companyId,
        branch_id: branchId,
        opname_date: validated.opname_date || new Date().toISOString().slice(0, 10),
        status: "draft",
        reason: validated.reason,
        notes: validated.notes || null,
        total_lines: rows.length,
        lines_counted: 0,
        lines_with_variance: 0,
        created_by: user.id,
        updated_by: user.id,
      })
      .select()
      .single();

    if (headerError || !header) throw headerError;

    const linePayload = [];
    for (const row of rows) {
      const inventoryId =
        row.inventory_id ??
        (await ensureProductInventoryId(db, {
          productId: row.product_id,
          unitCost: row.unit_cost,
          userId: user.id,
        }));

      linePayload.push({
        product_stock_opname_id: header.id,
        inventory_id: inventoryId,
        product_id: row.product_id,
        qty_system: row.qty_system,
        qty_counted: null,
        qty_variance: null,
        unit_cost: row.unit_cost,
      });
    }

    const { error: linesError } = await db
      .from("product_stock_opname_lines")
      .insert(linePayload);

    if (linesError) {
      await db.from("product_stock_opnames").delete().eq("id", header.id);
      throw linesError;
    }

    const detail = await fetchProductStockOpnameDetail(header.id);
    return Response.json({
      success: true,
      data: detail,
      message: "Sesi stock opname produk berhasil dibuat",
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("POST product-stock-opnames:", error);
    if (error instanceof z.ZodError) {
      return Response.json(
        { success: false, message: "Validasi gagal", errors: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    return Response.json(
      { success: false, message: "Gagal membuat stock opname produk" },
      { status: 500 }
    );
  }
}
