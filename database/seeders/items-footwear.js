#!/usr/bin/env node
/**
 * Seeder demo PRODUKSI SANDAL & SEPATU (data lokal, permintaan owner 2026-09-04).
 *
 * Mengisi (idempoten, satu transaksi, HANYA database lokal):
 *   - item.units                     : PASANG, LUSIN, M, M2 (scope company)
 *   - item.raw_material_categories   : KULIT, SOL, AKSESORIS, BENANG, PEREKAT
 *   - item.raw_materials             : 24 bahan baku alas kaki (kulit, sol, lem, benang, aksesoris, kemasan)
 *   - item.product_categories        : SANDAL, SEPATU (global)
 *   - item.products                  : 9 produk jadi (4 sandal, 5 sepatu) @ gudang MAIN, station merchandise
 *   - manufacturing.bom_items        : resep/BOM tiap produk (qty dalam satuan kecil)
 *   - pos.pos_products               : sinkron ke POS (sku PUR-<kode>, kategori Sandal/Sepatu)
 *   - inventory.inventory (+movement): stok awal bahan baku di gudang MAIN
 *   - inventory.finished_goods_inventory : stok awal produk jadi
 *
 * harga_modal produk = biaya bahan dari BOM (harga_beli ÷ konversi × qty) + biaya produksi
 * (tenaga kerja + overhead) yang ditentukan per produk — jadi HPP demo masuk akal.
 *
 * Usage:
 *   npm run db:seed:items-footwear
 * Prasyarat: business hierarchy + items-units sudah di-seed (satuan dasar PCS/KG/ROLL/… ada).
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

const WAREHOUSE_CODE = "MAIN";
const STATION = "merchandise";

// ── Satuan tambahan (scope company) ─────────────────────────────────────────
const UNITS = [
  ["PASANG", "Pasang", "KECIL", "Sepasang alas kaki (kiri + kanan)"],
  ["LUSIN", "Lusin", "BESAR", "12 pasang / 12 pcs"],
  ["M", "Meter", "KECIL", "Panjang bahan gulungan (kain, kulit sintetis, tali)"],
  ["M2", "Meter Persegi", "KECIL", "Luas lembaran kulit"],
];

// ── Kategori bahan baku (scope company) ─────────────────────────────────────
const RM_CATEGORIES = [
  ["KULIT", "Kulit & Bahan Atas", "Kulit asli/sintetis, suede, kanvas, mesh untuk upper"],
  ["SOL", "Sol & Alas Kaki", "Outsole, midsole, insole"],
  ["AKSESORIS", "Aksesoris & Pengikat", "Tali, eyelet, gesper, velcro, ring"],
  ["BENANG", "Benang & Jahit", "Benang nilon / wax untuk jahit upper"],
  ["PEREKAT", "Lem & Kimia Sepatu", "Lem kuning, lem PU, primer sol"],
];

// ── Bahan baku ──────────────────────────────────────────────────────────────
// [kode, nama, kategori, satuanBesar, satuanKecil, konversi, stokMin, stokMax,
//  shelfLifeDays, storage, deskripsi, hargaBeliPerSatuanBesar, stokAwal(satuanBesar)]
const MATERIALS = [
  // Kulit & bahan atas
  ["BB-KUL-001", "Kulit Sapi Nappa", "KULIT", "LBR", "M2", 2, 5, 40, null, "SUHU_RUANG", "Kulit sapi nappa grade A, ±2 m² per lembar", 450000, 20],
  ["BB-KUL-002", "Kulit Sintetis PU", "KULIT", "ROLL", "M", 30, 3, 20, 720, "SUHU_RUANG", "PU leather lebar 1,4 m, roll 30 m", 600000, 8],
  ["BB-KUL-003", "Kulit Suede", "KULIT", "LBR", "M2", 1.5, 5, 30, null, "SUHU_RUANG", "Suede sapi ±1,5 m² per lembar", 380000, 15],
  ["BB-KUL-004", "Kanvas 12oz", "KULIT", "ROLL", "M", 50, 2, 15, 1080, "SUHU_RUANG", "Kanvas katun 12oz lebar 1,5 m, roll 50 m", 900000, 6],
  ["BB-KUL-005", "Mesh Sport Breathable", "KULIT", "ROLL", "M", 40, 2, 15, 1080, "SUHU_RUANG", "Mesh poliester untuk sepatu lari, roll 40 m", 700000, 5],
  // Sol & alas
  ["BB-SOL-001", "Sol Karet Sandal", "SOL", "LUSIN", "PASANG", 12, 10, 100, null, "SUHU_RUANG", "Outsole karet sandal jepit/slide", 240000, 30],
  ["BB-SOL-002", "Sol EVA Sandal Slide", "SOL", "LUSIN", "PASANG", 12, 10, 80, null, "SUHU_RUANG", "Sol EVA ringan untuk slide", 300000, 20],
  ["BB-SOL-003", "Outsole Rubber Sneaker", "SOL", "LUSIN", "PASANG", 12, 8, 60, null, "SUHU_RUANG", "Outsole karet vulkanisir sneaker", 420000, 15],
  ["BB-SOL-004", "Insole Busa Latex", "SOL", "LUSIN", "PASANG", 12, 10, 100, null, "SUHU_RUANG", "Insole busa latex + kain", 120000, 25],
  ["BB-SOL-005", "Midsole Phylon", "SOL", "LUSIN", "PASANG", 12, 5, 50, null, "SUHU_RUANG", "Midsole phylon sepatu lari", 360000, 10],
  ["BB-SOL-006", "Sol Kulit Pantofel", "SOL", "LUSIN", "PASANG", 12, 3, 30, null, "SUHU_RUANG", "Sol kulit + hak karet untuk pantofel", 780000, 6],
  // Aksesoris & pengikat
  ["BB-AKS-001", "Tali Sepatu 120cm", "AKSESORIS", "PACK", "PASANG", 50, 5, 40, null, "SUHU_RUANG", "Tali sepatu pipih 120 cm, pack 50 pasang", 150000, 10],
  ["BB-AKS-002", "Eyelet Kuningan 4mm", "AKSESORIS", "BOX", "PCS", 1000, 3, 20, null, "SUHU_RUANG", "Eyelet kuningan, box 1.000 pcs", 90000, 8],
  ["BB-AKS-003", "Gesper Sandal Logam", "AKSESORIS", "BOX", "PCS", 100, 3, 20, null, "SUHU_RUANG", "Gesper logam 25 mm, box 100 pcs", 250000, 6],
  ["BB-AKS-004", "Velcro 25mm", "AKSESORIS", "ROLL", "M", 25, 3, 20, null, "SUHU_RUANG", "Velcro hook & loop 25 mm, roll 25 m", 60000, 10],
  ["BB-AKS-005", "Ring D Logam", "AKSESORIS", "BOX", "PCS", 500, 2, 15, null, "SUHU_RUANG", "Ring D 20 mm, box 500 pcs", 75000, 5],
  // Benang
  ["BB-BNG-001", "Benang Nilon 210D", "BENANG", "ROLL", "M", 1000, 5, 40, null, "SUHU_RUANG", "Benang nilon jahit upper, roll 1.000 m", 35000, 20],
  ["BB-BNG-002", "Benang Wax Kulit", "BENANG", "ROLL", "M", 500, 5, 30, null, "SUHU_RUANG", "Benang poliester wax untuk kulit, roll 500 m", 45000, 12],
  // Lem & kimia
  ["BB-LEM-001", "Lem Kuning (Contact Adhesive)", "PEREKAT", "CAN", "GR", 1000, 5, 40, 365, "KHUSUS", "Lem kuning kaleng 1 kg", 85000, 15],
  ["BB-LEM-002", "Primer Sol", "PEREKAT", "BTL", "ML", 500, 3, 20, 365, "KHUSUS", "Primer perekat sol botol 500 ml", 65000, 8],
  ["BB-LEM-003", "Lem PU Sol", "PEREKAT", "CAN", "GR", 1000, 5, 40, 365, "KHUSUS", "Lem PU pengikat outsole kaleng 1 kg", 110000, 10],
  // Kemasan (kategori KEMASAN sudah ada dari seed F&B)
  ["BB-KEM-101", "Dus Sepatu", "KEMASAN", "PACK", "PCS", 20, 5, 40, null, "SUHU_RUANG", "Dus sepatu karton, pack 20 pcs", 60000, 15],
  ["BB-KEM-102", "Kertas Tisu Pembungkus", "KEMASAN", "PACK", "LBR", 100, 5, 40, null, "SUHU_RUANG", "Tissue paper pembungkus, pack 100 lembar", 25000, 10],
  ["BB-KEM-103", "Hangtag & Label Ukuran", "KEMASAN", "PACK", "PCS", 100, 5, 40, null, "SUHU_RUANG", "Hangtag + stiker ukuran, pack 100 set", 30000, 10],
];

// ── Kategori produk (global) ────────────────────────────────────────────────
const PRODUCT_CATEGORIES = [
  ["SANDAL", "Sandal", "Sandal jepit, slide, gunung, kulit"],
  ["SEPATU", "Sepatu", "Sneaker, sepatu lari, pantofel, boots"],
];

// ── Produk jadi + BOM ───────────────────────────────────────────────────────
// components: [kodeBahan, qtyDalamSatuanKecil, waste(0–1)]
const PRODUCTS = [
  {
    kode: "SND-001", nama: "Sandal Jepit Karet Classic", kategori: "SANDAL", pos_category: "Sandal",
    jual: 45000, biaya_produksi: 6000, stok_awal: 60,
    deskripsi: "Sandal jepit karet, tali PU, ukuran 38–43",
    components: [["BB-SOL-001", 1, 0.02], ["BB-KUL-002", 0.15, 0.05], ["BB-LEM-001", 15, 0], ["BB-KEM-103", 1, 0]],
  },
  {
    kode: "SND-002", nama: "Sandal Slide EVA Logo", kategori: "SANDAL", pos_category: "Sandal",
    jual: 85000, biaya_produksi: 9000, stok_awal: 48,
    deskripsi: "Sandal slide EVA dengan strap PU berlogo",
    components: [["BB-SOL-002", 1, 0.02], ["BB-KUL-002", 0.25, 0.05], ["BB-LEM-001", 20, 0], ["BB-BNG-001", 2, 0], ["BB-KEM-103", 1, 0]],
  },
  {
    kode: "SND-003", nama: "Sandal Gunung Strap Velcro", kategori: "SANDAL", pos_category: "Sandal",
    jual: 145000, biaya_produksi: 15000, stok_awal: 30,
    deskripsi: "Sandal gunung sol EVA, strap velcro & ring D",
    components: [["BB-SOL-002", 1, 0.02], ["BB-KUL-004", 0.3, 0.05], ["BB-AKS-004", 0.6, 0.03], ["BB-AKS-005", 4, 0], ["BB-BNG-001", 6, 0], ["BB-LEM-001", 25, 0], ["BB-KEM-103", 1, 0]],
  },
  {
    kode: "SND-004", nama: "Sandal Kulit Pria Casual", kategori: "SANDAL", pos_category: "Sandal",
    jual: 225000, biaya_produksi: 22000, stok_awal: 24,
    deskripsi: "Sandal kulit sapi nappa, gesper logam, sol karet",
    components: [["BB-SOL-001", 1, 0.02], ["BB-KUL-001", 0.12, 0.08], ["BB-SOL-004", 1, 0], ["BB-AKS-003", 1, 0], ["BB-BNG-002", 4, 0], ["BB-LEM-003", 20, 0], ["BB-KEM-101", 1, 0], ["BB-KEM-103", 1, 0]],
  },
  {
    kode: "SPT-001", nama: "Sepatu Sneaker Kanvas Low", kategori: "SEPATU", pos_category: "Sepatu",
    jual: 275000, biaya_produksi: 28000, stok_awal: 36,
    deskripsi: "Sneaker kanvas low-cut, sol karet vulkanisir",
    components: [["BB-SOL-003", 1, 0.02], ["BB-KUL-004", 0.45, 0.05], ["BB-SOL-004", 1, 0], ["BB-AKS-001", 1, 0], ["BB-AKS-002", 12, 0.02], ["BB-BNG-001", 12, 0], ["BB-LEM-003", 30, 0], ["BB-LEM-002", 10, 0], ["BB-KEM-101", 1, 0], ["BB-KEM-102", 2, 0], ["BB-KEM-103", 1, 0]],
  },
  {
    kode: "SPT-002", nama: "Sepatu Sneaker Kulit Sintetis", kategori: "SEPATU", pos_category: "Sepatu",
    jual: 320000, biaya_produksi: 30000, stok_awal: 30,
    deskripsi: "Sneaker upper PU leather, midsole phylon",
    components: [["BB-SOL-003", 1, 0.02], ["BB-SOL-005", 1, 0.02], ["BB-KUL-002", 0.5, 0.05], ["BB-SOL-004", 1, 0], ["BB-AKS-001", 1, 0], ["BB-AKS-002", 12, 0.02], ["BB-BNG-001", 14, 0], ["BB-LEM-003", 35, 0], ["BB-LEM-002", 10, 0], ["BB-KEM-101", 1, 0], ["BB-KEM-102", 2, 0], ["BB-KEM-103", 1, 0]],
  },
  {
    kode: "SPT-003", nama: "Sepatu Lari Mesh Phylon", kategori: "SEPATU", pos_category: "Sepatu",
    jual: 395000, biaya_produksi: 35000, stok_awal: 24,
    deskripsi: "Sepatu lari upper mesh breathable, midsole phylon, outsole rubber",
    components: [["BB-SOL-003", 1, 0.02], ["BB-SOL-005", 1, 0.02], ["BB-KUL-005", 0.4, 0.05], ["BB-KUL-002", 0.1, 0.05], ["BB-SOL-004", 1, 0], ["BB-AKS-001", 1, 0], ["BB-AKS-002", 10, 0.02], ["BB-BNG-001", 16, 0], ["BB-LEM-003", 35, 0], ["BB-LEM-002", 12, 0], ["BB-KEM-101", 1, 0], ["BB-KEM-102", 2, 0], ["BB-KEM-103", 1, 0]],
  },
  {
    kode: "SPT-004", nama: "Sepatu Pantofel Kulit Pria", kategori: "SEPATU", pos_category: "Sepatu",
    jual: 550000, biaya_produksi: 60000, stok_awal: 18,
    deskripsi: "Pantofel kulit sapi nappa full grain, sol kulit",
    components: [["BB-SOL-006", 1, 0.02], ["BB-KUL-001", 0.3, 0.1], ["BB-SOL-004", 1, 0], ["BB-AKS-001", 1, 0], ["BB-AKS-002", 8, 0.02], ["BB-BNG-002", 10, 0], ["BB-LEM-003", 40, 0], ["BB-LEM-002", 15, 0], ["BB-KEM-101", 1, 0], ["BB-KEM-102", 2, 0], ["BB-KEM-103", 1, 0]],
  },
  {
    kode: "SPT-005", nama: "Sepatu Boots Suede", kategori: "SEPATU", pos_category: "Sepatu",
    jual: 620000, biaya_produksi: 65000, stok_awal: 12,
    deskripsi: "Boots suede mid-cut, sol karet, eyelet kuningan",
    components: [["BB-SOL-003", 1, 0.02], ["BB-KUL-003", 0.45, 0.1], ["BB-SOL-004", 1, 0], ["BB-AKS-001", 1, 0], ["BB-AKS-002", 16, 0.02], ["BB-BNG-002", 14, 0], ["BB-LEM-003", 45, 0], ["BB-LEM-002", 15, 0], ["BB-KEM-101", 1, 0], ["BB-KEM-102", 2, 0], ["BB-KEM-103", 1, 0]],
  },
];

/* ───────────────────────────── helpers ───────────────────────────── */

