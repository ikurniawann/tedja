/**
 * EPIC-022 Fase C — pengingat WA follow-up jatuh tempo.
 *
 * Setiap beberapa menit mencari aktivitas yang sudah jatuh tempo, belum
 * selesai, dan belum pernah diingatkan, lalu mengirim WA ke penanggung
 * jawabnya (nomor dari hris.employees via user_id). Idempotensi dijaga
 * dengan mengklaim reminder_sent_at SEBELUM kirim (acceptance criteria:
 * terkirim maksimal 1x per aktivitas) — bila gateway menolak dengan jelas,
 * klaim dilepas agar dicoba lagi; bila timeout (status kirim tak pasti),
 * klaim dipertahankan demi at-most-once.
 */

import { getPool } from "@/lib/db";
import { loadGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import { normalizePhone, isValidNormalizedPhone } from "./server";

const CHECK_INTERVAL_MS = 5 * 60_000;
// Batas kirim per tick — jaga aktivitas nomor gateway tetap wajar
const MAX_REMINDERS_PER_TICK = 10;

type ReminderRow = {
  id: string;
  activity_type: string;
  notes: string | null;
  due_at: string;
  owner_name: string | null;
  owner_phone: string | null;
  deal_title: string | null;
  org_name: string | null;
  pic_name: string | null;
};

function buildReminderMessage(row: ReminderRow): string {
  const subject = row.deal_title
    ? `deal "${row.deal_title}"${row.org_name ? ` (${row.org_name})` : ""}`
    : `lead ${row.org_name ?? "-"}`;
  const due = new Date(row.due_at).toLocaleString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const lines = [
    `⏰ *Pengingat Follow-up Sales*`,
    ``,
    `${row.activity_type.toUpperCase()} — ${subject}`,
    row.pic_name ? `PIC: ${row.pic_name}` : null,
    `Jatuh tempo: ${due}`,
    row.notes ? `Catatan: ${row.notes.slice(0, 300)}` : null,
    ``,
    `Buka menu Sales Funneling → Follow-up Hari Ini untuk menandai selesai.`,
  ];
  return lines.filter((line) => line !== null).join("\n");
}

export async function sendDueFollowupReminders(): Promise<{ sent: number }> {
  const config = await loadGatewayConfig();
  if (!config) return { sent: 0 };

  const pool = getPool();

  // Klaim atomik: set reminder_sent_at lebih dulu supaya dua proses/tick
  // tidak pernah mengirim pengingat yang sama dua kali.
  const claimed = await pool.query<{ id: string }>(
    `UPDATE crm.crm_sales_activities
        SET reminder_sent_at = now(), updated_at = now()
      WHERE id IN (
        SELECT id FROM crm.crm_sales_activities
         WHERE deleted_at IS NULL
           AND done_at IS NULL
           AND reminder_sent_at IS NULL
           AND owner_user_id IS NOT NULL
           AND due_at IS NOT NULL
           AND due_at <= now()
         ORDER BY due_at ASC
         LIMIT ${MAX_REMINDERS_PER_TICK}
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id`
  );
  if (claimed.rows.length === 0) return { sent: 0 };

  // Klaim yang belum tuntas diproses — dilepas kembali bila terjadi
  // exception tak terduga supaya pengingatnya tidak hilang selamanya.
  const pendingIds = new Set(claimed.rows.map((r) => r.id));
  let sent = 0;

  try {
    // Nomor PJ via subquery skalar (bukan JOIN) — hris.employees.user_id
    // tidak UNIQUE; JOIN bisa menduplikasi baris aktivitas dan membuat
    // pengingat yang sama terkirim dua kali dalam satu tick.
    const { rows } = await pool.query<ReminderRow>(
      `SELECT a.id, a.activity_type, a.notes, a.due_at,
              u.full_name AS owner_name,
              (SELECT e.phone FROM hris.employees e
                WHERE e.user_id = u.id AND e.phone IS NOT NULL
                ORDER BY e.created_at DESC LIMIT 1) AS owner_phone,
              d.title AS deal_title,
              COALESCE(dl.org_name, l.org_name) AS org_name,
              COALESCE(dl.pic_name, l.pic_name) AS pic_name
         FROM crm.crm_sales_activities a
         JOIN configuration.users u ON u.id = a.owner_user_id
         LEFT JOIN crm.crm_sales_deals d ON d.id = a.deal_id
         LEFT JOIN crm.crm_sales_leads dl ON dl.id = d.lead_id
         LEFT JOIN crm.crm_sales_leads l ON l.id = a.lead_id
        WHERE a.id = ANY($1::uuid[])`,
      [claimed.rows.map((r) => r.id)]
    );

    for (const row of rows) {
      const phone = row.owner_phone ? normalizePhone(row.owner_phone) : "";
      if (!isValidNormalizedPhone(phone)) {
        // Tanpa nomor valid pengingat tidak mungkin terkirim — biarkan
        // terklaim supaya tidak dicek ulang setiap tick selamanya.
        console.warn(
          `[sales-followup] lewati aktivitas ${row.id}: nomor WA penanggung jawab tidak valid`
        );
        pendingIds.delete(row.id);
        continue;
      }

      const result = await sendGatewayText(config, {
        target: phone,
        message: buildReminderMessage(row),
      });

      if (result.success) {
        sent += 1;
        pendingIds.delete(row.id);
        continue;
      }

      if (result.timedOut) {
        // Status kirim tak pasti → klaim dipertahankan, at-most-once menang.
        pendingIds.delete(row.id);
      } else {
        // Gagal jelas (gateway menolak) → lepas klaim agar dicoba tick berikut.
        await pool.query(
          `UPDATE crm.crm_sales_activities
              SET reminder_sent_at = NULL, updated_at = now()
            WHERE id = $1`,
          [row.id]
        );
        pendingIds.delete(row.id);
      }
      console.error(
        `[sales-followup] gagal kirim pengingat aktivitas ${row.id}: ${result.reason}`
      );
    }
  } finally {
    // Baris terklaim yang belum sempat diproses (exception di tengah jalan)
    // dilepas kembali — tanpa ini pengingatnya hilang permanen.
    if (pendingIds.size > 0) {
      try {
        await pool.query(
          `UPDATE crm.crm_sales_activities
              SET reminder_sent_at = NULL, updated_at = now()
            WHERE id = ANY($1::uuid[])`,
          [Array.from(pendingIds)]
        );
      } catch (rollbackError) {
        console.error(
          `[sales-followup] GAGAL melepas klaim ${pendingIds.size} aktivitas ` +
            `(${Array.from(pendingIds).join(", ")}) — perlu reset manual:`,
          rollbackError
        );
      }
    }
  }

  if (sent > 0) {
    console.log(`[sales-followup] ${sent} pengingat follow-up terkirim`);
  }
  return { sent };
}

let started = false;

/** Daftarkan pengecekan berkala — sekali per proses server (pola cs-sla-watcher). */
export function startSalesFollowupWatcher(): void {
  if (started) return;
  started = true;

  const tick = () => {
    sendDueFollowupReminders().catch((error) => {
      console.error("[sales-followup] gagal:", error);
    });
  };
  // Delay saat boot agar pool & gateway siap, lalu tiap 5 menit.
  setTimeout(tick, 30_000);
  setInterval(tick, CHECK_INTERVAL_MS);
}
