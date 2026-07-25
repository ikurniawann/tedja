import type { Pool, PoolClient } from "pg";
import {
  blockerMessage,
  entitlementQuota,
  evaluateCollectibleGate,
  parseIntervalXp,
  remainingEntitlements,
} from "./collectibles";

/**
 * EPIC-014 — logika koleksi (artwork) member.
 *
 * Modul ini sengaja menjadi SATU-SATUNYA tempat aturan koleksi tinggal.
 * Skema memakai tabel terpisah per jenis aset (avatar, nanti wallpaper dan
 * badge), jadi yang boleh terduplikasi hanya tabel dan CRUD-nya — bukan
 * aturan kelayakan, kepemilikan, maupun stok. Tanpa disiplin ini ketiganya
 * akan menyimpang satu sama lain.
 *
 * Sumber XP: `pos.pos_customers.total_xp`, mengikuti modul reward dan angka
 * yang sudah ditampilkan portal. Kolom `crm.crm_member_profiles.lifetime_xp`
 * TIDAK dipakai karena kedua nilai itu terbukti bisa menyimpang.
 *
 * Fase ini belum menukar apa pun: XP hanya menentukan kelayakan, dan tidak
 * pernah berkurang.
 */

export type Rarity = "common" | "rare" | "epic" | "legendary" | "limited";

/** Urutan tampil — yang paling langka tampil lebih dulu. */
const RARITY_RANK: Record<Rarity, number> = {
  limited: 0,
  legendary: 1,
  epic: 2,
  rare: 3,
  common: 4,
};

export const RARITY_LABELS: Record<Rarity, string> = {
  limited: "Terbatas",
  legendary: "Legendaris",
  epic: "Epik",
  rare: "Langka",
  common: "Umum",
};

export type MemberCollectible = {
  id: string;
  code: string;
  name: string;
  rarity: Rarity;
  image_url: string;
  thumbnail_url: string | null;
  required_tier_name: string | null;
  /** Sisa stok; null berarti tak terbatas. */
  remaining_stock: number | null;
  owned: boolean;
  equipped: boolean;
  acquired_at: string | null;
  /** Alasan terkunci untuk ditampilkan apa adanya ke member. */
  locked_reason: string | null;
  /** Kekurangan XP menuju syarat; 0 bila syarat sudah terpenuhi. */
  xp_needed: number;
};

type CatalogRow = {
  id: string;
  code: string;
  name: string;
  rarity: string;
  image_url: string;
  thumbnail_url: string | null;
  required_tier_name: string | null;
  required_tier_min_xp: number | null;
  min_lifetime_xp: number | null;
  stock_total: number | null;
  stock_redeemed: number | null;
  is_active: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  inventory_id: string | null;
  is_equipped: boolean | null;
  acquired_at: Date | null;
};

function normalizeRarity(value: string | null): Rarity {
  return value != null && value in RARITY_RANK ? (value as Rarity) : "common";
}

function toIso(value: Date | null): string | null {
  return value == null ? null : new Date(value).toISOString();
}

/**
 * Katalog dari sudut pandang satu member.
 *
 * Artwork yang SUDAH dimiliki selalu ikut tampil walau sudah tidak aktif atau
 * jendela waktunya lewat — koleksi yang sudah didapat tidak boleh hilang dari
 * mata pemiliknya.
 */
export async function listCollectiblesForMember(
  db: Pool | PoolClient,
  memberProfileId: string | null
): Promise<CatalogRow[]> {
  const { rows } = await db.query(
    `SELECT a.id, a.code, a.name, a.rarity, a.image_url, a.thumbnail_url,
            a.stock_total, a.stock_redeemed, a.is_active, a.starts_at, a.ends_at,
            a.min_lifetime_xp::int AS min_lifetime_xp,
            t.name AS required_tier_name,
            t.min_lifetime_xp::int AS required_tier_min_xp,
            inv.id AS inventory_id, inv.is_equipped, inv.acquired_at
       FROM crm.crm_collectible_avatars a
       LEFT JOIN crm.crm_membership_tiers t ON t.id = a.required_tier_id
       LEFT JOIN crm.crm_member_avatar_inventory inv
              ON inv.avatar_id = a.id AND inv.member_id = $1
      WHERE inv.id IS NOT NULL
         OR (a.is_active
             AND (a.starts_at IS NULL OR a.starts_at <= now())
             AND (a.ends_at IS NULL OR a.ends_at >= now()))`,
    [memberProfileId]
  );

  return rows as CatalogRow[];
}