async function loadUnitMap(c, companyId) {
  // Satuan scope company menang; satuan global (company NULL) jadi cadangan.
  const { rows } = await c.query(
    `SELECT id, kode, company_id FROM item.units
     WHERE deleted_at IS NULL AND (company_id = $1 OR company_id IS NULL)
     ORDER BY (company_id IS NULL)`,
    [companyId]
  );
  const map = new Map();
  for (const r of rows) if (!map.has(r.kode)) map.set(r.kode, r.id);
  return map;
}

async function upsertUnits(c, scope) {
  for (const [kode, nama, tipe, deskripsi] of UNITS) {
    await c.query(
      `INSERT INTO item.units (kode, nama, tipe, deskripsi, company_id, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (company_id, kode) WHERE company_id IS NOT NULL AND deleted_at IS NULL DO UPDATE
         SET nama = EXCLUDED.nama, tipe = EXCLUDED.tipe, deskripsi = EXCLUDED.deskripsi,
             is_active = true, deleted_at = NULL, updated_at = NOW()`,
      [kode, nama, tipe, deskripsi, scope.company_id]
    );
  }
}

async function upsertRmCategories(c, scope) {
  for (const [code, nama, deskripsi] of RM_CATEGORIES) {
    await c.query(
      `INSERT INTO item.raw_material_categories (code, nama, deskripsi, company_id, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (company_id, code) WHERE company_id IS NOT NULL AND deleted_at IS NULL DO UPDATE
         SET nama = EXCLUDED.nama, deskripsi = EXCLUDED.deskripsi,
             is_active = true, deleted_at = NULL, updated_at = NOW()`,
      [code, nama, deskripsi, scope.company_id]
    );
  }
}

