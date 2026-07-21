import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  TICKETING_OPERATOR_ROLES,
  isValidNfcUid,
  normalizeNfcUid,
  requireTicketingContext,
} from "@/lib/ticketing/server";
import { checkTabForCharge } from "@/lib/ticketing/tab-server";

const checkSchema = z.object({
  nfc_uid: z.string().trim().min(1).max(80),
  amount: z.number().min(0).max(1_000_000_000),
});

/**
 * Pratinjau untuk layar pembayaran kasir: tap gelang → tampil nama
 * rombongan + apakah total order bakal lolos guard saldo/plafon.
 * Read-only — charge sungguhan terjadi saat order dibuat.
 */
export async function POST(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  const rate = checkRateLimit(`ticketing-tab-check:${ctx.user.id}`, 60);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak pengecekan — tunggu sebentar" },
      { status: 429 }
    );
  }

  try {
    const parsed = checkSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const uid = normalizeNfcUid(parsed.data.nfc_uid);
    if (!isValidNfcUid(uid)) {
      return NextResponse.json(
        { success: false, error: "UID gelang tidak valid" },
        { status: 400 }
      );
    }

    const result = await checkTabForCharge({
      bandUid: uid,
      amount: parsed.data.amount,
      companyId: ctx.companyId,
      branchId: ctx.branchId,
    });
    if (!result.ok) {
      return successResponse({ ok: false, reason: result.reason });
    }
    return successResponse({ ok: true, ...result.target });
  } catch (err) {
    console.error("[ticketing] tab check error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memeriksa tab" },
      { status: 500 }
    );
  }
}
