/**
 * Titik masuk tunggal pengiriman WhatsApp.
 *
 * Penyedia dipilih lewat env `WHATSAPP_PROVIDER` (`meta` | `fonnte`). Bila
 * kosong, penyedia ditentukan otomatis dari kredensial yang tersedia — Meta
 * didahulukan karena resmi. Bila tidak ada yang terkonfigurasi, pengiriman
 * mengembalikan gagal secara rapi (bukan melempar), sehingga alur pemanggil
 * seperti OTP tetap punya jalan keluar di dev.
 */

import { sendWhatsApp as sendViaFonnte } from "@/lib/fonnte";
import { readMetaConfig, sendMetaTemplate, sendMetaText } from "./meta";
import type { TemplateMessage, TextMessage, WhatsAppProvider, WhatsAppResult } from "./types";

export * from "./types";
export { buildTemplatePayload, buildTextPayload, extractMetaError } from "./meta";

export function resolveProvider(): WhatsAppProvider | null {
  const explicit = process.env.WHATSAPP_PROVIDER?.trim().toLowerCase();
  if (explicit === "meta") return readMetaConfig() ? "meta" : null;
  if (explicit === "fonnte") return process.env.FONNTE_API_KEY ? "fonnte" : null;

  if (readMetaConfig()) return "meta";
  if (process.env.FONNTE_API_KEY) return "fonnte";
  return null;
}

const NOT_CONFIGURED: WhatsAppResult = {
  success: false,
  reason: "WhatsApp provider belum dikonfigurasi",
};

export interface OtpMessageOptions {
  target: string;
  code: string;
  /** Teks lengkap untuk penyedia non-template (Fonnte). */
  fallbackText: string;
}

/**
 * Kirim kode OTP. Di Meta ini WAJIB lewat template AUTHENTICATION yang sudah
 * disetujui — nama & bahasanya dari env agar bisa diganti tanpa deploy.
 */
export async function sendWhatsAppOtp(options: OtpMessageOptions): Promise<WhatsAppResult> {
  const provider = resolveProvider();
  if (!provider) return NOT_CONFIGURED;

  if (provider === "meta") {
    const config = readMetaConfig();
    if (!config) return NOT_CONFIGURED;

    const withButton = process.env.META_WA_OTP_BUTTON !== "false";
    return sendMetaTemplate(config, {
      target: options.target,
      templateName: process.env.META_WA_OTP_TEMPLATE || "otp_login",
      languageCode: process.env.META_WA_OTP_LANG || "id",
      bodyParameters: [options.code],
      copyCodeButton: withButton ? options.code : undefined,
    });
  }

  const result = await sendViaFonnte({ target: options.target, message: options.fallbackText });
  return { ...result, provider: "fonnte" };
}

/**
 * Kirim teks bebas (notifikasi rekrutmen, slip gaji, dsb).
 *
 * PERHATIAN: di Meta ini hanya lolos dalam jendela layanan 24 jam. Untuk pesan
 * yang diinisiasi bisnis, buat template lalu pakai `sendWhatsAppTemplate`.
 */
export async function sendWhatsAppText(message: TextMessage): Promise<WhatsAppResult> {
  const provider = resolveProvider();
  if (!provider) return NOT_CONFIGURED;

  if (provider === "meta") {
    const config = readMetaConfig();
    if (!config) return NOT_CONFIGURED;
    return sendMetaText(config, message);
  }

  const result = await sendViaFonnte(message);
  return { ...result, provider: "fonnte" };
}

/** Kirim template Meta apa pun. Tidak berlaku untuk Fonnte. */
export async function sendWhatsAppTemplate(
  message: TemplateMessage
): Promise<WhatsAppResult> {
  const config = readMetaConfig();
  if (!config) return NOT_CONFIGURED;
  return sendMetaTemplate(config, message);
}