/**
 * Kelayakan satu artwork bagi member.
 *
 * Fase ini hanya menjelaskan syarat kepada member; penukaran belum ada.
 * Stok habis tetap dilaporkan agar member tidak mengejar sesuatu yang mustahil.
 */
export function evaluateCollectible(row: CatalogRow, totalXp: number): MemberCollectible {
  const owned = row.inventory_id != null;
  const stockTotal = row.stock_total == null ? null : Number(row.stock_total);
  const stockRedeemed = Number(row.stock_redeemed ?? 0);
  const remainingStock = stockTotal == null ? null : Math.max(0, stockTotal - stockRedeemed);
  // Syarat efektif = ambang tier ATAU ambang artwork (Task 2), yang tertinggi.
  const tierXp = row.required_tier_min_xp == null ? 0 : Number(row.required_tier_min_xp);
  const artXp = row.min_lifetime_xp == null ? 0 : Number(row.min_lifetime_xp);
  const requiredXp = Math.max(tierXp, artXp);
  const xpNeeded = Math.max(0, requiredXp - totalXp);

  // Aturan unlock dari modul bersama (Task 4) — jangan menyalin logikanya.
  let lockedReason: string | null = null;
  if (!owned) {
    const gate = evaluateCollectibleGate(totalXp, {
      isActive: true, // baris tak aktif/di luar jendela sudah tersaring query
      minLifetimeXp: requiredXp,
      stockRemaining: remainingStock,
    });
    if (!gate.allowed && gate.blocker) {
      // Ambang yang menghalangi berasal dari tier → sebut nama tiernya.
      lockedReason =
        gate.blocker === "below_min_xp" && tierXp >= artXp && row.required_tier_name
          ? `Perlu tier ${row.required_tier_name}`
          : blockerMessage(gate.blocker, { totalXp, minXp: requiredXp, tierName: row.required_tier_name });
    } else {
      lockedReason = "Belum kamu miliki";
    }
  }

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    rarity: normalizeRarity(row.rarity),
    image_url: row.image_url,
    thumbnail_url: row.thumbnail_url,
    required_tier_name: row.required_tier_name,
    remaining_stock: remainingStock,
    owned,
    equipped: row.is_equipped === true,
    acquired_at: toIso(row.acquired_at),
    locked_reason: lockedReason,
    xp_needed: xpNeeded,
  };
}

export interface EntitlementSummary {
  interval_xp: number;
  quota: number;
  used: number;
  remaining: number;
}

/**
 * Ringkasan jatah tukar member (EPIC-014 Task 2). Dihitung saat dibaca —
 * tanpa backfill: `floor(total_xp / interval) − terpakai`, dijepit ke 0.
 */
export async function getEntitlementSummary(
  db: Pool | PoolClient,
  customerId: string,
  totalXp: number
): Promise<EntitlementSummary> {
  const [settingRes, usedRes] = await Promise.all([
    db.query(`SELECT value FROM crm.crm_settings WHERE key = 'collectible_interval_xp'`),
    db.query(`SELECT count(*)::int AS used FROM crm.crm_member_entitlements WHERE customer_id = $1`, [
      customerId,
    ]),
  ]);
  const intervalXp = parseIntervalXp(settingRes.rows[0]?.value);
  const used = Number(usedRes.rows[0]?.used ?? 0);
  return {
    interval_xp: intervalXp,
    quota: entitlementQuota(totalXp, intervalXp),
    used,
    remaining: remainingEntitlements(totalXp, intervalXp, used),
  };
}

