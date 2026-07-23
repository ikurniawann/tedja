// ============================================================
// API Route: Badge notifikasi navigasi
// GET  — jumlah antrean persetujuan (HR) & pembaruan pengajuan (ESS)
// POST — tandai satu modul ESS sudah dilihat
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { buildNavBadges, ESS_MODULES, isEssModule } from "@/lib/hris/nav-badges";

export async function GET() {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ badges: {} });
    }

    return NextResponse.json({ badges: await buildNavBadges(actor) });
  } catch (error) {
    // Badge bersifat hiasan — kegagalannya tidak boleh merusak navigasi.
    console.error("Error building nav badges:", error);
    return NextResponse.json({ badges: {} });
  }
}

const seenSchema = z.object({
  module: z.string().refine(isEssModule, {
    message: `module harus salah satu dari: ${ESS_MODULES.join(", ")}`,
  }),
});

export async function POST(request: NextRequest) {
  try {
    const actor = await getWorkforceActor();
    if (!actor?.employeeId) {
      return NextResponse.json(
        { success: false, error: "Karyawan tidak ditemukan" },
        { status: 403 }
      );
    }

    const payload = seenSchema.parse(await request.json());

    await query(
      `INSERT INTO hris.ess_module_reads (employee_id, module, last_seen_at)
       VALUES ($1, $2, now())
       ON CONFLICT (employee_id, module)
       DO UPDATE SET last_seen_at = now()`,
      [actor.employeeId, payload.module]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: "Modul tidak valid" }, { status: 400 });
    }

    console.error("Error marking ESS module as seen:", error);
    return NextResponse.json({ success: false, error: "Gagal menandai" }, { status: 500 });
  }
}
