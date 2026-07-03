import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { z } from "zod";

const bomSchema = z.object({
  qty_required: z.number().min(0.0001).optional(),
  satuan_id: z.string().uuid().optional().nullable(),
  waste_factor: z.number().min(0).max(1).optional(),
  is_active: z.boolean().optional(),
});

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();
    const validated = bomSchema.parse(await request.json());

    const { data: existingItem, error: findError } = await db
      .from("raw_material_bom_items")
      .select("id")
      .eq("id", id)
      .single();

    if (findError || !existingItem) {
      return Response.json({ success: false, message: "Bill of materials item not found" }, { status: 404 });
    }

    const { data, error } = await db
      .from("raw_material_bom_items")
      .update({ ...validated, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return Response.json({ success: true, data, message: "Bill of materials item updated" });
  } catch (error: unknown) {
    console.error("Error updating raw material BOM item:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Failed to update bill of materials item") },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();

    const { error } = await db
      .from("raw_material_bom_items")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw error;

    return Response.json({ success: true, message: "Bill of materials item removed" });
  } catch (error: unknown) {
    console.error("Error deleting raw material BOM item:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Failed to remove bill of materials item") },
      { status: 500 }
    );
  }
}
