import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { checkRateLimit, clientIpFrom } from "@/lib/public/rate-limit";
import {
  todayInJakarta,
  validateVisitDateWindow,
} from "@/lib/ticketing/booking";
import {
  buildPublicCatalog,
  resolvePublicVenue,
} from "@/lib/ticketing/booking-server";

// Endpoint PUBLIK (tanpa auth): katalog ticket utk satu tanggal — hanya
// produk Active terdistribusi website ber-harga lengkap. 404 generik utk
// slug tak dikenal (anti-enumerasi).

const notFound = () =>
  NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`booking-catalog:${ip}`, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak permintaan — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const { slug } = await params;
    const visitDate = request.nextUrl.searchParams.get("date") ?? "";

    const window = validateVisitDateWindow(visitDate, todayInJakarta());
    if (window !== "ok") {
      const message =
        window === "masa-lalu"
          ? "Tanggal kunjungan sudah lewat"
          : window === "terlalu-jauh"
            ? "Tanggal kunjungan terlalu jauh ke depan"
            : "Tanggal kunjungan tidak valid";
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }

    const venue = await resolvePublicVenue(slug);
    if (!venue) return notFound();

    const catalog = await buildPublicCatalog(venue, visitDate);
    return successResponse({ visit_date: visitDate, products: catalog });
  } catch (err) {
    console.error("[booking] catalog error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat katalog" },
      { status: 500 }
    );
  }
}
