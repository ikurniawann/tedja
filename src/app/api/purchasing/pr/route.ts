import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest, NextResponse } from "next/server";
import { generatePRNumber } from "@/lib/purchasing/utils";
import {
  extractPrErrorMessage,
  formatZodError,
  isZodValidationError,
  normalizePrWriteItems,
  parsePrWriteBody,
  sumPrTotalAmount,
  type PrWriteItem,
} from "@/lib/purchasing/pr-schemas";
import { requireUser } from "@/lib/auth/require-user";
import { notifyPrMendesak } from "@/lib/purchasing/pr-urgent-notify";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
  effectiveCompanyId,
  effectiveBranchId,
} from "@/lib/api/scope";

export async function GET(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const user = await requireUser();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const department_id = searchParams.get("department_id");
    const module_type = searchParams.get("module_type") || "raw_material";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    let query = db
      .from("purchase_requests")
      .select(
        `
        *,
        items:pr_items(*)
      `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false });

    // Business scope: branch
    const scope = await getApiUserScope();
    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    // Apply filters
    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    if (search) {
      query = query.ilike("pr_number", `%${search}%`);
    }

    if (department_id) {
      query = query.eq("department_id", department_id);
    }

    if (
      module_type === "raw_material" ||
      module_type === "product" ||
      module_type === "general"
    ) {
      query = query.eq("module_type", module_type);
    }

    // Role-based filtering
    const restrictedRoles = ["hiring_manager"];
    if (restrictedRoles.includes(user.role)) {
      // Hiring manager only sees their own PRs
      query = query.eq("requester_id", user.id);
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: prs, error, count } = await query.range(from, to);

    if (error) throw error;

    const requesterIds = [
      ...new Set((prs || []).map((pr) => pr.requester_id).filter(Boolean)),
    ];
    const { data: requesters } = requesterIds.length
      ? await db
          .from("users")
          .select("id, full_name")
          .in("id", requesterIds)
      : { data: [] };
    const requesterById = new Map(
      (requesters || []).map((requester) => [requester.id, requester.full_name])
    );
    const departmentIds = [
      ...new Set((prs || []).map((pr) => pr.department_id).filter(Boolean)),
    ];
    const { data: departments } = departmentIds.length
      ? await db
          .from("departments")
          .select("id, name")
          .in("id", departmentIds)
      : { data: [] };
    const departmentById = new Map(
      (departments || []).map((department) => [department.id, department.name])
    );

    const mappedPrs = (prs || []).map((pr: any) => ({
      ...pr,
      requester_name: requesterById.get(pr.requester_id),
      department_name: departmentById.get(pr.department_id),
    }));

    return NextResponse.json({
      data: mappedPrs,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching PR:", error);
    return NextResponse.json(
      { error: "Gagal mengambil data PR" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const user = await requireUser();
    
    // Check authorization
    const allowedRoles = [
      "purchasing_staff",
      "purchasing_manager",
      "purchasing_admin",
      "super_admin",
      "admin",
      "pos_supervisor",
      "hrd",
    ];
    if (!allowedRoles.includes(user.role)) {
      return NextResponse.json(
        { error: "Anda tidak memiliki akses untuk membuat PR" },
        { status: 403 }
      );
    }
    
    const body = await request.json();
    const moduleType =
      body?.module_type === "product"
        ? ("product" as const)
        : body?.module_type === "general"
          ? ("general" as const)
          : ("raw_material" as const);
    const validated = parsePrWriteBody(body, moduleType);
    const scope = await getApiUserScope();
    const companyId = effectiveCompanyId(scope);
    const branchId = effectiveBranchId(scope);
    
    // Generate PR number
    const prNumber = await generatePRNumber(db);
    
    const normalizedItems = normalizePrWriteItems(validated.items as PrWriteItem[]);
    const totalAmount = sumPrTotalAmount(normalizedItems);

    const nextStatus = validated.action === "submit" ? "pending_head" : "draft";

    // Start transaction
    const { data: pr, error: prError } = await db
      .from("purchase_requests")
      .insert({
        pr_number: prNumber,
        requester_id: user.id,
        company_id: companyId,
        branch_id: branchId,
        department_id: validated.department_id,
        status: nextStatus,
        total_amount: totalAmount,
        priority: validated.priority,
        notes: validated.notes || null,
        required_date: validated.required_date || null,
        module_type: moduleType,
        current_approval_level: nextStatus === "pending_head" ? "head_dept" : null,
      })
      .select()
      .single();
    
    if (prError) {
      return NextResponse.json(
        { error: extractPrErrorMessage(prError, "Gagal menyimpan header PR") },
        { status: 400 }
      );
    }

    if (!pr) {
      return NextResponse.json({ error: "Gagal menyimpan header PR" }, { status: 500 });
    }
    
    // Insert items
    const itemsWithTotal = normalizedItems.map((item) => ({
      pr_id: pr.id,
      product_id: "product_id" in item ? item.product_id : null,
      raw_material_id: "raw_material_id" in item ? item.raw_material_id : null,
      supply_item_id: "supply_item_id" in item ? item.supply_item_id : null,
      satuan_id: item.satuan_id || null,
      description: item.description,
      qty: item.qty,
      unit: item.unit,
      estimated_price: item.estimated_price,
      total: item.total,
    }));
    
    const { error: itemsError } = await db
      .from("pr_items")
      .insert(itemsWithTotal);
    
    if (itemsError) {
      await db.from("purchase_requests").delete().eq("id", pr.id);
      return NextResponse.json(
        { error: extractPrErrorMessage(itemsError, "Gagal menyimpan item PR") },
        { status: 400 }
      );
    }
    

    // Prioritas Mendesak → WA ke penerima di Settings → Notifikasi WA
    // (fire-and-forget; tidak mengganggu respons).
    void notifyPrMendesak({
      prId: pr.id,
      prNumber,
      priority: validated.priority,
      status: nextStatus,
      requesterName: user.full_name,
      departmentId: validated.department_id,
      totalAmount,
      requiredDate: validated.required_date || null,
      notes: validated.notes || null,
      items: normalizedItems.map((item) => ({
        description: item.description,
        qty: item.qty,
        unit: item.unit,
      })),
    });

    return NextResponse.json({ data: pr }, { status: 201 });
  } catch (error) {
    console.error("Error creating PR:", error);
    if (isZodValidationError(error)) {
      return NextResponse.json(
        { error: formatZodError(error), details: error.issues },
        { status: 400 }
      );
    }
    const message = extractPrErrorMessage(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
