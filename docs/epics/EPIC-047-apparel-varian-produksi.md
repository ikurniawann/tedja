# EPIC-047: Apparel & Alas Kaki — Varian dari Master sampai Produksi — `MODULE-APPAREL`

status: on-progress
environment: dev
phase: 1
priority: P1
area: Fullstack
module: `MODULE-APPAREL`
retries: 0

## Goal

Menjalankan lini bisnis baru — **produksi kaos, kemeja, sandal, dan sepatu** —
di ERP yang sama, dari pembelian bahan baku sampai barang jadi bisa dijual di
kasir dan toko online, **tanpa modul baru**. Yang membedakan apparel dari F&B
hanya satu dimensi: **varian ukuran & warna** dengan stok masing-masing.
Epic ini menutup celah itu di dua jahitan yang hari ini belum mengenal varian:
master produk → SKU, dan produksi selesai → stok per SKU.

## Keputusan Perencanaan (2026-09-09)

Hasil audit kode & database lokal bersama owner. Semua sudah dikunci:

- **Bukan modul baru.** Keputusan ini sudah dicatat tim pada 2026-08-02
  (EPIC-039, header `20260802100000_pos_merchandise_foundation.sql`):
  *merchandise = `product_kind` baru di POS, BUKAN jalur purchasing baru;
  pembelian reuse `item.products`.* Apparel masuk kategori yang sama.
  Bukti sudah jalan: seeder `items-footwear.js` (4 Sep) menjalankan seluruh
  rantai bahan baku → WIP upper → sepatu jadi → production order dengan HPP →
  POS, semuanya di tabel `item` / `purchasing` / `inventory` / `manufacturing`
  yang sudah ada. `production_orders` sudah membedakan
  `production_context` × `output_type` (`raw_material|WIP`, `product|WIP`,
  `product|FINISHED_GOOD`).
- **Lini bisnis dipisah sebagai company sendiri** di bawah holding Prologe
  (pola tenant Dusun Bambu, EPIC-046) — **bukan** hide/unhide F&B seperti
  percobaan 4 Sep (`[hidden-fnb]`, script `footwear-only`). Unit, kategori,
  bahan, produk, dan gudang semuanya sudah ber-`company_id`, jadi pemisahan
  ini gratis.
- **Lapisan varian sudah ada, hanya belum dipakai.** `pos.pos_product_skus`
  (EPIC-039 Fase B): `options` jsonb untuk ukuran/warna, `stock_quantity` per
  SKU, `barcode`, `price_override`, plus fungsi klaim/restore stok
  `pos_sell_merchandise_sku_stock`. Editor per-SKU sudah ada di
  `/api/pos/products/[id]/skus` (+ `[skuId]`) dengan `normalizeSkuPayload`.
  **0 baris** terpakai hari ini.
- **Dua jahitan yang buta varian** — inilah pekerjaan epic ini:
  1. **Produksi selesai** berhenti di `finished_goods_inventory` level produk
     dan **tidak pernah menyentuh POS/SKU**
     (`src/app/api/purchasing/production/orders/[id]/route.ts`, cabang
     `else` FINISHED_GOOD setelah insert `production_batches`).
  2. **GRN** mengisi `pos_receive_merchandise_stock` level produk; migration
     Fase B sendiri (§6) menandai *per-varian GRN = fase lanjut*.
- **BOM tetap satu per produk. HPP tetap per produk.** Konsumsi bahan sudah
  per order (`production_order_materials`), bukan per varian. Bahan per pcs
  sama untuk semua ukuran; beda kain per ukuran ditangani `waste_factor`
  (BOM per varian = fase lanjut, bukan sekarang).
- **Storefront, Xendit, kurir Biteship, Shopee tidak termasuk** — EPIC-039
  Fase D–F sudah diimplementasikan di dev (ready-for-qa). Begitu varian
  mengalir dari produksi, apparel langsung bisa dijual online.
- **Dev-only dulu.** Ikut registry `docs/modules/README.md` sebagai
  `MODULE-APPAREL`; naik ke production hanya bila owner memanggil namanya.

## Tasks

### Fase 0 — Company `SULU-APPAREL` + master dasar (seeder lokal) ✅

