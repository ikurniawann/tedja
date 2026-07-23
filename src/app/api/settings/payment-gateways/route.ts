import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  shouldKeepExistingSecret,
  toPaymentGatewayPublic,
  type PaymentGatewayRow,
} from "@/lib/configuration/payment-gateways";

function apiErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function GET() {
  try {
    await requireApiRole(["super_admin", "admin"]);
    const db = await createServerPgClient();
    const { data, error } = await db
      .from("payment_gateways", "configuration")
      .select("*")
      .order("display_name", { ascending: true });

    if (error) throw error;

    const rows = ((data ?? []) as PaymentGatewayRow[]).map(toPaymentGatewayPublic);
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[settings/payment-gateways] GET failed:", error);
    return NextResponse.json({ success: false, error: apiErrorMessage(error) }, { status: 500 });
  }
}

const updateSchema = z.object({
  provider: z.enum(["xendit", "midtrans"]),
  display_name: z.string().trim().min(1).max(120).optional(),
  is_active: z.boolean(),
  environment: z.enum(["sandbox", "live"]),
  secret_key: z.string().optional().nullable(),
  public_key: z.string().optional().nullable(),
  webhook_secret: z.string().optional().nullable(),
  callback_url: z.string().trim().max(500).optional().nullable(),
});

export async function PUT(request: NextRequest) {
  try {
    const user = await requireApiRole(["super_admin", "admin"]);
    const body = updateSchema.parse(await request.json());
    const db = await createServerPgClient();

    const { data: existing, error: existingError } = await db
      .from("payment_gateways", "configuration")
      .select("*")
      .eq("provider", body.provider)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing) {
      return NextResponse.json(
        { success: false, error: `Provider ${body.provider} belum terdaftar` },
        { status: 404 }
      );
    }

    const current = existing as PaymentGatewayRow;
    const metadata = (current.metadata && typeof current.metadata === "object"
      ? current.metadata
      : {}) as Record<string, unknown>;

    if (metadata.coming_soon && body.is_active) {
      return NextResponse.json(
        { success: false, error: `${current.display_name} belum tersedia (coming soon)` },
        { status: 400 }
      );
    }

    const payload: Record<string, unknown> = {
      is_active: body.is_active,
      environment: body.environment,
      callback_url: body.callback_url?.trim() || null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };

    if (body.display_name) payload.display_name = body.display_name;

    if (!shouldKeepExistingSecret(body.secret_key)) {
      payload.secret_key = String(body.secret_key).trim();
    }
    if (!shouldKeepExistingSecret(body.public_key)) {
      payload.public_key = String(body.public_key).trim();
    }
    if (!shouldKeepExistingSecret(body.webhook_secret)) {
      payload.webhook_secret = String(body.webhook_secret).trim();
    }

    if (body.is_active && !payload.secret_key && !current.secret_key) {
      return NextResponse.json(
        { success: false, error: "Secret key wajib diisi sebelum mengaktifkan gateway" },
        { status: 400 }
      );
    }

    const { data, error } = await db
      .from("payment_gateways", "configuration")
      .update(payload)
      .eq("provider", body.provider)
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: toPaymentGatewayPublic(data as PaymentGatewayRow),
      message: "Payment gateway settings saved",
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("[settings/payment-gateways] PUT failed:", error);
    return NextResponse.json({ success: false, error: apiErrorMessage(error) }, { status: 500 });
  }
}