async function upsertProductCategories(c) {
  for (const [code, nama, deskripsi] of PRODUCT_CATEGORIES) {
    await c.query(
      `INSERT INTO item.product_categories (code, nama, deskripsi, company_id, is_active)
       VALUES ($1, $2, $3, NULL, true)
       ON CONFLICT (code) WHERE company_id IS NULL AND deleted_at IS NULL DO UPDATE
         SET nama = EXCLUDED.nama, deskripsi = EXCLUDED.deskripsi,
             is_active = true, deleted_at = NULL, updated_at = NOW()`,
      [code, nama, deskripsi]
    );
  }
}

const RM_INSERT = `
  INSERT INTO item.raw_materials
    (kode, nama, kategori, deskripsi, satuan_besar_id, satuan_kecil_id, konversi_factor,
     stok_minimum, stok_maximum, shelf_life_days, storage_condition, harga_beli, material_type,
     company_id, branch_id, is_active)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'PURCHASED', $13, $14, true)
  ON CONFLICT (
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kode
  ) WHERE deleted_at IS NULL
  DO UPDATE SET
    nama = EXCLUDED.nama, kategori = EXCLUDED.kategori, deskripsi = EXCLUDED.deskripsi,
    satuan_besar_id = EXCLUDED.satuan_besar_id, satuan_kecil_id = EXCLUDED.satuan_kecil_id,
    konversi_factor = EXCLUDED.konversi_factor, stok_minimum = EXCLUDED.stok_minimum,
    stok_maximum = EXCLUDED.stok_maximum, shelf_life_days = EXCLUDED.shelf_life_days,
    storage_condition = EXCLUDED.storage_condition, harga_beli = EXCLUDED.harga_beli,
    is_active = true, deleted_at = NULL, updated_at = NOW()
  RETURNING id, kode, harga_beli, konversi_factor, satuan_kecil_id
`;

