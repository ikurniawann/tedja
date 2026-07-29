import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPosSession } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { resolveActiveStallFromCookies } from "@/lib/auth/active-stall";
import { loadUserWarehouses } from "@/lib/users/user-warehouses";
import { calculateBillCharges } from "@/lib/pos/billing-settings";
import {
  listBillingProfiles,
  listBranchesForBilling,
  listWarehousesForBilling,
  resolveBillingProfile,
  upsertBillingProfile,
} from "@/lib/pos/billing-settings-server";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

async function resolveSessionScope(userId: string) {
  const [scope, warehouses, activeStall] = await Promise.all([
    getApiUserScope(),
    loadUserWarehouses(userId),
    resolveActiveStallFromCookies(),
  ]);

  const branchId = scope?.branchId ?? warehouses[0]?.branch_id ?? null;
  let warehouseId: string | null = null;
  if (activeStall.mode === "stall") {
    warehouseId = activeStall.stall.id;
  } else if (activeStall.mode === "unset") {
    warehouseId = warehouses[0]?.warehouse_id ?? null;
  }

  return { branchId, warehouseId };
}

const chargeSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  charge_kind: z.enum(["tax", "service", "fee", "rounding"]),
  calc_method: z.enum(["percent", "fixed", "round_nearest", "round_up"]),
  rate: z.number().nonnegative(),
  amount: z.number().nonnegative(),
  apply_order: z.number().int(),
  is_enabled: z.boolean(),
  is_optional: z.boolean(),
  base: z.enum(["subtotal_after_discount", "subtotal_plus_fees"]),
});

const upsertSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  branch_id: z.string().uuid().nullable(),
  warehouse_id: z.string().uuid().nullable(),
  name: z.string().min(1).max(120),
  charges: z.array(chargeSchema).min(1),
});

export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const { searchParams } = request.nextUrl;
    const mode = searchParams.get("mode") || "resolve";
    const branchId = searchParams.get("branch_id");
    const warehouseId = searchParams.get("warehouse_id");
    const subtotal = Number(searchParams.get("subtotal") || 0);
    const enabledCodes = (searchParams.get("enabled_codes") || "")
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean);

    if (mode === "options") {
      const [branches, warehouses, profiles] = await Promise.all([
        listBranchesForBilling(),
        listWarehousesForBilling(branchId),
        listBillingProfiles(),
      ]);
      return NextResponse.json({
        success: true,
        data: { branches, warehouses, profiles },
      });
    }

    if (mode === "list") {
      const profiles = await listBillingProfiles();
      return NextResponse.json({ success: true, data: profiles });
    }

    // Prefer explicit query params; otherwise session scope (branch + active stall).
    const useSession = !branchId && !warehouseId;
    const sessionScope = useSession ? await resolveSessionScope(sessionUserId) : null;
    const profile = await resolveBillingProfile({
      branchId: branchId || sessionScope?.branchId,
      warehouseId: warehouseId || (useSession ? sessionScope?.warehouseId : null),
    });

    const preview =
      subtotal > 0
        ? calculateBillCharges({
            subtotalAfterDiscount: subtotal,
            charges: profile.charges,
            enabledOptionalCodes: enabledCodes,
          })
        : null;

    return NextResponse.json({
      success: true,
      data: { profile, preview },
    });
  } catch (error: unknown) {
    console.error("[pos/billing-settings] GET failed:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const body = upsertSchema.parse(await request.json());
    const codes = body.charges.map((c) => c.code.trim().toUpperCase());
    if (new Set(codes).size !== codes.length) {
      return NextResponse.json(
        { success: false, error: "Charge codes must be unique within a profile" },
        { status: 400 }
      );
    }

    const profile = await upsertBillingProfile({
      id: body.id,
      branchId: body.branch_id,
      warehouseId: body.warehouse_id,
      name: body.name,
      updatedBy: sessionUserId,
      charges: body.charges.map((charge) => ({
        ...charge,
        code: charge.code.trim().toUpperCase(),
      })),
    });

    return NextResponse.json({
      success: true,
      data: profile,
      message: "Billing settings saved",
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("[pos/billing-settings] PUT failed:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
