import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { CUSTOM_FIELD_OBJECTS, type CustomFieldObject } from "@/lib/crm/custom-fields";
import { loadCustomFieldDefs } from "@/lib/crm/custom-fields-server";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

/** Definisi custom field aktif untuk form (dibaca semua user sales). */
export async function GET(request: NextRequest) {
  const { error } = await requireSalesFunnelRole();
  if (error) return error;
  const object = new URL(request.url).searchParams.get("object") ?? "";
  if (!(CUSTOM_FIELD_OBJECTS as readonly string[]).includes(object)) {
    return NextResponse.json({ success: false, error: "object wajib: lead|deal|account|contact" }, { status: 400 });
  }
  const scope = await getApiUserScope();
  return successResponse(await loadCustomFieldDefs(object as CustomFieldObject, scope?.companyId ?? null));
}
