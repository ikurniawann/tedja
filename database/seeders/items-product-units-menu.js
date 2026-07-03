#!/usr/bin/env node
/**
 * Seeder: Product → Master Data → menu Unit (Satuan).
 * Menjalankan migrasi IAM menu untuk items.product.master.units.
 *
 * Prasyarat: items-menu-tree (struktur menu Product sudah ada).
 *
 * Usage:
 *   node database/seeders/items-product-units-menu.js
 *   npm run db:seed:items-product-units-menu
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");

const ROOT = path.join(__dirname, "..", "..");
const MIGRATION = "20260701180000_product_master_units_menu.sql";

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
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!shellKeys.has(k)) process.env[k] = v;
    }
  }
}

async function main() {
  loadEnv();
  const databaseUrl = process.env.DATABASE_URL || process.env.MIGRATE_DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL belum diset.");
    process.exit(1);
  }
  assertLocalTarget(databaseUrl);

  const client = new Client({
    connectionString: databaseUrl,
    ssl: sslForUrl(databaseUrl),
  });

  try {
    await client.connect();
    const filePath = path.join(__dirname, "..", "migrations", "deltas", MIGRATION);
    const sql = fs.readFileSync(filePath, "utf-8");
    console.log(`Applying ${MIGRATION}…`);
    await client.query(sql);
    console.log("Done. Menu Unit (Satuan) Product Master Data siap.");
  } catch (err) {
    console.error("items-product-units-menu seeder failed:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
