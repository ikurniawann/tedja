import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { reportDefinitionSchema } from "@/lib/crm/report-builder";
import { requireReportUser, runReportDefinition } from "@/lib/crm/report-builder-server";

/** EPIC-050 T-4.1 — jalankan definisi ad-hoc (pratinjau builder). */
export async function POST(request: NextRequest) {
  const { error, user, scope } = await requireReportUser();
  if (error) return error;
  const parsed = reportDefinitionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const result = await runReportDefinition(parsed.data, user, scope);
  return successResponse(result);
}