Turunan `items-footwear.js` + `dusun-bambu.js` / `lib/dusun-bambu-scope.js`.
Tidak ada kode aplikasi yang berubah di fase ini.

- [x] `database/seeders/lib/apparel-scope.js`: kode `PROLOGE` / `SULU-APPAREL` /
      `SA-WORKSHOP`, `loadEnv`, `ensureScope` (company + branch + gudang
      produksi `MAIN` + outlet `Workshop Store`), `assertLocalTarget`.
- [x] `database/seeders/apparel.js` (`npm run db:seed:apparel-business`):
      user demo `demo@suluapparel.id` (role `admin`, scope cabang), departemen
      HRIS *Produksi & Jahit*, *Gudang & QC*, *Toko*.
- [x] `database/seeders/apparel-items.js` (`npm run db:seed:apparel-items`):
      unit per company (PCS, LUSIN, M, ROLL, KG, CONE, PASANG); kategori bahan
      KAIN, BENANG, AKSESORIS (kancing/resleting/eyelet), LABEL, KEMASAN, SOL,
      KULIT, PEREKAT, WIP; ±30 bahan baku dengan konversi satuan beli; kategori
      produk KAOS, KEMEJA, CELANA, SANDAL, SEPATU, WIP; 2–3 produk WIP (badan
      kaos potong-jahit, upper sepatu); ±12 produk jadi dengan BOM bertingkat
      memakai `components: [kode | "WIP:<kode>", qty, waste]`; stok awal; sinkron
      `pos_products` dengan `product_kind = 'merchandise'` + `source_product_id`.
- [x] Update `EPIC-047` + `docs/modules/README.md` dengan hasil jalankan
      (jumlah bahan/produk/BOM), dan catatan bahwa harga adalah asumsi.

**Done signal:** login `demo@suluapparel.id` → Items menampilkan master
apparel, F&B Sulu tidak terlihat, super admin Sulu tidak terganggu.

**Hasil jalankan (2026-09-09, lokal, `npm run db:seed:apparel-business` lalu
`npm run db:seed:apparel-items`, idempoten — dijalankan 2× tanpa duplikasi):**

- Company `SULU-APPAREL` (holding `PROLOGE`) → cabang `SA-WORKSHOP` (Sulu
  Apparel Workshop) → gudang produksi `MAIN` (default) + outlet
  `WORKSHOP-STORE` (Workshop Store).
- Departemen HRIS baru: `SA-PRODUKSI` (Produksi & Jahit), `SA-GUDANG-QC`
  (Gudang & QC), `SA-TOKO` (Toko).
- User demo `demo@suluapparel.id` / `suluapparel` (role `admin`, scope
  cabang).
- Unit per company: 7 (`PCS, LUSIN, M, ROLL, KG, CONE, PASANG`).
- Kategori bahan baku per company: 9 (`KAIN, BENANG, AKSESORIS, LABEL,
  KEMASAN, SOL, KULIT, PEREKAT, WIP`).
- Bahan baku: 35 total = 32 dibeli manual + 3 bahan WIP otomatis (hasil
  produk WIP di bawah), dengan konversi satuan beli (LUSIN/ROLL) tercatat di
  `raw_material_unit_conversions`. Stok awal masuk di 35 baris
  `inventory.inventory` (gudang MAIN) lengkap dengan mutasi pembukaan.
- Kategori produk (template global, dipakai bersama `items-footwear.js`
  untuk `SANDAL`/`SEPATU`/`WIP`): 6 (`KAOS, KEMEJA, CELANA, SANDAL, SEPATU,
  WIP`).
- Produk WIP: 3 (`WIP-BADAN-KAOS`, `WIP-BADAN-KEMEJA`, `WIP-UPPER-SEPATU`).
- Produk jadi: 12 (3 KAOS, 2 KEMEJA, 2 CELANA, 2 SANDAL, 3 SEPATU), 3
  di antaranya memakai resep bertingkat (`WIP:<kode>`) — `KAOS-001` →
  `WIP-BADAN-KAOS`, `KMJ-001` → `WIP-BADAN-KEMEJA`, `SPT-001` →
  `WIP-UPPER-SEPATU`.
