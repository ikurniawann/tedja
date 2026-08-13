import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPosSession, successResponse } from "@/lib/api/auth";
import {
  listPosPaymentMethods,
  updatePosPaymentMethod,
} from "@/lib/pos/payment-methods-store";
import { isPosPaymentMethodCode } from "@/lib/pos/payment-methods";

export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const activeOnly =
      request.nextUrl.searchParams.get("active") === "1" ||
      request.nextUrl.searchParams.get("activeOnly") === "true";
    const data = await listPosPaymentMethods({ activeOnly });
    return successResponse(data);
  } catch (err) {
    console.error("[pos] list payment methods:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat metode bayar" },
      { status: 500 }
    );
  }
}

const patchSchema = z.object({
  code: z.string().min(2).max(40),
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(200).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(10_000).optional(),
});

export async function PATCH(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { code, ...patch } = parsed.data;
    if (!isPosPaymentMethodCode(code)) {
      return NextResponse.json(
        { success: false, error: "Kode metode tidak dikenali" },
        { status: 400 }
      );
    }
    if (
      patch.name === undefined &&
      patch.description === undefined &&
      patch.is_active === undefined &&
      patch.sort_order === undefined
    ) {
      return NextResponse.json(
        { success: false, error: "Tidak ada field yang diubah" },
        { status: 400 }
      );
    }

    const updated = await updatePosPaymentMethod(code, patch);
    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Metode bayar tidak ditemukan" },
        { status: 404 }
      );
    }
    return successResponse(updated, "Metode bayar diperbarui");
  } catch (err) {
    console.error("[pos] update payment method:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui metode bayar" },
      { status: 500 }
    );
  }
}