async function upsertMaterials(c, scope, uid) {
  const map = new Map();
  for (const m of MATERIALS) {
    const [kode, nama, kategori, besar, kecil, konv, min, max, shelf, storage, deskripsi, harga, stokAwal] = m;
    const { rows } = await c.query(RM_INSERT, [
      kode, nama, kategori, deskripsi, uid(besar), uid(kecil), konv, min, max, shelf, storage, harga,
      scope.company_id, scope.branch_id,
    ]);
    map.set(kode, { ...rows[0], stokAwal, hargaBeli: Number(harga), konv: Number(konv) });
  }
  return map;
}

async function seedRawStock(c, scope, warehouseId, materialMap) {
  let count = 0;
  for (const [kode, m] of materialMap) {
    // Stok disimpan dalam SATUAN BESAR (lihat src/lib/inventory/raw-material-units.ts).
    const { rows } = await c.query(
      `INSERT INTO inventory.inventory
         (raw_material_id, qty_available, qty_on_order, qty_minimum, qty_maximum, unit_cost,
          lokasi_rak, catatan, is_active, branch_id, warehouse_id, last_movement_at)
       VALUES ($1, $2, 0, 0, 0, $3, 'RAK-FW', 'Stok awal seed footwear', true, $4, $5, NOW())
       ON CONFLICT (raw_material_id,
                    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET qty_available = EXCLUDED.qty_available, unit_cost = EXCLUDED.unit_cost,
                     is_active = true, last_movement_at = NOW(), updated_at = NOW()
       RETURNING id`,
      [m.id, m.stokAwal, m.hargaBeli, scope.branch_id, warehouseId]
    );
    const inventoryId = rows[0].id;
    // Jejak mutasi: ganti mutasi seed sebelumnya supaya tidak menumpuk.
    await c.query(
      `DELETE FROM inventory.inventory_movements
       WHERE raw_material_id = $1 AND reference_type = 'seed_footwear'`,
      [m.id]
    );
    await c.query(
      `INSERT INTO inventory.inventory_movements
         (inventory_id, raw_material_id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost,
          reference_type, reference_number, alasan, is_active, branch_id, warehouse_id)
       VALUES ($1, $2, 'in', $3::numeric, 0, $3::numeric, $4::numeric, $3::numeric * $4::numeric, 'seed_footwear', 'SEED-FW', 'Stok awal seed sandal & sepatu', true, $5, $6)`,
      [inventoryId, m.id, m.stokAwal, m.hargaBeli, scope.branch_id, warehouseId]
    );
    count += 1;
    void kode;
  }
  return count;
}

