/**
 * Notifikasi WA komplimen (permintaan owner 2026-08-24): SETIAP transaksi
 * FOC atau Owner Comp yang disetujui langsung dikabarkan ke nomor owner —
 * komplimen adalah uang yang "keluar" tanpa pembayaran, jadi owner tahu
 * seketika siapa yang menyetujui dan berapa nilainya.
 *
 * Best-effort & tidak boleh mengganggu pembayaran: dipanggil fire-and-forget
 * setelah transaksi tersimpan; gagal kirim hanya tercatat di log server.
 * Dedup lewat configuration.wa_notif_log (notif_type 'komplimen') — kejadian
 * yang sama tidak pernah terkirim dua kali walau route terpanggil ulang.
 */

import { getPool } from "@/lib/db";
import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";

/** Nomor tujuan tetap — permintaan owner (081809078014 → format 62). */
export const COMP_NOTIF_TARGET = "6281809078014";

const COMP_NOTIF_TYPE = "komplimen";

export interface CompNotifInput {
  compType: "foc_comp" | "owner_comp";
  /** Nomor order (POS-…) atau checkout (CHK-…) yang dikomplimenkan. */
  orderNumber: string;
  /** Jumlah anak-order bila checkout gabungan (>1 → dicantumkan). */
  orderCount?: number;
  /** Nilai gross (subtotal) yang digratiskan, dalam Rupiah. */
  grossIdr: number;
  approvedName?: string | null;
}

export function compNotifLabel(compType: CompNotifInput["compType"]): string {
  return compType === "foc_comp" ? "FOC (Free of Charge)" : "Owner Comp";
}

/** Pure & unit-testable — isi pesan WA-nya. */
export function buildCompNotifMessage(
  input: CompNotifInput,
  now: Date = new Date()
): string {
  const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
  const waktu = now.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const orderLine =
    input.orderCount && input.orderCount > 1
      ? `${input.orderNumber} (${input.orderCount} order)`
      : input.orderNumber;
  return [
    `Arkiv OS — Komplimen ${compNotifLabel(input.compType)}`,
    `Order : ${orderLine}`,
    `Nilai : ${rp(input.grossIdr)}`,
    `Disetujui : ${input.approvedName?.trim() || "-"}`,
    `${waktu} WIB`,
  ].join("\n");
}

/**
 * Kirim notifikasinya — aman dipanggil fire-and-forget:
 * `void notifyCompTransaction(...)` (semua error tertelan ke console).
 */
export async function notifyCompTransaction(input: CompNotifInput): Promise<void> {
  try {
    const message = buildCompNotifMessage(input);
    const dedupKey = `comp:${input.compType}:${input.orderNumber}`.slice(0, 160);

    // Klaim dedup SEBELUM kirim — route terpanggil dua kali → satu pesan.
    const claim = await getPool().query<{ id: string }>(
      `INSERT INTO configuration.wa_notif_log (notif_type, dedup_key, message, recipients)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (notif_type, dedup_key) DO NOTHING
       RETURNING id`,
      [COMP_NOTIF_TYPE, dedupKey, message, JSON.stringify([COMP_NOTIF_TARGET])]
    );
    if (claim.rows.length === 0) return; // duplikat — sudah pernah terkirim

    const release = () =>
      getPool()
        .query(`DELETE FROM configuration.wa_notif_log WHERE id = $1`, [
          claim.rows[0].id,
        ])
        .catch(() => {});

    const gateway = await loadGatewayConfig();
    if (!gateway) {
      console.warn("[wa-comp] gateway belum dikonfigurasi — notifikasi komplimen dilewati");
      await release();
      return;
    }

    const result = await sendGatewayText(gateway, {
      target: COMP_NOTIF_TARGET,
      message,
    });
    if (!result.success && !result.timedOut) {
      // Gagal jelas → lepas klaim; timeout (status tak pasti) → at-most-once.
      console.error(`[wa-comp] gagal kirim ke ${COMP_NOTIF_TARGET}: ${result.reason}`);
      await release();
    }
  } catch (err) {
    console.error("[wa-comp] notifikasi komplimen error:", err);
  }
}
