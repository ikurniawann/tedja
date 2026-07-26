import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { checkRateLimit, clientIpFrom } from "@/lib/public/rate-limit";

// Endpoint PUBLIK: status Season Pass via access_token (64 hex). Token
// salah/tak dikenal → 404 generik (anti-enumerasi). Pass 'pending' yang
// invoice-nya lewat waktu ditandai 'expired' secara lazy.

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const notFound = () =>
  NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

interface PassRow {
  id: string;
  pass_code: string;
  holder_name: string;
  status: string;
  entry_policy: string;
  valid_from: string | null;
  valid_until: string | null;
  visit_quota_total: number | null;
  visit_quota_used: number;
  unit_price: string;
  product_name: string;
  xendit_invoice_url: string | null;
  payment_expires_at: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`pass-status:${ip}`, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak permintaan — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const { token } = await params;
    if (!TOKEN_PATTERN.test(token)) return notFound();

    const pass = await queryOne<PassRow>(
      `SELECT sp.id, sp.pass_code, sp.holder_name, sp.status, sp.entry_policy,
              sp.valid_from::text AS valid_from, sp.valid_until::text AS valid_until,
              sp.visit_quota_total, sp.visit_quota_used, sp.unit_price,
              tp.name AS product_name, sp.xendit_invoice_url,
              sp.payment_expires_at::text AS payment_expires_at
       FROM ticketing.ticket_season_passes sp
       JOIN ticketing.ticket_products tp ON tp.id = sp.ticket_product_id
       WHERE sp.access_token = $1`,
      [token]
    );
    if (!pass) return notFound();

    // Lazy-expire: pending yang invoice-nya lewat waktu → expired
    let status = pass.status;
    if (
      status === "pending" &&
      pass.payment_expires_at &&
      new Date(pass.payment_expires_at).getTime() < Date.now()
    ) {
      status = "expired";
    }

    return successResponse({
      pass_code: pass.pass_code,
      holder_name: pass.holder_name,
      product_name: pass.product_name,
      status,
      entry_policy: pass.entry_policy,
      valid_from: pass.valid_from,
      valid_until: pass.valid_until,
      visit_quota_total: pass.visit_quota_total,
      visit_quota_used: pass.visit_quota_used,
      unit_price: Number(pass.unit_price),
      // QR = access_token (sama dgn URL ini) — dipindai di gate
      qr_value: token,
      invoice_url: pass.xendit_invoice_url,
      payment_expires_at: pass.payment_expires_at,
    });
  } catch (err) {
    console.error("[pass] status error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat status pass" },
      { status: 500 }
    );
  }
}