async function upsertProduct(c, p, scope, unitId, warehouseId, modal) {
  const markup = modal > 0 ? Math.round(((p.jual - modal) / modal) * 100) : 0;
  const { rows } = await c.query(
    `INSERT INTO item.products
       (kode, nama, deskripsi, kategori, satuan_id, harga_jual, harga_modal, markup_persen,
        company_id, branch_id, warehouse_id, production_output_type, station, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'FINISHED_GOOD', $12, true)
     ON CONFLICT (
       COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
       COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
       warehouse_id, kode
     ) WHERE deleted_at IS NULL
     DO UPDATE SET
       nama = EXCLUDED.nama, deskripsi = EXCLUDED.deskripsi, kategori = EXCLUDED.kategori,
       satuan_id = EXCLUDED.satuan_id, harga_jual = EXCLUDED.harga_jual,
       harga_modal = EXCLUDED.harga_modal, markup_persen = EXCLUDED.markup_persen,
       production_output_type = 'FINISHED_GOOD', station = EXCLUDED.station,
       is_active = true, deleted_at = NULL, updated_at = NOW()
     RETURNING id, kode, nama, deskripsi, harga_jual, harga_modal`,
    [p.kode, p.nama, p.deskripsi, p.kategori, unitId, p.jual, modal, markup,
     scope.company_id, scope.branch_id, warehouseId, STATION]
  );
  return rows[0];
}

