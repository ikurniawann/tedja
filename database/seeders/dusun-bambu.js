#!/usr/bin/env node
/**
 * Seeder TENANT DUSUN BAMBU — bagian 1: bisnis, outlet, departemen, modul
 * Resort, meja/saung POS, dan user demo (data lokal, owner 2026-09-06).
 *
 * Referensi profil: dusunbambu.id — destinasi keluarga 15 ha di kaki Gunung
 * Burangrang dengan 4 restoran bertema, resort (Cabin & Kampung Layung), dan
 * aktivitas keluarga (Bandung Playground, wahana danau).
 *
 * Mengisi (idempoten, satu transaksi, HANYA database lokal):
 *   - configuration.companies/branches/warehouses : Dusun Bambu → Lembang → 8 outlet
 *   - hris.departments                            : departemen khas resort/atraksi
 *   - resort.room_types / rooms / rate_dates      : 6 tipe kamar, 30 unit, musim tarif
 *   - resort.reservations (+rooms, folio)         : 5 contoh reservasi lintas status
 *   - pos.pos_tables                              : saung Purbasari, sarang Lutung Kasarung, meja Burangrang
 *   - auth.users + configuration.users            : demo@dusunbambu.id (scope cabang Dusun Bambu)
 *
 * Jalankan berurutan:
 *   npm run db:seed:dusun-bambu            (bagian 1 + F&B + ticketing)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");
const {
  HOLDING_CODE, COMPANY_CODE, BRANCH_CODE, COMPANY_NAME, BRANCH_NAME, loadEnv, ensureScope,
} = require("./lib/dusun-bambu-scope");

const DEMO_EMAIL = process.env.DUSUN_BAMBU_EMAIL || "demo@dusunbambu.id";
const DEMO_PASSWORD = process.env.DUSUN_BAMBU_PASSWORD || "dusunbambu";

// ── Outlet (gudang/lokasi jual) ────────────────────────────────────────────
const OUTLETS = [
  ["MAIN", "Main Storage", true],
  ["RESTO-BRG", "Burangrang Restaurant", false],
  ["RESTO-LMU", "Lembur Urang Restaurant", false],
  ["RESTO-PBS", "Purbasari Restaurant", false],
  ["RESTO-LTK", "Lutung Kasarung Restaurant", false],
  ["BEBEK-KBY", "Bebek Kabayan", false],
  ["PLAYGROUND", "Bandung Playground", false],
  ["RESORT-FO", "Resort Front Office", false],
];

const DEPARTMENTS = [
  ["RESORT-FO", "Resort & Front Office", "Reservasi, check-in/out, folio tamu menginap"],
  ["HOUSEKEEPING", "Housekeeping", "Kebersihan kamar, linen, area publik"],
  ["TICKETING", "Ticketing & Activity", "Loket, gate, wahana, Bandung Playground"],
  ["LANDSCAPE", "Landscape & Garden", "Taman, danau, kebun bunga"],
];

// ── Tipe kamar (dua kawasan: Cabin & Kampung Layung) ───────────────────────
// [code, nama, zona, dewasa, anak, extraBedMax, weekday, weekend, extraBedRate, fasilitas, unit]
const ROOM_TYPES = [
  ["CB-SGL", "Single Cabin", "Cabin Area", 4, 2, 1, 1_800_000, 2_300_000, 350_000,
    ["1 kamar tidur", "1 ruang keluarga", "2 kamar mandi", "Bonfire outdoor"], 5],
  ["CB-FAM", "Family Cabin", "Cabin Area", 6, 3, 2, 2_500_000, 3_200_000, 350_000,
    ["2 kamar tidur", "1 ruang keluarga", "1 kamar mandi", "Bonfire outdoor"], 4],
  ["CB-DBL", "Double Cabin", "Cabin Area", 8, 4, 2, 3_200_000, 4_000_000, 350_000,
    ["2 kamar tidur", "2 ruang keluarga", "2 kamar mandi", "Bonfire outdoor"], 3],
  ["KL-VLG", "Village Residence", "Kampung Layung", 2, 1, 1, 2_200_000, 2_900_000, 400_000,
    ["1 kamar tidur", "Ruang keluarga", "Pantry", "Bonfire", "Hot tub"], 8],
  ["KL-DLX", "Deluxe Residence", "Kampung Layung", 4, 2, 1, 2_800_000, 3_600_000, 400_000,
    ["1 kamar tidur", "Ruang keluarga", "Pantry", "Bonfire", "Hot tub privat"], 6],
  ["KL-FAM", "Family Residence", "Kampung Layung", 6, 3, 2, 3_500_000, 4_500_000, 400_000,
    ["2 kamar tidur", "Ruang keluarga", "Pantry", "Bonfire", "Hot tub privat"], 4],
];

// ── Meja / saung POS ───────────────────────────────────────────────────────
const TABLES = [
  ...Array.from({ length: 10 }, (_, i) => [`DB-PBS-${String(i + 1).padStart(2, "0")}`, `Saung Purbasari ${i + 1}`, "Purbasari (lesehan tepi danau)", 8]),
  ...Array.from({ length: 6 }, (_, i) => [`DB-LTK-${String(i + 1).padStart(2, "0")}`, `Sarang Lutung ${i + 1}`, "Lutung Kasarung (sarang di pohon)", 4]),
  ...Array.from({ length: 8 }, (_, i) => [`DB-BRG-${String(i + 1).padStart(2, "0")}`, `Meja Burangrang ${i + 1}`, "Burangrang (indoor & meeting)", 6]),
];

const ymd = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000);
const token = () => crypto.randomBytes(24).toString("hex");

async function seedOutlets(c, scope) {
  const ids = {};
  for (const [code, name, isDefault] of OUTLETS) {
    const { rows } = await c.query(
      `INSERT INTO configuration.warehouses (branch_id, code, name, is_default, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (branch_id, code) DO UPDATE
         SET name = EXCLUDED.name, is_default = EXCLUDED.is_default, is_active = true, updated_at = NOW()
       RETURNING id`,
      [scope.branch_id, code, name, isDefault]
    );
    ids[code] = rows[0].id;
  }
  return ids;
}

async function seedDepartments(c) {
  let added = 0;
  for (const [code, name, description] of DEPARTMENTS) {
    const { rowCount } = await c.query(
      `INSERT INTO hris.departments (name, code, description, is_active)
       SELECT $1, $2, $3, true
       WHERE NOT EXISTS (SELECT 1 FROM hris.departments WHERE lower(name) = lower($1))`,
      [name, code, description]
    );
    added += rowCount;
  }
  return added;
}

async function seedResort(c, scope, userId) {
  // Bersihkan data demo lama supaya bisa dijalankan ulang
  await c.query(
    `DELETE FROM resort.reservations WHERE branch_id = $1 AND reservation_code LIKE 'RSV-DEMO%'`,
    [scope.branch_id]
  );
  await c.query(`DELETE FROM resort.rate_dates WHERE branch_id = $1 AND label LIKE 'DEMO %'`, [scope.branch_id]);

  const typeIds = {};
  for (const [i, t] of ROOM_TYPES.entries()) {
    const [code, name, zone, adults, children, extraBedMax, weekday, weekend, extraBedRate, amenities, units] = t;
    const { rows } = await c.query(
      `INSERT INTO resort.room_types
         (company_id, branch_id, code, name, description, zone, capacity_adults, capacity_children,
          extra_bed_capacity, rate_weekday, rate_weekend, extra_bed_rate, amenities, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (branch_id, code) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description, zone = EXCLUDED.zone,
         capacity_adults = EXCLUDED.capacity_adults, capacity_children = EXCLUDED.capacity_children,
         extra_bed_capacity = EXCLUDED.extra_bed_capacity, rate_weekday = EXCLUDED.rate_weekday,
         rate_weekend = EXCLUDED.rate_weekend, extra_bed_rate = EXCLUDED.extra_bed_rate,
         amenities = EXCLUDED.amenities, sort_order = EXCLUDED.sort_order, is_active = true, updated_at = now()
       RETURNING id`,
      [scope.company_id, scope.branch_id, code, name, `${amenities.join(", ")} — kawasan ${zone}`, zone,
       adults, children, extraBedMax, weekday, weekend, extraBedRate, amenities, (i + 1) * 10, userId]
    );
    typeIds[code] = rows[0].id;

    for (let n = 1; n <= units; n += 1) {
      const roomCode = `${code}-${String(n).padStart(2, "0")}`;
      await c.query(
        `INSERT INTO resort.rooms (company_id, branch_id, room_type_id, code, name, zone, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (branch_id, code) DO UPDATE SET
           room_type_id = EXCLUDED.room_type_id, name = EXCLUDED.name, zone = EXCLUDED.zone,
           is_active = true, updated_at = now()`,
        [scope.company_id, scope.branch_id, rows[0].id, roomCode, `${name} ${n}`, zone, userId]
      );
    }
  }

  // Musim tarif: libur akhir tahun & libur sekolah
  const year = new Date().getFullYear();
  await c.query(
    `INSERT INTO resort.rate_dates (company_id, branch_id, room_type_id, label, start_date, end_date, surcharge_percent, created_by)
     VALUES ($1,$2,NULL,'DEMO Libur Akhir Tahun',$3,$4,25,$5),
            ($1,$2,NULL,'DEMO Libur Sekolah',$6,$7,15,$5)`,
    [scope.company_id, scope.branch_id, `${year}-12-24`, `${year + 1}-01-04`, userId, `${year}-06-20`, `${year}-07-10`]
  );

  // Contoh reservasi lintas status
  const roomsByType = {};
  for (const code of Object.keys(typeIds)) {
    const { rows } = await c.query(
      `SELECT id, name FROM resort.rooms WHERE branch_id = $1 AND room_type_id = $2 ORDER BY code`,
      [scope.branch_id, typeIds[code]]
    );
    roomsByType[code] = rows;
  }

  const RESERVATIONS = [
    { code: "RSV-DEMO01", guest: "Keluarga Hendra", phone: "628121230001", email: "hendra@example.com",
      type: "CB-FAM", qty: 1, inDays: -3, nights: 2, status: "check-out", source: "website",
      adults: 4, children: 2, assign: true, folio: [["fnb", "debit", "Makan malam Purbasari", 480_000], ["pembayaran", "kredit", "Pelunasan kartu kredit", 0]] },
    { code: "RSV-DEMO02", guest: "Sinta Nuriyah", phone: "628121230002", email: "sinta@example.com",
      type: "KL-DLX", qty: 1, inDays: -1, nights: 3, status: "check-in", source: "ota",
      adults: 2, children: 0, assign: true, folio: [["fnb", "debit", "Sarapan Lembur Urang ×2", 220_000], ["aktivitas", "debit", "Sewa sepeda listrik 2 jam", 150_000], ["pembayaran", "kredit", "DP transfer", 3_000_000]] },
    { code: "RSV-DEMO03", guest: "PT Aksara Nusantara", phone: "628121230003", email: "ga@aksara.co.id",
      type: "KL-FAM", qty: 2, inDays: 0, nights: 2, status: "terkonfirmasi", source: "korporat",
      adults: 8, children: 0, assign: false, folio: [["pembayaran", "kredit", "Transfer korporat 50%", 7_000_000]] },
    { code: "RSV-DEMO04", guest: "Rina & Dimas", phone: "628121230004", email: "rina@example.com",
      type: "KL-VLG", qty: 1, inDays: 6, nights: 2, status: "menunggu-bayar", source: "website",
      adults: 2, children: 0, assign: false, folio: [] },
    { code: "RSV-DEMO05", guest: "Bagus Setiawan", phone: "628121230005", email: null,
      type: "CB-SGL", qty: 1, inDays: 2, nights: 1, status: "dibatalkan", source: "telepon",
      adults: 2, children: 1, assign: false, folio: [] },
  ];

  const { nightlyRate } = requireRates();
  let created = 0;
  for (const r of RESERVATIONS) {
    const checkIn = ymd(daysFromNow(r.inDays));
    const checkOut = ymd(daysFromNow(r.inDays + r.nights));
    const typeRow = ROOM_TYPES.find((t) => t[0] === r.type);
    const rateType = { id: typeIds[r.type], name: typeRow[1], rate_weekday: typeRow[6], rate_weekend: typeRow[7], extra_bed_rate: typeRow[8] };
    const nights = [];
    for (let i = 0; i < r.nights; i += 1) nights.push(ymd(daysFromNow(r.inDays + i)));
    const breakdown = nights.map((d) => nightlyRate(rateType, d, []));
    const perRoom = breakdown.reduce((s, n) => s + n.rate, 0);
    const roomTotal = perRoom * r.qty;

    const { rows } = await c.query(
      `INSERT INTO resort.reservations
         (company_id, branch_id, reservation_code, access_token, guest_name, guest_phone, guest_email,
          check_in, check_out, nights, adults, children, status, source, room_total, extra_total,
          discount_amount, total, created_by, created_by_name, checked_in_at, checked_out_at, cancelled_at, cancel_reason, paid_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,0,0,$15,$16,'Seeder Dusun Bambu',$17,$18,$19,$20,$21)
       RETURNING id`,
      [scope.company_id, scope.branch_id, r.code, token(), r.guest, r.phone, r.email,
       checkIn, checkOut, r.nights, r.adults, r.children, r.status, r.source, roomTotal, userId,
       r.status === "check-in" || r.status === "check-out" ? daysFromNow(r.inDays) : null,
       r.status === "check-out" ? daysFromNow(r.inDays + r.nights) : null,
       r.status === "dibatalkan" ? daysFromNow(r.inDays - 1) : null,
       r.status === "dibatalkan" ? "Tamu mengubah rencana perjalanan" : null,
       r.status === "menunggu-bayar" || r.status === "dibatalkan" ? null : daysFromNow(r.inDays - 2)]
    );
    const reservationId = rows[0].id;

    for (let i = 0; i < r.qty; i += 1) {
      const unit = r.assign ? roomsByType[r.type]?.[i] : null;
      await c.query(
        `INSERT INTO resort.reservation_rooms
           (company_id, branch_id, reservation_id, room_type_id, room_id, room_type_name, room_name,
            nightly_rate, nights, extra_bed, subtotal, guest_name, rate_breakdown)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12::jsonb)`,
        [scope.company_id, scope.branch_id, reservationId, typeIds[r.type], unit?.id ?? null,
         typeRow[1], unit?.name ?? null, Math.round(perRoom / r.nights), r.nights, perRoom, r.guest,
         JSON.stringify(breakdown)]
      );
    }
    await c.query(
      `INSERT INTO resort.folio_charges (company_id, branch_id, reservation_id, charge_type, direction, description, amount, created_by, created_by_name)
       VALUES ($1,$2,$3,'kamar','debit',$4,$5,$6,'Seeder Dusun Bambu')`,
      [scope.company_id, scope.branch_id, reservationId, `Kamar ${r.qty} unit × ${r.nights} malam`, roomTotal, userId]
    );
    for (const [type, direction, description, amount] of r.folio) {
      // Pembayaran bernilai 0 = pelunasan penuh (dihitung dari total tagihan)
      const value = amount === 0 ? roomTotal + r.folio.filter((f) => f[1] === "debit").reduce((s, f) => s + f[3], 0) : amount;
      await c.query(
        `INSERT INTO resort.folio_charges (company_id, branch_id, reservation_id, charge_type, direction, description, amount, payment_method, created_by, created_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Seeder Dusun Bambu')`,
        [scope.company_id, scope.branch_id, reservationId, type, direction, description, value,
         direction === "kredit" ? "transfer" : null, userId]
      );
    }
    if (r.status === "check-in" && r.assign) {
      await c.query(
        `UPDATE resort.rooms SET status = 'siap' WHERE id IN (SELECT room_id FROM resort.reservation_rooms WHERE reservation_id = $1 AND room_id IS NOT NULL)`,
        [reservationId]
      );
    }
    created += 1;
  }
  return { types: ROOM_TYPES.length, rooms: ROOM_TYPES.reduce((s, t) => s + t[10], 0), reservations: created };
}

/** Tarif per malam (weekday/weekend) — logika sama dengan src/lib/resort/rates.ts. */
function requireRates() {
  const isWeekendNight = (date) => {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    return dow === 5 || dow === 6;
  };
  const nightlyRate = (type, date) => {
    const weekend = isWeekendNight(date);
    const rate = weekend ? type.rate_weekend || type.rate_weekday : type.rate_weekday;
    return { date, rate: Math.round(rate), weekend, season: null };
  };
  return { nightlyRate };
}