/**
 * Kelayakan grant/redeem satu avatar untuk satu customer — dipakai jalur
 * admin grant (dan redeem member di Task 3) supaya `required_tier_id` +
 * `min_lifetime_xp` ditegakkan di SEMUA jalur perolehan, bukan hanya portal.
 */
export async function checkAvatarEligibility(
  db: Pool | PoolClient,
  avatarId: string,
  customerId: string
): Promise<{ allowed: boolean; reason: string | null }> {
  const { rows } = await db.query(
    `SELECT a.is_active, a.starts_at, a.ends_at, a.stock_total, a.stock_redeemed,
            a.min_lifetime_xp::int AS min_lifetime_xp,
            t.name AS required_tier_name,
            t.min_lifetime_xp::int AS required_tier_min_xp,
            c.total_xp::int AS total_xp
       FROM crm.crm_collectible_avatars a
       LEFT JOIN crm.crm_membership_tiers t ON t.id = a.required_tier_id
       CROSS JOIN pos.pos_customers c
      WHERE a.id = $1 AND c.id = $2`,
    [avatarId, customerId]
  );
  const row = rows[0] as
    | {
        is_active: boolean;
        starts_at: Date | null;
        ends_at: Date | null;
        stock_total: number | null;
        stock_redeemed: number | null;
        min_lifetime_xp: number | null;
        required_tier_name: string | null;
        required_tier_min_xp: number | null;
        total_xp: number;
      }
    | undefined;
  if (!row) return { allowed: false, reason: "Artwork atau member tidak ditemukan" };

  const totalXp = Number(row.total_xp ?? 0);
  const requiredXp = Math.max(Number(row.required_tier_min_xp ?? 0), Number(row.min_lifetime_xp ?? 0));
  const stockTotal = row.stock_total == null ? null : Number(row.stock_total);
  const gate = evaluateCollectibleGate(totalXp, {
    isActive: row.is_active,
    minLifetimeXp: requiredXp,
    stockRemaining: stockTotal == null ? null : Math.max(0, stockTotal - Number(row.stock_redeemed ?? 0)),
    startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
  });
  if (gate.allowed || !gate.blocker) return { allowed: true, reason: null };
  return {
    allowed: false,
    reason: blockerMessage(gate.blocker, {
      totalXp,
      minXp: requiredXp,
      tierName: row.required_tier_name,
    }),
  };
}

/** Dimiliki lebih dulu, lalu yang paling langka, lalu abjad. */
export function sortCollectibles(items: MemberCollectible[]): MemberCollectible[] {
  return [...items].sort((a, b) => {
    if (a.owned !== b.owned) return a.owned ? -1 : 1;
    const rarityGap = RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity];
    if (rarityGap !== 0) return rarityGap;
    return a.name.localeCompare(b.name, "id");
  });
}

export type EquipResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Pasang artwork sebagai avatar aktif.
 *
 * Dibungkus transaksi karena menyentuh dua tabel: penanda `is_equipped` di
 * inventory dan `active_avatar_id` di profil. Bila salah satu gagal, keduanya
 * harus batal agar tidak ada avatar terpasang yang tidak tercatat.
 */
export async function equipCollectible(
  pool: Pool,
  params: { memberProfileId: string; avatarId: string }
): Promise<EquipResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id FROM crm.crm_member_avatar_inventory
        WHERE member_id = $1 AND avatar_id = $2
        FOR UPDATE`,
      [params.memberProfileId, params.avatarId]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, status: 403, error: "Artwork ini belum kamu miliki" };
    }

    await client.query(
      `UPDATE crm.crm_member_avatar_inventory
          SET is_equipped = (avatar_id = $2)
        WHERE member_id = $1`,
      [params.memberProfileId, params.avatarId]
    );

    await client.query(
      `UPDATE crm.crm_member_profiles
          SET active_avatar_id = $2, last_activity_at = now()
        WHERE id = $1`,
      [params.memberProfileId, params.avatarId]
    );

    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