- Total baris `manufacturing.bom_items`: 80 (produk WIP + produk jadi).
  `manufacturing.raw_material_bom_items`: sengaja 0 — Fase 0 tidak memakai
  resep bahan-ke-bahan (beda dari `items-footwear.js` yang punya campuran
  lem).
- Stok awal produk jadi: 12 baris `inventory.finished_goods_inventory`.
- Sinkron POS: 12 `pos.pos_products` dengan `product_kind = 'merchandise'`,
  `source_product_id` ke produk apparel, SKU prefix `APL-<kode>` (sengaja
  beda dari prefix `PUR-` yang dipakai `items-footwear.js`/Dusun Bambu agar
  tidak bentrok — kode produk `SND-00x`/`SPT-00x` kebetulan sama dengan
  footwear Sulu tapi scoped per company, sedangkan SKU POS bersifat global).
- Isolasi terbukti: `item.products` SULU tetap 108 baris dan Dusun Bambu
  tetap 20 baris sebelum & sesudah seeding; `pos_products` footwear
  (`PUR-SND-001`, `PUR-SPT-001`, dst.) tidak berubah `source_product_id`.
- **Harga bahan baku & harga jual adalah ASUMSI demo lokal**, bukan hasil
  survei pasar (dicatat di header `apparel-items.js`).
- Dilewati secara sengaja: bagian "contoh produksi" (`production_orders`)
  milik `items-footwear.js` — Fase 0 hanya master data, sesuai instruksi
  task. Juga tidak ada resep bahan-ke-bahan (`raw_material_bom_items`)
  karena tidak diminta epic untuk Fase 0.

### Fase 1A — Matriks varian di master produk → auto-SKU

- [ ] `src/lib/pos/merchandise-variants.ts` (murni, teruji): tipe
      `VariantAxis { key: "ukuran" | "warna" | string; values: string[] }`,
      `expandMatrix(axes)` → daftar kombinasi `options`, `buildSkuCode(baseSku,
      options)` deterministik (mis. `KAOS-001-M-HTM`), `buildSkuName`,
      `diffMatrix(existing, wanted)` → `{ create, deactivate, keep }`.
- [ ] `POST /api/pos/products/[id]/skus/matrix`: body `{ axes, price_override?,
      barcode_prefix? }`; gate `product_kind = 'merchandise'` (reuse cek yang
      ada); satu transaksi: buat SKU yang belum ada lewat `normalizeSkuPayload`,
      **nonaktifkan** (bukan hapus) SKU yang tidak lagi ada di matriks bila
      `stock_quantity = 0`, tolak dengan 409 bila SKU ber-stok akan hilang.
      Idempoten: kirim matriks yang sama dua kali = no-op.
- [ ] UI master produk POS (`src/features/pos/products`): panel *Varian* —
      chip input per sumbu (Ukuran: S M L XL; Warna: Hitam Putih), pratinjau
      jumlah SKU, tombol *Generate*, tabel SKU hasil (kode, nama, barcode,
      harga override, stok, aktif). Reuse endpoint per-SKU yang ada untuk
      edit satu baris.
- [ ] Tampilkan ringkasan varian di daftar produk Items (`/dashboard/items`)
      untuk produk yang tertaut ke POS merchandise: badge `12 varian`.

**Acceptance:** produk *Kaos Sulu Basic* dengan sumbu 4 ukuran × 2 warna →
tepat 8 baris `pos_product_skus`, kode unik, `options = {ukuran, warna}`;
generate ulang dengan warna ketiga → +4 baris, 8 lama utuh; hapus satu ukuran
yang ber-stok → 409 dengan pesan jelas.

### Fase 1B — Output produksi per varian → stok per SKU

Jahitan utama epic ini. Semua di rute
`src/app/api/purchasing/production/orders/[id]/route.ts` + lib pendamping.

- [ ] Migration `2026MMDDHHMMSS_production_variant_output.sql`:
      `manufacturing.production_output_variants` (`production_order_id`,
      `production_batch_id`, `pos_sku_id` → `pos.pos_product_skus`, `qty`,
      `created_*`), unique `(production_batch_id, pos_sku_id)`; kolom
      `pos_sku_id` nullable di `inventory.finished_goods_movements` untuk jejak
      per varian. Idempoten (`IF NOT EXISTS`), dev.
