#!/usr/bin/env node
/**
 * Seeder TENANT SULU-APPAREL — bagian 1: perusahaan, cabang, gudang produksi,
 * outlet toko, departemen HRIS, dan user demo (data lokal, owner 2026-09-09,
 * EPIC-047 Fase 0).
 *
 * Lini bisnis baru — produksi kaos, kemeja, celana, sandal, dan sepatu — di
 * bawah holding Prologe, terpisah dari company SULU (F&B) dan DUSUN-BAMBU.
 * Tidak ada kode aplikasi yang berubah di fase ini (seeder-only).
 *
 * Mengisi (idempoten, satu transaksi, HANYA database lokal):
 *   - configuration.companies/branches/warehouses : Sulu Apparel → Workshop →
 *     gudang produksi MAIN + outlet Workshop Store
 *   - hris.departments                            : Produksi & Jahit, Gudang & QC, Toko
 *   - auth.users + configuration.users            : demo@suluapparel.id (role admin, scope cabang)
 *
 * Master item/produk dibuat seeder terpisah (apparel-items.js).
 *
 * Jalankan berurutan:
 *   npm run db:seed:apparel-business
 *   npm run db:seed:apparel-items
 *   (atau gabungan: npm run db:seed:apparel)
 */

const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const {
  HOLDING_CODE, COMPANY_CODE, BRANCH_CODE, COMPANY_NAME, BRANCH_NAME,
  sslForUrl, resolveDatabaseUrl, ensureScope,
} = require("./lib/apparel-scope");

const DEMO_EMAIL = process.env.SULU_APPAREL_EMAIL || "demo@suluapparel.id";
const DEMO_PASSWORD = process.env.SULU_APPAREL_PASSWORD || "suluapparel";

// ── Departemen HRIS (kode harus unik global — lihat hris.departments) ──────
const DEPARTMENTS = [
  ["SA-PRODUKSI", "Produksi & Jahit", "Potong kain, jahit, perakitan upper, dan lasting sepatu"],
  ["SA-GUDANG-QC", "Gudang & QC", "Penerimaan bahan baku, quality control, dan stok gudang produksi"],
  ["SA-TOKO", "Toko", "Penjualan Workshop Store & kasir POS"],
];

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

async function seedDemoUser(c, scope) {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const userMeta = JSON.stringify({ full_name: "Demo Sulu Apparel", role: "admin" });
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
    `INSERT INTO configuration.users (id, full_name, role, email, status, business_scope, holding_id, company_id, branch_id, default_warehouse_id)
     VALUES ($1, 'Demo Sulu Apparel', 'admin', $2, 'active', 'branch', $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       full_name = EXCLUDED.full_name, role = EXCLUDED.role, email = EXCLUDED.email, status = 'active',
       business_scope = 'branch', holding_id = EXCLUDED.holding_id, company_id = EXCLUDED.company_id,
       branch_id = EXCLUDED.branch_id, default_warehouse_id = EXCLUDED.default_warehouse_id, updated_at = NOW()`,
    [userId, DEMO_EMAIL, scope.holding_id, scope.company_id, scope.branch_id, scope.warehouse_main_id]
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
  let url;
  try {
    url = resolveDatabaseUrl();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();
  try {
    await c.query("BEGIN");
    const scope = await ensureScope(c);
    console.log(`Tenant: ${HOLDING_CODE} → ${COMPANY_NAME} (${COMPANY_CODE}) → ${BRANCH_NAME} (${BRANCH_CODE})`);
    console.log(`✓ Gudang produksi MAIN (${scope.warehouse_main_id}) + outlet Workshop Store (${scope.warehouse_store_id})`);

    const deptAdded = await seedDepartments(c);
    console.log(`✓ Departemen: ${DEPARTMENTS.length} dicek, ${deptAdded} baru ditambahkan`);

    const demoUser = await seedDemoUser(c, scope);
    console.log(`✓ User demo: ${DEMO_EMAIL} / ${DEMO_PASSWORD} (role admin, scope cabang ${BRANCH_NAME})`);

    await c.query("COMMIT");
    console.log(`\nSelesai bagian 1. User demo id ${demoUser}.`);
    console.log("Lanjutkan: npm run db:seed:apparel-items");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