async function seedTables(c) {
  let count = 0;
  for (const [number, name, area, capacity] of TABLES) {
    await c.query(
      `INSERT INTO pos.pos_tables (table_number, name, area, capacity, status, is_active, notes)
       VALUES ($1, $2, $3, $4, 'available', true, 'Seeder Dusun Bambu')
       ON CONFLICT (table_number) DO UPDATE SET
         name = EXCLUDED.name, area = EXCLUDED.area, capacity = EXCLUDED.capacity,
         is_active = true, updated_at = NOW()`,
      [number, name, area, capacity]
    );
    count += 1;
  }
  return count;
}

async function seedDemoUser(c, scope) {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const userMeta = JSON.stringify({ full_name: "Demo Dusun Bambu", role: "admin" });
  const appMeta = JSON.stringify({ role: "admin", provider: "email" });
  const existing = await c.query(`SELECT id FROM auth.users WHERE lower(email) = lower($1)`, [DEMO_EMAIL]);
  let userId = existing.rows[0]?.id;
  if (userId) {
    await c.query(
      `UPDATE auth.users SET password_hash = $1, email_verified_at = NOW(),
         raw_user_meta_data = $2::jsonb, raw_app_meta_data = $3::jsonb WHERE id = $4`,
      [hash, userMeta, appMeta, userId]
    );
  } else {
    const ins = await c.query(
      `INSERT INTO auth.users (email, password_hash, email_verified_at, raw_user_meta_data, raw_app_meta_data)
       VALUES ($1, $2, NOW(), $3::jsonb, $4::jsonb) RETURNING id`,
      [DEMO_EMAIL, hash, userMeta, appMeta]
    );
    userId = ins.rows[0].id;
  }
  await c.query(
    `INSERT INTO configuration.users (id, full_name, role, email, status, business_scope, holding_id, company_id, branch_id)
     VALUES ($1, 'Demo Dusun Bambu', 'admin', $2, 'active', 'branch', $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       full_name = EXCLUDED.full_name, role = EXCLUDED.role, email = EXCLUDED.email, status = 'active',
       business_scope = 'branch', holding_id = EXCLUDED.holding_id, company_id = EXCLUDED.company_id,
       branch_id = EXCLUDED.branch_id, updated_at = NOW()`,
    [userId, DEMO_EMAIL, scope.holding_id, scope.company_id, scope.branch_id]
  );
  const role = await c.query(`SELECT id FROM iam.roles WHERE code = 'admin' AND deleted_at IS NULL LIMIT 1`);
  if (role.rows[0]) {
    await c.query(
      `INSERT INTO iam.user_roles (user_id, role_id, is_primary) VALUES ($1, $2, true)
       ON CONFLICT (user_id, role_id) DO UPDATE SET is_primary = true`,
      [userId, role.rows[0].id]
    );
  }
  return userId;
}