- [ ] `src/lib/manufacturing/variant-output.ts` (murni, teruji):
      `validateVariantSplit(actualQty, rows)` — jumlah split **harus sama**
      dengan `actual_qty`, setiap `pos_sku_id` milik produk order, aktif, tidak
      duplikat; `requiresVariantSplit(product)` = produk tertaut POS
      merchandise **dan** punya SKU aktif (pola `variant_required` Fase B).
- [ ] API: `PATCH …/orders/[id]` menerima `variant_output: [{ pos_sku_id, qty }]`
      saat aksi **complete**. Bila `requiresVariantSplit` true dan split tidak
      dikirim/tidak valid → 400 dengan daftar SKU yang tersedia. Bila false →
      perilaku lama utuh (F&B, WIP, raw_material tidak berubah sama sekali).
- [ ] Posting stok di cabang FINISHED_GOOD, **setelah** insert
      `production_batches` dan **sebelum/selain** upsert
      `finished_goods_inventory`: simpan `production_output_variants`, lalu per
      SKU `UPDATE pos_product_skus SET stock_quantity = stock_quantity + qty`
      dalam transaksi yang sama; `finished_goods_inventory` level produk tetap
      dinaikkan sejumlah total (sumber HPP & laporan persediaan), dengan
      `finished_goods_movements.pos_sku_id` diisi per baris varian.
- [ ] Guard idempoten: complete dua kali pada order yang sama tidak menggandakan
      stok SKU (kunci pada `production_batch_id`).
- [ ] UI production order (`src/features/purchasing/production` atau lokasi
      form complete yang ada): saat produk ber-varian, form complete menampilkan
      tabel *Rincian per varian* (SKU, ukuran/warna, qty) dengan auto-hitung sisa
      = `actual_qty − Σ`, tombol *Bagi rata*, dan validasi sisa harus 0.
- [ ] Detail production order menampilkan rincian varian yang sudah diposting.

**Acceptance:** PO produksi *Kaos Sulu Basic* 100 pcs, complete dengan
S 20 / M 30 / L 30 / XL 20 → `pos_product_skus.stock_quantity` bertambah
persis itu, `finished_goods_inventory` +100, 4 baris `finished_goods_movements`
ber-`pos_sku_id`, HPP per pcs tidak berubah dari perhitungan lama; kirim
split berjumlah 90 → 400; complete order F&B tanpa varian → jalur lama, nol
regresi.

### Fase 1C — Kasir & laporan membaca stok per SKU

- [ ] Verifikasi kasir POS (`/dashboard/pos/tablet`) untuk produk merchandise
      ber-varian **wajib** memilih SKU (sudah ada dari Fase B) dan stok yang
      ditampilkan adalah `stock_quantity` SKU, bukan `inventory_quantity`
      produk. Perbaiki bila ada celah.
- [ ] Laporan Items → stok produk jadi: kolom *per varian* (expand) untuk
      produk ber-SKU; total tetap dari `finished_goods_inventory`.
- [ ] Stock opname produk (`product_stock_opname`): dukung baris per SKU untuk
      produk ber-varian (opsional bila waktu; bila ditunda, catat di *Tidak
      termasuk*).

**Acceptance:** setelah Fase 1B, kasir menjual *Kaos Sulu Basic M Hitam* →
stok SKU M-Hitam turun 1, SKU lain utuh, void mengembalikan ke SKU yang sama.

### Fase 2 — GRN per varian (beli barang jadi dari vendor)

Ditandai *fase lanjut* oleh migration Fase B §6. Dikerjakan **setelah** 1A–1C
stabil.

- [ ] `purchase_order_items` + `grn_items`: kolom `pos_sku_id` nullable.
- [ ] Form PO/GRN untuk produk ber-varian: baris per SKU.
- [ ] `pos_receive_merchandise_stock` versi per-SKU (atau fungsi baru
      `pos_receive_merchandise_sku_stock`) dipanggil dari `grn-qc.ts`.
- [ ] Guard: GRN produk ber-varian tanpa `pos_sku_id` → ditolak (bukan
      menambah stok level produk secara diam-diam seperti sekarang).

