#!/usr/bin/env node
/**
 * Seeder: beri akun super admin akses POS ke SEMUA stall.
 *
 * Peran super_admin sebenarnya sudah lolos pemeriksaan izin stall lewat
 * isSellStallAllowed() (src/lib/users/stall-assignment.ts). Yang belum:
 *
 *   1. configuration.user_warehouses kosong → pemilih stall di POS tidak punya
 *      daftar stall untuk ditampilkan.
 *   2. users.can_switch_stall = false → tombol ganti stall tidak aktif untuk
 *      akun non-super-admin yang nanti diberi hak serupa.
 *   3. users.default_warehouse_id kosong → tidak ada stall awal saat membuka POS.
 *
 * Seeder ini mengisi ketiganya untuk setiap akun super_admin aktif, jadi POS
 * bisa dibuka di stall mana pun dan berpindah stall tanpa menyentuh kode.
 *
 * Idempotent: menambah penugasan yang belum ada, mengaktifkan kembali yang
 * pernah dinonaktifkan, dan TIDAK menghapus penugasan stall milik akun lain.
 *
 * Usage:
 *   node database/seeders/tedja-superadmin-all-stalls.js
 *   node database/seeders/tedja-superadmin-all-stalls.js --email=admin@tedjacoffee.id
 *   npm run db:seed:tedja-superadmin-stalls
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");
const { resolveSeedBusinessScope } = require("../scripts/items-business-scope");

const ROOT = path.join(__dirname, "..", "..");

function loadEnv() {
  const shellKeys = new Set(Object.keys(process.env));
  for (const name of [".env", ".env.local"]) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i <= 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!shellKeys.has(k)) process.env[k] = v;
    }
  }
}

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  loadEnv();
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: Set MIGRATE_DATABASE_URL / DATABASE_URL di .env / .env.local");
    process.exit(1);
  }
  try {
    assertLocalTarget(url, "MIGRATE_DATABASE_URL");
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const c = new Client({ connectionString: url, ssl: sslForUrl(url) });
  await c.connect();

  try {
    await c.query("BEGIN");
    const scope = await resolveSeedBusinessScope(c);

    const { rows: stalls } = await c.query(
      `SELECT id, code, name FROM configuration.warehouses
       WHERE branch_id = $1 AND is_active
       ORDER BY created_at`,
      [scope.branch_id]
    );
    if (stalls.length === 0) throw new Error("Belum ada stall aktif pada cabang ini.");

    const email = argValue("email");
    const { rows: admins } = await c.query(
      `SELECT id, email, full_name
       FROM configuration.users
       WHERE role = 'super_admin'
         AND status = 'active'
         AND ($1::text IS NULL OR lower(email) = lower($1))
       ORDER BY created_at`,
      [email]
    );
    if (admins.length === 0) {
      throw new Error(email ? `Super admin "${email}" tidak ditemukan.` : "Tidak ada akun super_admin aktif.");
    }

    console.log(`Memberi akses ${stalls.length} stall ke ${admins.length} akun super admin...`);
    for (const admin of admins) {
      for (const stall of stalls) {
        await c.query(
          `INSERT INTO configuration.user_warehouses (user_id, warehouse_id, is_active)
           VALUES ($1, $2, true)
           ON CONFLICT (user_id, warehouse_id)
           DO UPDATE SET is_active = true, updated_at = NOW()`,
          [admin.id, stall.id]
        );
      }
      // Stall awal hanya diisi bila masih kosong — jangan menimpa pilihan user.
      await c.query(
        `UPDATE configuration.users
         SET can_switch_stall = true,
             default_warehouse_id = COALESCE(default_warehouse_id, $2),
             updated_at = NOW()
         WHERE id = $1`,
        [admin.id, stalls[0].id]
      );
      console.log(`  ✓ ${admin.full_name} <${admin.email}> — ${stalls.map((s) => s.code).join(", ")}`);
    }

    const { rows: check } = await c.query(
      `SELECT u.email,
              count(uw.id) FILTER (WHERE uw.is_active) AS stall_aktif,
              u.can_switch_stall,
              u.default_warehouse_id IS NOT NULL AS punya_stall_awal
       FROM configuration.users u
       LEFT JOIN configuration.user_warehouses uw ON uw.user_id = u.id
       WHERE u.role = 'super_admin' AND u.status = 'active'
       GROUP BY u.id, u.email, u.can_switch_stall, u.default_warehouse_id`
    );
    for (const row of check) {
      if (Number(row.stall_aktif) < stalls.length || !row.can_switch_stall || !row.punya_stall_awal) {
        throw new Error(`Verifikasi gagal untuk ${row.email} — dibatalkan.`);
      }
    }

    await c.query("COMMIT");
    console.log(`\nSelesai: ${admins.length} super admin bisa membuka POS di semua stall (${stalls.length}).`);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("Gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
