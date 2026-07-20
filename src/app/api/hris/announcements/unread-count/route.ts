// ============================================================
// API Route: Unread Announcement Count (badge sidebar)
// GET — jumlah pengumuman published yang menyasar karyawan & belum dibaca.
//
// Perhitungannya kini tinggal di src/lib/hris/nav-badges.ts agar endpoint ini
// dan badge navigasi tidak memelihara dua salinan query yang bisa menyimpang.
// ============================================================

import { NextResponse } from "next/server";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { countUnreadAnnouncements } from "@/lib/hris/nav-badges";

export async function GET() {
  try {
    const actor = await getWorkforceActor();
    if (!actor?.employeeId) {
      return NextResponse.json({ unread: 0 });
    }

    return NextResponse.json({ unread: await countUnreadAnnouncements(actor.employeeId) });
  } catch (error) {
    console.error("Error counting unread announcements:", error);
    return NextResponse.json({ unread: 0 });
  }
}