## Acceptance Criteria

- Apparel hidup sebagai company `SULU-APPAREL` terpisah; data Sulu F&B dan
  Dusun Bambu tidak berubah satu baris pun (diff `item.*` per `company_id`).
- Master produk merchandise bisa mendefinisikan matriks ukuran × warna dan
  menghasilkan SKU deterministik; generate ulang idempoten; SKU ber-stok tidak
  bisa hilang tanpa sengaja.
- Production order produk ber-varian **tidak bisa** diselesaikan tanpa rincian
  per varian yang jumlahnya tepat; setelah selesai, stok mendarat per SKU dan
  total produk tetap konsisten (`Σ stock_quantity SKU == kenaikan
  finished_goods_inventory` untuk order itu).
- Produksi F&B, WIP, dan `raw_material` **tidak berubah perilaku** — dibuktikan
  test regresi memakai seeder Dusun Bambu (`PROD-DB-*`) dan footwear lama.
- HPP per unit dan laporan persediaan level produk tidak berubah rumus.
- Kasir menjual dan mengembalikan stok pada SKU yang benar.
- Semua seeder memanggil `assertLocalTarget()`; tidak ada data contoh yang ikut
  ke production.
- Vitest penuh lulus; test baru untuk `merchandise-variants.ts` dan
  `variant-output.ts` (murni) + test rute complete dengan/ tanpa varian.

## Verifikasi lokal yang direncanakan

E2E lewat API sebagai `demo@suluapparel.id`: seed → buat matriks 4×2 →
buat PO produksi 100 pcs → complete tanpa split **ditolak** → complete dengan
split 20/30/30/20 → cek stok SKU & `finished_goods_inventory` → jual 1 M-Hitam
di kasir → void → stok kembali. Lalu ulangi complete pada order F&B Dusun
Bambu untuk membuktikan nol regresi.

## Tidak termasuk (fase berikutnya)

BOM per varian (kain berbeda per ukuran), harga jual per varian di master
Items (cukup `price_override` SKU), size-run otomatis dari histori penjualan,
barcode printing, stock opname per SKU bila ditunda dari 1C, dan storefront /
Xendit / Biteship / Shopee (sudah ada di EPIC-039 Fase D–F).

## Dependencies

- EPIC-039 Fase A–B (`pos_product_skus`, `product_kind='merchandise'`,
  `source_product_id`) — sudah ada di `development`.
- EPIC-046 (pola scope company/branch untuk tenant kedua) — sudah ada.
- Seeder `items-footwear.js` sebagai cetakan Fase 0 — sudah ada.

## Checklist rilis ke production

Jalankan hanya bila owner memanggil `MODULE-APPAREL`:

1. Apply migration `production_variant_output` (Fase 1B) dan, bila Fase 2
   sudah masuk, migration kolom `pos_sku_id` di PO/GRN.
2. Promosi lewat **cherry-pick commit kode** (pola rilis 2026-09-07), bukan
   merge penuh — seeder `apparel*.js` tinggal di `development`.
3. Setelah live: buat company apparel & master produk asli lewat UI; tidak ada
   data contoh yang ikut.

## Automation Log

- 2026-09-09 — Epic dibuat dari audit kode & DB bersama owner; status
  `backlog` sampai owner menyalakan.
- 2026-09-09 /task-work EPIC-047 #1 "Fase 0 — Company `SULU-APPAREL` + master
  dasar (seeder lokal)" → PASS (attempts: 1). Gate: review-qa PASS (3 catatan
  LOW/INFO), security PASS (assertLocalTarget sebelum koneksi di ketiga entry
  point, bcrypt, semua DELETE/UPDATE ber-scope), test PASS (node --check,
  seeder end-to-end + rerun idempoten, isolasi SULU=108 / Dusun Bambu=20 tetap,
  vitest 221 berkas / 1828 test). Verifikasi browser sebagai
  `demo@suluapparel.id`: 35 bahan baku dan 15 produk apparel tampil di Items.
  MR dibuat via `push -o merge_request.create` ke `development` (nomor dicatat
  saat merge). Tidak ada GitLab issue yang cocok dengan judul task — dilanjutkan
  tanpa referensi penutup.