async function findOrCreatePosCategory(c, name) {
  const existing = await c.query(
    `SELECT id FROM pos.pos_categories WHERE lower(name) = lower($1) LIMIT 1`,
    [name]
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await c.query(
    `INSERT INTO pos.pos_categories (name, is_active) VALUES ($1, true) RETURNING id`,
    [name]
  );
  return created.rows[0].id;
}

async function upsertPosProduct(c, product, p) {
  const sku = `PUR-${product.kode}`;
  const categoryId = await findOrCreatePosCategory(c, p.pos_category);
  const { rows } = await c.query(
    `INSERT INTO pos.pos_products
       (sku, name, description, category_id, base_price, cost_price, is_active, is_available,
        inventory_tracking, station, product_kind, source_product_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, true, false, $7, 'merchandise', $8, NOW())
     ON CONFLICT (sku) DO UPDATE SET
       name = EXCLUDED.name, description = EXCLUDED.description, category_id = EXCLUDED.category_id,
       base_price = EXCLUDED.base_price, cost_price = EXCLUDED.cost_price, is_active = true,
       is_available = true, station = EXCLUDED.station, product_kind = 'merchandise',
       source_product_id = EXCLUDED.source_product_id, updated_at = NOW()
     RETURNING sku, (xmax = 0) AS inserted`,
    [sku, product.nama, product.deskripsi, categoryId, Number(product.harga_jual),
     Number(product.harga_modal), STATION, product.id]
  );
  return rows[0];
}

/* ─────────────────────────────── main ─────────────────────────────── */

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
    console.log(`Scope: ${scope.company_name} / ${scope.branch_name}`);

    await upsertUnits(c, scope);
    const unitMap = await loadUnitMap(c, scope.company_id);
    const uid = (code) => {
      const id = unitMap.get(code);
      if (!id) throw new Error(`Unit "${code}" tidak ditemukan — jalankan npm run db:seed:items-units dulu`);
      return id;
    };
    console.log(`✓ Satuan: ${UNITS.map((u) => u[0]).join(", ")}`);

    await upsertRmCategories(c, scope);
    await upsertProductCategories(c);
    console.log(`✓ Kategori bahan: ${RM_CATEGORIES.map((k) => k[0]).join(", ")} · kategori produk: SANDAL, SEPATU`);

    const { rows: wh } = await c.query(
      `SELECT id, code FROM configuration.warehouses WHERE branch_id = $1 AND code = $2 AND is_active = true`,
      [scope.branch_id, WAREHOUSE_CODE]
    );
    if (!wh[0]) throw new Error(`Gudang ${WAREHOUSE_CODE} tidak ditemukan di ${scope.branch_name}`);
    const warehouseId = wh[0].id;

    const materialMap = await upsertMaterials(c, scope, uid);
    console.log(`✓ Bahan baku: ${materialMap.size} item`);
    const stockCount = await seedRawStock(c, scope, warehouseId, materialMap);
    console.log(`✓ Stok awal bahan baku @ ${WAREHOUSE_CODE}: ${stockCount} baris`);

    let bomCount = 0;
    for (const p of PRODUCTS) {
      // Biaya bahan dari BOM: harga_beli ÷ konversi = harga per satuan kecil.
      let bahan = 0;
      for (const [kode, qty, waste] of p.components) {
        const m = materialMap.get(kode);
        if (!m) throw new Error(`Bahan ${kode} tidak ada untuk ${p.kode}`);
        bahan += (m.hargaBeli / m.konv) * qty * (1 + (waste || 0));
      }
      const modal = Math.ceil((bahan + p.biaya_produksi) / 100) * 100;

      const product = await upsertProduct(c, p, scope, uid("PASANG"), warehouseId, modal);

      await c.query(`DELETE FROM manufacturing.bom_items WHERE product_id = $1`, [product.id]);
      for (const [kode, qty, waste] of p.components) {
        const m = materialMap.get(kode);
        await c.query(
          `INSERT INTO manufacturing.bom_items
             (product_id, raw_material_id, qty_required, satuan_id, waste_factor, is_active)
           VALUES ($1, $2, $3, $4, $5, true)`,
          [product.id, m.id, qty, m.satuan_kecil_id, waste || 0]
        );
        bomCount += 1;
      }

      await c.query(
        `INSERT INTO inventory.finished_goods_inventory
           (product_id, qty_available, unit_cost, last_movement_at, is_active)
         VALUES ($1, $2, $3, NOW(), true)
         ON CONFLICT (product_id) DO UPDATE SET
           qty_available = EXCLUDED.qty_available, unit_cost = EXCLUDED.unit_cost,
           last_movement_at = NOW(), is_active = true, updated_at = NOW()`,
        [product.id, p.stok_awal, modal]
      );

      const pos = await upsertPosProduct(c, product, p);
      console.log(
        `  ✓ ${p.kode} ${p.nama} — modal Rp ${modal.toLocaleString("id-ID")} / jual Rp ${p.jual.toLocaleString("id-ID")} · ${p.components.length} BOM · stok ${p.stok_awal} pasang → POS ${pos.sku} [${pos.inserted ? "created" : "updated"}]`
      );
    }

    await c.query("COMMIT");
    console.log(`\nSelesai: ${materialMap.size} bahan baku, ${PRODUCTS.length} produk, ${bomCount} baris BOM, stok awal terisi.`);
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
