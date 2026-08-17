import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
  effectiveCompanyId,
  effectiveBranchId,
} from "@/lib/api/scope";
import { MANUFACTURING_SCHEMA, PRODUCTION_API_ROLES } from "@/lib/manufacturing/constants";

const createProductProductionSchema = z.object({
  production_context: z.literal("product").optional().default("product"),
  product_id: z.string().uuid("Product is required"),
  output_type: z.enum(["FINISHED_GOOD", "WIP"]).default("FINISHED_GOOD"),
  planned_qty: z.number().positive("Planned quantity must be greater than 0"),
  overhead_cost: z.number().min(0).default(0),
  labor_cost: z.number().min(0).default(0),
  packaging_cost: z.number().min(0).default(0),
  waste_cost: z.number().min(0).default(0),
  catatan: z.string().optional().nullable(),
});

const createRawMaterialProductionSchema = z.object({
  production_context: z.literal("raw_material"),
  raw_material_id: z.string().uuid("Output raw material is required"),
  planned_qty: z.number().positive("Planned quantity must be greater than 0"),
  overhead_cost: z.number().min(0).default(0),
  labor_cost: z.number().min(0).default(0),
  packaging_cost: z.number().min(0).default(0),
  waste_cost: z.number().min(0).default(0),
  catatan: z.string().optional().nullable(),
});

