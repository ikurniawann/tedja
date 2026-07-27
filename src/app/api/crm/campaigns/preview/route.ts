import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { getCrmDefaultVenue, requireCrmCampaign } from "@/lib/crm/server";
import { createPgClient } from "@/lib/pg/create-client";
import { normalizeSegment } from "@/lib/crm/campaigns";
import { previewSegment } from "@/lib/crm/campaigns-server";

// EPIC-033 — preview segmen TANPA kirim: jumlah penerima (minus opt-out)
// + 5 sampel. Dipakai form kampanye sebelum owner menekan mulai.

export async function POST(request: NextRequest) {
  const { error } = await requireCrmCampaign();
  if (error) return error;

  try {
    const body = (await request.json()) as { segment?: unknown };
    const venue = await getCrmDefaultVenue(createPgClient());
    if (!venue.companyId || !venue.branchId) {
      return NextResponse.json(
        { success: false, error: "Venue belum dikonfigurasi" },
        { status: 400 }
      );
    }
    const preview = await previewSegment(
      { companyId: venue.companyId, branchId: venue.branchId },
      normalizeSegment(body.segment)
    );
    return successResponse(preview);
  } catch (err) {
    console.error("[crm-campaign] preview error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghitung segmen" },
      { status: 500 }
    );
  }
}
