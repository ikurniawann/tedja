import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { MANUFACTURING_SCHEMA } from "@/lib/manufacturing/constants";
import { z } from "zod";

const bomSchema = z.object({
  component_raw_material_id: z.string().uuid("Component raw material is required"),
  qty_required: z.number().min(0.0001, "Quantity must be greater than 0").optional(),
  satuan_id: z.string().uuid().nullable().optional(),
  waste_factor: z.number().min(0).max(1).optional(),
  waste_persen: z.number().min(0).max(100).optional(),
}).transform((value) => ({
  component_raw_material_id: value.component_raw_material_id,
  qty_required: value.qty_required ?? 0,
  satuan_id: value.satuan_id || null,
  waste_factor: value.waste_factor ?? ((value.waste_persen ?? 0) / 100),
})).refine((value) => value.qty_required > 0, {
  message: "Quantity must be greater than 0",
  path: ["qty_required"],
});

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function normalizeToSmallUnit(
  baseCost: number,
  konversiFactor?: number | null,
  satuanKecilId?: string | null
) {
  const factor = Number(konversiFactor ?? 0);
  if (satuanKecilId && factor > 0) return baseCost / factor;
  return baseCost;
}

// GET /api/purchasing/raw-materials/:id/bom
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();

    const { data, error } = await db
      .from("raw_material_bom_items", MANUFACTURING_SCHEMA)
      .select(`
        *,
        component:raw_materials!component_raw_material_id (*),
        satuan:units!satuan_id (*)
      `)
      .eq("output_raw_material_id", id)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const componentIds = Array.from(
      new Set((data || []).map((item) => item.component_raw_material_id).filter(Boolean))
    );
    const { data: stockCosts } = componentIds.length > 0
      ? await db
          .from("v_raw_materials_stock")
          .select("id, avg_cost, konversi_factor, satuan_kecil_id")
          .in("id", componentIds)
      : { data: [] };

    const stockCostMap = new Map(
      (stockCosts || []).map((material) => [
        material.id,
        normalizeToSmallUnit(
          Number(material.avg_cost ?? 0),
          material.konversi_factor,
          material.satuan_kecil_id
        ),
      ])
    );

    const bomWithCost = (data || []).map((item) => {
      const materialCost = stockCostMap.get(item.component_raw_material_id) ?? 0;
      const qtyWithWaste = Number(item.qty_required ?? 0) * (1 + Number(item.waste_factor ?? 0));
      return {
        ...item,
        raw_material_id: item.component_raw_material_id,
        raw_material: item.component,
        cost_per_unit: materialCost,
        total_cost: materialCost * qtyWithWaste,
      };
    });

    return Response.json({ success: true, data: bomWithCost });
  } catch (error: unknown) {
    console.error("Error fetching raw material BOM:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Failed to load bill of materials") },
      { status: 500 }
    );
  }
}

// POST /api/purchasing/raw-materials/:id/bom
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();
    const body = await request.json();
    const validated = bomSchema.parse(body);

    if (validated.component_raw_material_id === id) {
      return Response.json(
        { success: false, message: "A raw material cannot be a component of itself" },
        { status: 400 }
      );
    }

    const { data: outputMaterial, error: outputError } = await db
      .from("raw_materials")
      .select("id")
      .eq("id", id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .single();

    if (outputError || !outputMaterial) {
      return Response.json(
        { success: false, message: "Output raw material not found" },
        { status: 404 }
      );
    }

    const { data: component, error: componentError } = await db
      .from("raw_materials")
      .select("id")
      .eq("id", validated.component_raw_material_id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .single();

    if (componentError || !component) {
      return Response.json(
        { success: false, message: "Component raw material not found" },
        { status: 404 }
      );
    }

    const { data: existingItem } = await db
      .from("raw_material_bom_items", MANUFACTURING_SCHEMA)
      .select("id")
      .eq("output_raw_material_id", id)
      .eq("component_raw_material_id", validated.component_raw_material_id)
      .eq("is_active", true)
      .maybeSingle();

    if (existingItem) {
      return Response.json(
        { success: false, message: "This component is already in the bill of materials" },
        { status: 400 }
      );
    }

    const { data, error } = await db
      .from("raw_material_bom_items", MANUFACTURING_SCHEMA)
      .insert({
        output_raw_material_id: id,
        component_raw_material_id: validated.component_raw_material_id,
        qty_required: validated.qty_required,
        satuan_id: validated.satuan_id,
        waste_factor: validated.waste_factor,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    return Response.json(
      { success: true, data, message: "Component added to bill of materials" },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Error creating raw material BOM item:", error);

    if (error instanceof z.ZodError) {
      return Response.json(
        { success: false, message: "Validation failed", errors: error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    return Response.json(
      { success: false, message: getErrorMessage(error, "Failed to add component to bill of materials") },
      { status: 500 }
    );
  }
}