const createProductionSchema = z.discriminatedUnion("production_context", [
  createRawMaterialProductionSchema,
  createProductProductionSchema.extend({
    production_context: z.literal("product").default("product"),
  }),
]);

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function generateProductionNumber(db: import("@/lib/pg/types").DbClient) {
  const now = new Date();
  const prefix = `PROD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

  const { data, error } = await db
    .from("production_orders")
    .select("nomor_produksi")
    .ilike("nomor_produksi", `${prefix}-%`)
    .order("nomor_produksi", { ascending: false })
    .limit(1);

  if (error) throw error;

  const lastNumber = data?.[0]?.nomor_produksi?.split("-").pop();
  const nextNumber = Number.isFinite(Number(lastNumber)) ? Number(lastNumber) + 1 : 1;
  return `${prefix}-${String(nextNumber).padStart(4, "0")}`;
}

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.items);
    const db = createPgClient();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const productionContext = searchParams.get("production_context") || "all";
    const limit = Math.min(Number(searchParams.get("limit") || 25), 100);

    let query = db
      .from("v_production_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    const scope = await getApiUserScope();
    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    if (productionContext === "product" || productionContext === "raw_material") {
      query = query.eq("production_context", productionContext);
    }
    if (status) query = query.eq("status", status);
    if (search) {
      query = query.or(
        `nomor_produksi.ilike.%${search}%,product_nama.ilike.%${search}%,product_kode.ilike.%${search}%,output_raw_material_nama.ilike.%${search}%,output_raw_material_kode.ilike.%${search}%,item_nama.ilike.%${search}%`
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching production orders:", error);
    return NextResponse.json(
      { success: false, message: getErrorMessage(error, "Gagal mengambil data produksi") },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const db = createPgClient();
    const body = await request.json();
    const parsed = createProductionSchema.parse(
      body.production_context ? body : { ...body, production_context: "product" }
    );

    if (parsed.production_context === "raw_material") {
      return createRawMaterialProductionOrder(db, user.id, parsed);
    }

    return createProductProductionOrder(db, user.id, parsed);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, message: "Validation failed", errors: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    console.error("Error creating production order:", error);
    return NextResponse.json(
      { success: false, message: getErrorMessage(error, "Failed to create production order") },
      { status: 500 }
    );
  }
}

async function createProductProductionOrder(
  db: import("@/lib/pg/types").DbClient,
  userId: string,
  validated: z.infer<typeof createProductProductionSchema>
) {
    const { data: product, error: productError } = await db
      .from("products")
      .select("id, kode, nama, company_id, branch_id")
      .eq("id", validated.product_id)
      .eq("is_active", true)
      .single();

    if (productError || !product) {
      return NextResponse.json(
        { success: false, message: "Produk tidak ditemukan" },
        { status: 404 }
      );
    }

    const { data: bomItems, error: bomError } = await db
      .from("bom_items", MANUFACTURING_SCHEMA)
      .select("raw_material_id, satuan_id, qty_required, waste_factor")
      .eq("product_id", validated.product_id)
      .eq("is_active", true);

    if (bomError) throw bomError;
    if (!bomItems || bomItems.length === 0) {
      return NextResponse.json(
        { success: false, message: "Produk belum memiliki BOM. Lengkapi recipe/BOM dulu sebelum produksi." },
        { status: 400 }
      );
    }

    const materialIds = bomItems.map((item) => item.raw_material_id).filter(Boolean);
    const { data: stocks, error: stockError } = await db
      .from("v_raw_materials_stock")
      .select("id, avg_cost")
      .in("id", materialIds);

    if (stockError) throw stockError;

    const stockCostMap = new Map((stocks || []).map((stock) => [stock.id, toNumber(stock.avg_cost)]));
    const materials = bomItems.map((item) => {
      const qtyPlanned = toNumber(item.qty_required) * (1 + toNumber(item.waste_factor)) * validated.planned_qty;
      const unitCost = stockCostMap.get(item.raw_material_id) || 0;
      return {
        raw_material_id: item.raw_material_id,
        satuan_id: item.satuan_id,
        qty_planned: qtyPlanned,
        qty_actual: qtyPlanned,
        waste_qty: 0,
        unit_cost: unitCost,
        total_cost: qtyPlanned * unitCost,
      };
    });

    const plannedMaterialCost = materials.reduce((sum, item) => sum + item.total_cost, 0);
    const totalPlannedCost =
      plannedMaterialCost +
      validated.overhead_cost +
      validated.labor_cost +
      validated.packaging_cost +
      validated.waste_cost;
    const hppPerUnit = totalPlannedCost / validated.planned_qty;
    const nomorProduksi = await generateProductionNumber(db);

    const scope = await getApiUserScope();
    const companyId = (product as any).company_id ?? effectiveCompanyId(scope);
    const branchId = (product as any).branch_id ?? effectiveBranchId(scope);

    const { data: order, error: orderError } = await db
      .from("production_orders")
      .insert({
        nomor_produksi: nomorProduksi,
        product_id: validated.product_id,
        company_id: companyId,
        branch_id: branchId,
        output_type: validated.output_type,
        planned_qty: validated.planned_qty,
        actual_qty: 0,
        status: "DRAFT",
        planned_material_cost: plannedMaterialCost,
        overhead_cost: validated.overhead_cost,
        labor_cost: validated.labor_cost,
        packaging_cost: validated.packaging_cost,
        waste_cost: validated.waste_cost,
        hpp_per_unit: hppPerUnit,
        production_context: "product",
        catatan: validated.catatan || null,
        created_by: userId,
      })
      .select()
      .single();

    if (orderError) throw orderError;

    const { error: materialError } = await db
      .from("production_order_materials")
      .insert(materials.map((item) => ({ ...item, production_order_id: order.id })));

    if (materialError) throw materialError;

    return NextResponse.json(
      {
        success: true,
        data: { ...order, materials },
        message: `Production order ${nomorProduksi} created successfully`,
      },
      { status: 201 }
    );
}

async function createRawMaterialProductionOrder(
  db: import("@/lib/pg/types").DbClient,
  userId: string,
  validated: z.infer<typeof createRawMaterialProductionSchema>
) {
    const { data: outputMaterial, error: materialError } = await db
      .from("raw_materials")
      .select("id, kode, nama, company_id, branch_id")
      .eq("id", validated.raw_material_id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .single();

    if (materialError || !outputMaterial) {
      return NextResponse.json(
        { success: false, message: "Output raw material not found" },
        { status: 404 }
      );
    }

    const { data: bomItems, error: bomError } = await db
      .from("raw_material_bom_items", MANUFACTURING_SCHEMA)
      .select("component_raw_material_id, satuan_id, qty_required, waste_factor")
      .eq("output_raw_material_id", validated.raw_material_id)
      .eq("is_active", true);

    if (bomError) throw bomError;
    if (!bomItems || bomItems.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "This raw material does not have a bill of materials. Complete the recipe before production.",
        },
        { status: 400 }
      );
    }

    const materialIds = bomItems.map((item) => item.component_raw_material_id).filter(Boolean);
    const { data: stocks, error: stockError } = await db
      .from("v_raw_materials_stock")
      .select("id, avg_cost")
      .in("id", materialIds);

    if (stockError) throw stockError;

    const stockCostMap = new Map((stocks || []).map((stock) => [stock.id, toNumber(stock.avg_cost)]));
    const materials = bomItems.map((item) => {
      const qtyPlanned =
        toNumber(item.qty_required) * (1 + toNumber(item.waste_factor)) * validated.planned_qty;
      const unitCost = stockCostMap.get(item.component_raw_material_id) || 0;
      return {
        raw_material_id: item.component_raw_material_id,
        satuan_id: item.satuan_id,
        qty_planned: qtyPlanned,
        qty_actual: qtyPlanned,
        waste_qty: 0,
        unit_cost: unitCost,
        total_cost: qtyPlanned * unitCost,
      };
    });

    const plannedMaterialCost = materials.reduce((sum, item) => sum + item.total_cost, 0);
    const totalPlannedCost =
      plannedMaterialCost +
      validated.overhead_cost +
      validated.labor_cost +
      validated.packaging_cost +
      validated.waste_cost;
    const hppPerUnit = totalPlannedCost / validated.planned_qty;
    const nomorProduksi = await generateProductionNumber(db);

    const scope = await getApiUserScope();
    const companyId = (outputMaterial as { company_id?: string | null }).company_id ?? effectiveCompanyId(scope);
    const branchId = (outputMaterial as { branch_id?: string | null }).branch_id ?? effectiveBranchId(scope);

    const { data: order, error: orderError } = await db
      .from("production_orders")
      .insert({
        nomor_produksi: nomorProduksi,
        production_context: "raw_material",
        output_raw_material_id: validated.raw_material_id,
        product_id: null,
        company_id: companyId,
        branch_id: branchId,
        output_type: "FINISHED_GOOD",
        planned_qty: validated.planned_qty,
        actual_qty: 0,
        status: "DRAFT",
        planned_material_cost: plannedMaterialCost,
        overhead_cost: validated.overhead_cost,
        labor_cost: validated.labor_cost,
        packaging_cost: validated.packaging_cost,
        waste_cost: validated.waste_cost,
        hpp_per_unit: hppPerUnit,
        catatan: validated.catatan || null,
        created_by: userId,
      })
      .select()
      .single();

    if (orderError) throw orderError;

    const { error: materialInsertError } = await db
      .from("production_order_materials")
      .insert(materials.map((item) => ({ ...item, production_order_id: order.id })));

    if (materialInsertError) throw materialInsertError;

    return NextResponse.json(
      {
        success: true,
        data: { ...order, materials },
        message: `Production order ${nomorProduksi} created successfully`,
      },
      { status: 201 }
    );
}
