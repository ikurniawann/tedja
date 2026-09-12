#!/usr/bin/env node
/**
 * Seeder: data demo ringkas self-order meja Tedja (EPIC-048) —
 * 4 kategori, 12 produk ber-varian/XP/station/foto (1 khusus member), 2 member demo.
 * Idempotent; meja tidak disentuh. Detail di tedja-self-order-demo.sql.
 *
 * Usage:
 *   npm run db:seed:tedja-self-order
 */

const { spawnSync } = require("child_process");
const path = require("path");

const runner = path.join(__dirname, "run-sql-file.js");
const sql = path.join(__dirname, "tedja-self-order-demo.sql");

const result = spawnSync(process.execPath, [runner, sql], { stdio: "inherit" });
process.exit(result.status ?? 1);
