#!/usr/bin/env node
/**
 * Seeder: Items → Raw Material & Product IAM menu trees.
 *
 * Usage:
 *   node database/seeders/items-menu-tree.js
 *   npm run db:seed:items-menu
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { sslForUrl, assertLocalTarget } = require("../scripts/pg-utils");

const ROOT = path.join(__dirname, "..", "..");
const MIGRATIONS = [
  "20260701120000_items_raw_material_menu_restructure.sql",
  "20260701130000_items_product_route_fix.sql",
  "20260701140000_items_product_menu_restructure.sql",
  "20260701150000_items_menu_path_namespace.sql",
  "20260701180000_product_master_units_menu.sql",
];

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
  const databaseUrl = process.env.DATABASE_URL;
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
    for (const filename of MIGRATIONS) {
      const filePath = path.join(__dirname, "..", "migrations", "deltas", filename);
      const sql = fs.readFileSync(filePath, "utf-8");
      console.log(`Applying ${filename}…`);
      await client.query(sql);
    }
    console.log("Done. Items menu tree (Raw Material + Product) seeded.");
  } catch (err) {
    console.error("items-menu-tree seeder failed:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
