import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { checkRateLimit, clientIpFrom } from "@/lib/public/rate-limit";
import { resolvePublicVenue } from "@/lib/ticketing/booking-server";

// Endpoint PUBLIK: katalog Season Pass yang dijual ONLINE (terdistribusi ke
// kanal 'website'), Active, ber-config. Harga dari varian "Umum" (fallback
// base_price). 404 generik utk slug tak dikenal (anti-enumerasi).

const notFound = () =>
  NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

interface PassRow {
  ticket_product_id: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  validity_months: number;
  entry_policy: string;
  visit_quota: number | null;
  unit_price: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`pass-catalog:${ip}`, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak permintaan — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const { slug } = await params;
    const venue = await resolvePublicVenue(slug);
    if (!venue) return notFound();

    const rows = await query<PassRow>(
      `SELECT tp.id AS ticket_product_id, tp.name, tp.description, tp.thumbnail_url,
              pc.validity_months, pc.entry_policy, pc.visit_quota,
              COALESCE(v.price_regular, tp.base_price) AS unit_price
       FROM ticketing.ticket_products tp
       JOIN ticketing.ticket_pass_configs pc ON pc.ticket_product_id = tp.id
       JOIN ticketing.ticket_product_channels pch
         ON pch.ticket_product_id = tp.id AND pch.is_distributed = true
       JOIN ticketing.ticket_channels ch
         ON ch.id = pch.channel_id AND ch.code = 'website'
       LEFT JOIN LATERAL (
         SELECT price_regular FROM ticketing.ticket_product_variants
         WHERE ticket_product_id = tp.id AND is_active = true
         ORDER BY sort_order LIMIT 1
       ) v ON true
       WHERE tp.branch_id = $1 AND tp.company_id = $2
         AND tp.product_kind = 'season_pass' AND tp.status = 'active'
       ORDER BY tp.name`,
      [venue.branchId, venue.companyId]
    );

    return successResponse({
      venue: { name: venue.venueName },
      passes: rows.map((r) => ({
        ticket_product_id: r.ticket_product_id,
        name: r.name,
        description: r.description,
        thumbnail_url: r.thumbnail_url,
        validity_months: r.validity_months,
        entry_policy: r.entry_policy,
        visit_quota: r.visit_quota,
        unit_price: Number(r.unit_price ?? 0),
      })),
    });
  } catch (err) {
    console.error("[pass] catalog error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat katalog pass" },
      { status: 500 }
    );
  }
}
