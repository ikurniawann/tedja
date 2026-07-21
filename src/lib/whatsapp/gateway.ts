/**
 * Penyedia `gateway` — service WhatsApp mandiri milik sendiri
 * (`services/wa-gateway`, Baileys) yang berjalan sebagai proses PM2 terpisah.
 *
 * Dipisah dari aplikasi Next.js dengan sengaja: koneksi WhatsApp harus hidup
 * terus-menerus, sedangkan aplikasi ini di-restart setiap deploy — kalau
 * disatukan, sesi WhatsApp putus tiap kali rilis.
 */

import type { TextMessage, WhatsAppResult } from "./types";

export interface GatewayConfig {
  baseUrl: string;
  token: string;
  timeoutMs: number;
}

export function readGatewayConfig(): GatewayConfig | null {
  const token = process.env.WA_GATEWAY_TOKEN;
  if (!token) return null;

  return {
    baseUrl: process.env.WA_GATEWAY_URL || "http://127.0.0.1:3471",
    token,
    timeoutMs: Number(process.env.WA_GATEWAY_TIMEOUT_MS || 20000),
  };
}

async function callGateway(
  config: GatewayConfig,
  path: string,
  init: RequestInit
): Promise<{ ok: boolean; status: number; data: unknown }> {
  // Gateway memberi jeda antar pesan, jadi permintaan bisa menunggu beberapa
  // detik. Timeout tetap dipasang supaya request aplikasi tidak menggantung.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-gateway-token": config.token,
        ...(init.headers ?? {}),
      },
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendGatewayText(
  config: GatewayConfig,
  message: TextMessage
): Promise<WhatsAppResult> {
  try {
    const { ok, data } = await callGateway(config, "/send", {
      method: "POST",
      body: JSON.stringify({ target: message.target, message: message.message }),
    });

    if (!ok) {
      const reason =
        (data as { error?: string })?.error ?? "Gateway menolak permintaan kirim";
      return { success: false, provider: "gateway", reason };
    }

    return {
      success: true,
      provider: "gateway",
      messageId: (data as { messageId?: string })?.messageId ?? undefined,
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    const reason = isTimeout
      ? "Gateway tidak merespons (timeout)"
      : error instanceof Error
        ? error.message
        : "Unknown error";
    return { success: false, provider: "gateway", reason, timedOut: isTimeout };
  }
}

export interface GatewayStatus {
  connected: boolean;
  phone: string | null;
  needsPairing: boolean;
  lastConnectedAt: string | null;
  lastDisconnectReason: string | null;
}

/** Status koneksi gateway — untuk halaman monitoring/diagnosa. */
export async function getGatewayStatus(
  config: GatewayConfig
): Promise<GatewayStatus | null> {
  try {
    const { data } = await callGateway(config, "/health", { method: "GET" });
    if (!data || typeof data !== "object") return null;
    return data as GatewayStatus;
  } catch {
    return null;
  }
}