async function main() {
  loadEnv();
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) { console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL"); process.exit(1); }
  try { assertLocalTarget(url, "MIGRATE_DATABASE_URL"); } catch (err) { console.error(err.message); process.exit(1); }

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    await c.query("BEGIN");
    const scope = await ensureScope(c);
    console.log(`Tenant: ${HOLDING_CODE} → ${COMPANY_NAME} (${COMPANY_CODE}) → ${BRANCH_NAME} (${BRANCH_CODE})`);

    const outlets = await seedOutlets(c, scope);
    console.log(`✓ Outlet: ${Object.keys(outlets).length} lokasi (${OUTLETS.map((o) => o[0]).join(", ")})`);

    const deptAdded = await seedDepartments(c);
    console.log(`✓ Departemen: ${DEPARTMENTS.length} dicek, ${deptAdded} baru ditambahkan`);

    const superAdmin = await c.query(`SELECT id FROM configuration.users WHERE role = 'super_admin' ORDER BY created_at LIMIT 1`);
    const actorId = superAdmin.rows[0]?.id ?? null;

    const resort = await seedResort(c, scope, actorId);
    console.log(`✓ Resort: ${resort.types} tipe kamar, ${resort.rooms} unit, 2 musim tarif, ${resort.reservations} contoh reservasi`);

    const tables = await seedTables(c);
    console.log(`✓ Meja & saung POS: ${tables} (Purbasari lesehan, sarang Lutung Kasarung, Burangrang)`);

    const demoUser = await seedDemoUser(c, scope);
    console.log(`✓ User demo: ${DEMO_EMAIL} / ${DEMO_PASSWORD} (role admin, scope cabang ${BRANCH_NAME})`);

    await c.query("COMMIT");
    console.log(`\nSelesai bagian 1. User demo id ${demoUser}.`);
    console.log("Lanjutkan: npm run db:seed:dusun-bambu-fnb && npm run db:seed:dusun-bambu-ticketing");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
