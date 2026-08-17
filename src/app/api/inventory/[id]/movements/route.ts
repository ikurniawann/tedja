import { NextRequest } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { paginatedResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireIamMenuPrefix(IAM.itemsInventory);
    const db = createPgClient();
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get("page") || 1);
    const limit = Number(searchParams.get("limit") || 25);
    const offset = (page - 1) * limit;

    const { data, error, count } = await db
      .from("inventory_movements")
      .select("*", { count: "exact" })
      .eq("inventory_id", id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return paginatedResponse(data || [], { page, limit, total: count || 0 }, "Movements retrieved");
  } catch (e: any) {
    console.error("Error fetching movements:", e);
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
}
