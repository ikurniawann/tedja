import { createPgClient } from "@/lib/pg/create-client";
import type { DbClient } from "@/lib/pg/types";
import type { PaymentGatewayRow } from "@/lib/configuration/payment-gateways";

export type XenditGatewayConfig = {
  secretKey: string;
  webhookToken: string | null;
  callbackUrl: string | null;
  environment: "sandbox" | "live";
};

export type CreateXenditQrResult = {
  id: string;
  reference_id: string;
  qr_string: string;
  status: string;
  amount: number;
  expires_at?: string | null;
  raw: Record<string, unknown>;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Xendit error";
}

export async function loadActiveXenditConfig(
  db: DbClient = createPgClient()
): Promise<XenditGatewayConfig> {
  const { data, error } = await db
    .from("payment_gateways", "configuration")
    .select("*")
    .eq("provider", "xendit")
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error("QRIS payment gateway is not configured. Set it in Settings → Payment Gateways.");
  }

  const row = data as PaymentGatewayRow;
  if (!row.is_active) {
    throw new Error("QRIS payment gateway is inactive. Enable it in Settings → Payment Gateways.");
  }
  if (!row.secret_key?.trim()) {
    throw new Error("Payment gateway secret key is missing.");
  }

  return {
    secretKey: row.secret_key.trim(),
    webhookToken: row.webhook_secret?.trim() || null,
    callbackUrl: row.callback_url?.trim() || null,
    environment: row.environment === "live" ? "live" : "sandbox",
  };
}

export async function createXenditDynamicQr(input: {
  secretKey: string;
  referenceId: string;
  amount: number;
  callbackUrl?: string | null;
  description?: string;
}): Promise<CreateXenditQrResult> {
  const body: Record<string, unknown> = {
    reference_id: input.referenceId,
    type: "DYNAMIC",
    currency: "IDR",
    amount: Math.round(input.amount),
  };
  if (input.callbackUrl) body.callback_url = input.callbackUrl;
  if (input.description) body.description = input.description;

  const auth = Buffer.from(`${input.secretKey}:`).toString("base64");
  const response = await fetch("https://api.xendit.co/qr_codes", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      "api-version": "2022-07-31",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      (typeof payload.message === "string" && payload.message) ||
      (typeof payload.error_code === "string" && payload.error_code) ||
      `Failed to create QRIS (${response.status})`;
    throw new Error(message);
  }

  const qrString = String(payload.qr_string || "");
  const id = String(payload.id || "");
  if (!qrString || !id) {
    throw new Error("Incomplete payment gateway response");
  }

  return {
    id,
    reference_id: String(payload.reference_id || input.referenceId),
    qr_string: qrString,
    status: String(payload.status || "ACTIVE"),
    amount: Number(payload.amount != null ? payload.amount : input.amount) || input.amount,
    expires_at: payload.expires_at ? String(payload.expires_at) : null,
    raw: payload,
  };
}

export function buildQrImageUrl(qrString: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrString)}`;
}

export async function getXenditQrCode(
  secretKey: string,
  qrId: string
): Promise<Record<string, unknown> & { id: string; status?: string }> {
  const auth = Buffer.from(`${secretKey}:`).toString("base64");
  const response = await fetch(`https://api.xendit.co/qr_codes/${encodeURIComponent(qrId)}`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      "api-version": "2022-07-31",
    },
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      (typeof payload.message === "string" && payload.message) ||
        `Failed to fetch QRIS status (${response.status})`
    );
  }
  return { ...payload, id: String(payload.id || qrId) };
}

export function extractXenditWebhookToken(request: Request): string | null {
  return (
    request.headers.get("x-callback-token") ||
    request.headers.get("X-CALLBACK-TOKEN") ||
    null
  );
}

export function verifyXenditWebhookToken(
  incoming: string | null,
  expected: string | null
): boolean {
  if (!expected) return true; // not configured → allow (dev flexibility)
  if (!incoming) return false;
  return incoming.trim() === expected.trim();
}

export function parseXenditQrWebhook(body: Record<string, unknown>) {
  const data =
    body.data && typeof body.data === "object"
      ? (body.data as Record<string, unknown>)
      : body;

  const status = String(data.status || body.status || "").toUpperCase();
  const qrId = String(
    data.qr_id || data.id || data.qr_code_id || body.qr_id || body.id || ""
  );
  const referenceId = String(
    data.reference_id || data.external_id || body.reference_id || body.external_id || ""
  );
  const amountRaw = data.amount != null ? data.amount : body.amount != null ? body.amount : 0;
  const amount = Number(amountRaw) || 0;
  const paymentId = String(data.payment_id || data.id || body.payment_id || "");

  const paid =
    status === "SUCCEEDED" ||
    status === "SUCCESS" ||
    status === "COMPLETED" ||
    status === "PAID" ||
    String(body.event || "").toLowerCase().includes("paid");

  return { paid, status, qrId, referenceId, amount, paymentId, data };
}

export { getErrorMessage as getXenditErrorMessage };
