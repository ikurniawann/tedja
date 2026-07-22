/**
 * EPIC-020 Fase B — pengawas berkala notifikasi WA owner:
 * - Ringkasan harian: terkirim sekali per hari WIB begitu jam menyentuh
 *   `digestHour` (dedup key = tanggal — restart server tidak mengirim ulang).
 * - Stok habis: bahan aktif dengan qty_available ≤ 0 → satu pesan gabungan;
 *   dedup 1×/bahan/hari (bahan yang masih nol besok diingatkan lagi).
 *
 * Void besar TIDAK di sini — dia event, dikait langsung di route void POS.
 */

import { query } from "@/lib/db";
import { buildDesktopOverview } from "@/lib/desktop/overview";
import {
  buildDigestMessage,
  buildStokHabisMessage,
  digestDedupKey,
  hourWib,
  stokHabisDedupKey,
  todayWib,
} from "./notifications-messages";
import {
  claimNotifKeys,
  deliverToRecipients,
  getWaNotifConfig,
  releaseNotifKeys,
  sendOwnerNotification,
} from "./notifications-sender";

const CHECK_INTERVAL_MS = 5 * 60_000;

async function maybeSendDigest(): Promise<void> {
  const config = await getWaNotifConfig();
  if (!config.enabled || !config.types.digest) return;
  if (hourWib() < config.digestHour) return;

  const date = todayWib();
  // Cek murah sebelum membangun overview (5 query agregasi) — klaim di
  // sender tetap penjaga akhirnya.
  const existing = await query<{ id: string }>(
    `SELECT id FROM configuration.wa_notif_log
      WHERE notif_type = 'digest' AND dedup_key = $1`,
    [digestDedupKey(date)]
  );
  if (existing.length > 0) return;

  const overview = await buildDesktopOverview();
  const result = await sendOwnerNotification({
    type: "digest",
    dedupKey: digestDedupKey(date),
    message: buildDigestMessage(overview, date),
    config,
  });
  if (result.sent) {
    console.log(`[wa-notif] ringkasan harian ${date} terkirim`);
  }
}

async function maybeSendStokHabis(): Promise<void> {
  const config = await getWaNotifConfig();
  if (!config.enabled || !config.types.stokHabis) return;

  // Definisi mengikuti fetchLowStock desktop, dipersempit ke NOL persis.
  const rows = await query<{ id: string; nama: string; satuan: string | null }>(
    `SELECT rm.id, rm.nama, rm.satuan
       FROM inventory.inventory i
       JOIN item.raw_materials rm ON rm.id = i.raw_material_id
      WHERE i.is_active
        AND rm.deleted_at IS NULL
        AND i.qty_available <= 0
      ORDER BY rm.nama`
  );
  if (rows.length === 0) return;
  if (config.recipients.length === 0) return;

  const date = todayWib();
  // Klaim per bahan (dedup 1×/bahan/hari), lalu SATU pesan gabungan berisi
  // hanya bahan yang berhasil diklaim — 20 bahan habis ≠ 20 pesan WA, dan
  // bahan yang baru habis siang hari tetap diberitakan susulan.
  const byKey = new Map(rows.map((r) => [stokHabisDedupKey(r.id, date), r]));
  const message = buildStokHabisMessage(
    rows.map((r) => ({ nama: r.nama, satuan: r.satuan }))
  );
  const claimed = await claimNotifKeys(
    "stokHabis",
    [...byKey.keys()].map((dedupKey) => ({ dedupKey, message })),
    config.recipients
  );
  if (claimed.length === 0) return;

  const freshItems = claimed.map((c) => {
    const row = byKey.get(c.dedupKey)!;
    return { nama: row.nama, satuan: row.satuan };
  });
  const { delivered, timedOut } = await deliverToRecipients(
    config,
    buildStokHabisMessage(freshItems)
  );
  if (delivered === 0 && !timedOut) {
    // Gagal jelas → lepas klaim, dicoba lagi tick berikut.
    await releaseNotifKeys(claimed.map((c) => c.id));
    return;
  }
  console.log(
    `[wa-notif] peringatan stok habis terkirim (${freshItems.length} bahan)`
  );
}

let started = false;

/** Daftarkan pengecekan berkala — sekali per proses server (pola watcher lain). */
export function startWaNotifWatcher(): void {
  if (started) return;
  started = true;

  const tick = () => {
    maybeSendDigest().catch((error) => {
      console.error("[wa-notif] digest gagal:", error);
    });
    maybeSendStokHabis().catch((error) => {
      console.error("[wa-notif] cek stok habis gagal:", error);
    });
  };
  // Delay saat boot agar pool & gateway siap, lalu tiap 5 menit.
  setTimeout(tick, 45_000);
  setInterval(tick, CHECK_INTERVAL_MS);
}
