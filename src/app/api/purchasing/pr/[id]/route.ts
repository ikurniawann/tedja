import { createServerPgClient } from "@/lib/pg/create-client";
import { requireUser } from "@/lib/auth/require-user";
import { NextRequest, NextResponse } from "next/server";
import {
  extractPrErrorMessage,
  formatZodError,
  isZodValidationError,
  normalizePrWriteItems,
  parsePrWriteBody,
  sumPrTotalAmount,
} from "@/lib/purchasing/pr-schemas";

type RouteParams = {
  params: Promise<{ id: string }>;
};

function buildPRPermissions(
  pr: { status: string; converted_po_id?: string | null; requester_id: string },
  user: { id: string; role: string }
) {
  const canEdit =
    pr.status === "draft" &&
    (pr.requester_id === user.id ||
      ["purchasing_manager", "purchasing_admin", "super_admin", "admin"].includes(user.role));

  const canApprove =
    pr.status !== "approved" &&
    pr.status !== "rejected" &&
    pr.status !== "converted" &&
    pr.status === "pending_head" &&
    ["hrd", "purchasing_manager", "purchasing_admin", "super_admin", "admin", "pos_supervisor", "direksi"].includes(
      user.role
    );

  const canCreatePO =
    pr.status === "approved" &&
    !pr.converted_po_id &&
    (user.role === "purchasing_manager" || user.role === "purchasing_staff");

  return { canEdit, canApprove, canCreatePO };
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();
    const user = await requireUser();

    const { data: pr, error } = await db
      .from("purchase_requests")
      .select(`
        *,
        items:pr_items(
          *,
          raw_material:raw_materials!raw_material_id(id, kode, nama),
          product:products!product_id(id, kode, nama),
          satuan:units!satuan_id(id, nama)
        )
      `)
      .eq("id", id)
      .single();

    if (error || !pr) {
      return NextResponse.json({ error: "PR tidak ditemukan" }, { status: 404 });
    }

    const relatedUserIds = [
      pr.requester_id,
      pr.approved_by_head,
      pr.approved_by_finance,
      pr.approved_by_direksi,
      pr.rejected_by,
    ].filter(Boolean);

    const [{ data: relatedUsers }, { data: department }] = await Promise.all([
      relatedUserIds.length
        ? db.from("users").select("id, full_name").in("id", relatedUserIds)
        : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
      pr.department_id
        ? db.from("departments").select("name, code").eq("id", pr.department_id).single()
        : Promise.resolve({ data: null }),
    ]);

    const userNameById = new Map(
      (relatedUsers || []).map((relatedUser) => [relatedUser.id, relatedUser.full_name])
    );

    return NextResponse.json({
      data: {
        ...pr,
        department,
        requester_name: userNameById.get(pr.requester_id) || "-",
        approved_head_name: pr.approved_by_head ? userNameById.get(pr.approved_by_head) : null,
        approved_finance_name: pr.approved_by_finance ? userNameById.get(pr.approved_by_finance) : null,
        approved_direksi_name: pr.approved_by_direksi ? userNameById.get(pr.approved_by_direksi) : null,
        rejected_by_name: pr.rejected_by ? userNameById.get(pr.rejected_by) : null,
        permissions: buildPRPermissions(pr, user),
      },
    });
  } catch (error) {
    console.error("Error fetching PR detail:", error);
    return NextResponse.json({ error: "Gagal mengambil detail PR" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();
    const user = await requireUser();
    const moduleType =
      existingPR.module_type === "product" ? ("product" as const) : ("raw_material" as const);
    const validated = parsePrWriteBody(await request.json(), moduleType);

    const { data: existingPR, error: findError } = await db
      .from("purchase_requests")
      .select("id, requester_id, status, module_type")
      .eq("id", id)
      .single();

    if (findError || !existingPR) {
      return NextResponse.json({ error: "PR tidak ditemukan" }, { status: 404 });
    }

    const canEdit =
      existingPR.requester_id === user.id ||
      ["purchasing_manager", "purchasing_admin", "super_admin", "admin"].includes(user.role);

    if (!canEdit) {
      return NextResponse.json({ error: "Anda tidak memiliki akses mengubah PR ini" }, { status: 403 });
    }

    if (existingPR.status !== "draft") {
      return NextResponse.json({ error: "Hanya PR draft yang bisa diedit" }, { status: 400 });
    }

    const normalizedItems = normalizePrWriteItems(validated.items);
    const totalAmount = sumPrTotalAmount(normalizedItems);

    const nextStatus = validated.action === "submit" ? "pending_head" : "draft";

    const { error: deleteItemsError } = await db
      .from("pr_items")
      .delete()
      .eq("pr_id", id);

    if (deleteItemsError) throw deleteItemsError;

    const items = normalizedItems.map((item) => ({
      pr_id: id,
      product_id: "product_id" in item ? item.product_id : null,
      raw_material_id: "raw_material_id" in item ? item.raw_material_id : null,
      satuan_id: item.satuan_id || null,
      description: item.description,
      qty: item.qty,
      unit: item.unit,
      estimated_price: item.estimated_price,
      total: item.total,
    }));

    const { error: insertItemsError } = await db.from("pr_items").insert(items);
    if (insertItemsError) throw insertItemsError;

    const { error: updateError } = await db
      .from("purchase_requests")
      .update({
        department_id: validated.department_id,
        priority: validated.priority,
        required_date: validated.required_date || null,
        notes: validated.notes || null,
        total_amount: totalAmount,
        status: nextStatus,
        current_approval_level: nextStatus === "pending_head" ? "head_dept" : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) throw updateError;

    return NextResponse.json({ data: { id, status: nextStatus } });
  } catch (error) {
    console.error("Error updating PR:", error);
    if (isZodValidationError(error)) {
      return NextResponse.json(
        { error: formatZodError(error), details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: extractPrErrorMessage(error, "Gagal mengubah PR") },
      { status: 500 }
    );
  }
}
