# EPIC-026: Purchasing Barang Operasional (Non-F&B, Non-Jual)

status: coding
environment: dev
retries: 0

## Goal

Menambah domain purchasing KETIGA untuk **barang operasional** — dibeli untuk
kebutuhan internal venue, BUKAN bahan baku F&B dan BUKAN barang yang dijual di
POS (mis. ATK, spare part, consumable maintenance, perlengkapan venue).

Keputusan arsitektur (owner 2026-07-23): **perluas modul purchasing yang sudah
ada lewat `module_type` ketiga — jangan bangun modul baru.** Seluruh mesin
siklus PR → PO → Receive (GRN) → Return → Invoice → Approval + manajemen
pemasok sudah teruji untuk scope `raw_material` & `product`; menambah scope
ketiga = menyalin pola yang sudah ada, bukan menulis ulang.

Barang operasional bersifat **campuran**: sebagian di-*expense* saat diterima
(ATK habis pakai), sebagian **di-stok** (spare part disimpan & dipakai
bertahap) — dibedakan per item lewat flag `stockable`.

## Evidence

- `purchasing.purchase_requests.module_type` & `purchasing.purchase_orders.module_type`
  sudah jadi diskriminator (`raw_material` | `product`) via CHECK constraint —
  migrasi template: `20260702130000_purchase_requests_module_type.sql` +
  `20260702140000_product_purchase_orders.sql`.
- `purchase_order_items` sudah pola XOR diskriminan `raw_material_id` /
  `product_id` + CHECK `purchase_order_items_item_target_check`.
- Backend sudah route-aware: `parsePurchasingModuleType()`
  (`src/lib/purchasing/module-scope.ts`) + cabang `if (moduleType === 'product')`
  di `src/app/api/purchasing/po/route.ts` (dan ±14 route purchasing lain).
- Master item terpisah per domain: `item.raw_materials` (F&B+BOM),
  `item.products` (punya `harga_jual` → katalog jual). Barang operasional tak
  cocok keduanya → butuh master sendiri.
- Pemasok: `purchasing.suppliers` (RM) & `purchasing.vendors` (product);
  `purchase_orders.supplier_id` sudah nullable + ada `vendor_id`.
- Nav/route per-scope: `PRODUCT_ROUTES` / `PRODUCT_NAV_GROUPS` di
  `src/modules/purchasing/constants/item-routes.ts` & `items-nav.ts` = template.

## Scope (task groups PR-sized)

**A. Fondasi domain + master item**
1. Nilai `module_type` ketiga: **`general`** (label UI "Barang Operasional",
   namespace route `/dashboard/general`) — konfirmasi final key/label/route di
   awal grup ini.
2. Longgarkan 2 CHECK constraint `module_type` (`purchase_requests`,
   `purchase_orders`) agar menerima `general`.
3. Master item baru `item.supply_items` (kode, nama, `unit_id`, `category_id`,
   `stockable boolean NOT NULL DEFAULT false`, `is_active`, tenant cols) +
   kategori/unit reuse pola master yang ada. `stockable=false` → di-expense saat
   terima; `true` → masuk inventory.
4. Kolom FK `supply_item_id` di `purchase_order_items` &
   `purchase_request_items`; relaksasi XOR jadi "tepat satu dari tiga".
5. Extend view `v_purchase_orders` (join supply meta) — jangan pecah scope lama.

**B. Siklus dokumen — DIPECAH BERTAHAP (temuan 23 Jul, lihat Automation Log)**

Realita: scope `product` BUKAN toggle query-param melainkan **klon pipeline
penuh** — 8 folder feature `product-*`, ~40 route fisik di
`items/product/*`, rewrites `next.config.ts`, 26 baris `iam-menus.sql` + grant,
`module_type` di-hardcode per-feature (`api.ts`). Maka `general` dibangun
bertahap (keputusan owner: irisan vertikal dulu). Cakupan akhir yang dipakai:
**PR + PO + Receive + Invoice + Approval** (TANPA Return, Delivery, Production/BOM).

- **B1 — Master barang operasional** (fondasi; harus ada barang dulu):
  master `supply_items` + `supply_categories` (kategori reuse route generik
  `/api/purchasing/items/[lookup]`), API CRUD ramping (tanpa warehouse/COGS/BOM
  ala product), feature + UI master, menetapkan pola routing/menu `general`.
- **B2 — PR general**: cabang `general` di `pr/form-data` (sumber item =
  `supply_items`) + `pr/route.ts` (filter GET + insert `supply_item_id`) +
  `pr-schemas.ts`; feature `general-pr` (clone `product-pr`, `MODULE_TYPE`),
  form `general-pr-form`, route+menu. Di sini tipe `PurchasingModuleType` &
  union sempit `returns/*/grn/*` dilebarkan ke `general`.
- **B3 — PO general**: `po/form-data` + `po/route.ts` (`generalPoSchema`,
  insert `supply_item_id`) + feature/form/route/menu; reuse tabel `vendors`.
- **B4 — Receive (GRN) general**: cabang di grn/receiving-workspace; percabangan
  stok vs expense (Task C) menyatu di sini.
- **B5 — Invoice + Approval general**: cabang invoice + approval PR/PO.

**C. Percabangan stok vs expense**
9. Receive item `stockable=false` → tandai diterima TANPA membuat pergerakan
   stok/valuasi (hook expense menyusul, lihat Non-Goals).
10. Receive item `stockable=true` → reuse pergerakan inventory yang ada.
11. Nav scope `general`: tampilkan Inventory (Stock/Opname/Adjustment/Transfer)
    hanya untuk item stockable; sembunyikan BOM/Produksi.

## Non-Goals (fase lanjut)

- Posting jurnal expense otomatis ke Finance/GL untuk item non-stok (v1 cukup
  status "diterima"; integrasi akuntansi menyusul).
- Modul aset tetap / depresiasi (capex) — barang modal keluar scope EPIC ini.
- Budgeting per departemen / cost center untuk permintaan barang operasional.
- Migrasi data historis (belum ada data barang operasional).

## Acceptance Criteria

- [ ] Bisa buat master `supply_item` dengan flag `stockable`; item operasional
      tidak muncul di katalog POS maupun daftar raw material.
- [ ] Siklus penuh PR → PO → Receive → Invoice jalan untuk `module_type=general`
      tanpa menyentuh/menghitung scope `raw_material` & `product` (filter
      `module_type` fail-safe di semua list).
- [ ] Item `stockable=false` diterima TIDAK menambah stok/valuasi; item
      `stockable=true` menambah stok lewat inventory yang ada.
- [ ] Constraint `purchase_order_items` tetap menjamin tepat satu target item
      (raw_material XOR product XOR supply).
- [ ] Approval PR/PO memakai workflow yang sama; tenant isolation fail-closed di
      semua endpoint scope `general`.
- [ ] Menu `general` tidak menampilkan BOM/Produksi; nav Inventory hanya relevan
      untuk item stockable.

## Progress B1 (master barang operasional) — SELESAI & LIVE

- **Backend** (commit `7cdfb5d`): kategori `supply-categories` via route generik
  `/api/purchasing/items/[lookup]`; item master `/api/purchasing/supply-items`
  (+`/[id]`) ramping tanpa warehouse/COGS/BOM, scope company+branch fail-closed.
- **UI + menu + routing** (commit ini): feature `src/features/purchasing/supply-items/*`
  (data layer + `SupplyItemsPage`: list + dialog buat/ubah + hapus, flag `stockable`,
  dropdown kategori & satuan); halaman kategori reuse `ItemsLookupPage`. Route fisik
  `/dashboard/items/general/{items,categories}` (langsung, TANPA rewrite next.config —
  KISS). Menu via migrasi `20260723220000_purchasing_general_menu.sql`: grup
  `items.general` "Barang Operasional" > `master` > {items, categories}, grant 9 role
  (sama dengan master product).
- **Verifikasi**: typecheck baseline (0 tambahan), migrasi menu diuji rollback lalu
  apply, build hijau (3 route baru terkompilasi), PM2 restart, smoke:
  `/api/purchasing/supply-items`=401, `/dashboard/items/general/items`=307 (bukan 404).
- **QA manusia**: login role purchasing/warehouse → menu "Barang Operasional" muncul →
  buat kategori → buat barang stockable & non-stockable → edit/hapus.
- **Lanjut B2**: PR general (cabang `general` di pr/form-data + pr/route + pr-schemas,
  feature `general-pr`, form, route/menu) — di sini `PurchasingModuleType` + union
  sempit `returns/*`,`grn/*` dilebarkan ke `general`.

## Progress B2 (PR barang operasional)

- **B2a backend SELESAI & terverifikasi** (belum deploy — belum ada UI PR general):
  - `pr-schemas.ts`: `generalPrItemSchema` (`supply_item_id`) + `generalPrWriteSchema`,
    `PrModuleType` += `general`, `parsePrWriteBody` cabang general, tipe union
    `PrWriteItem` (collapse union-of-arrays → array-of-union agar insert TS bersih),
    map error `pr_items_supply_item_id_fkey`.
  - `pr/route.ts`: GET filter += general; POST derive moduleType general + insert
    `supply_item_id`.
  - `pr/[id]/route.ts`: detail resolve `supply_item` (mirror product); PUT moduleType
    general + insert `supply_item_id`.
  - `pr/form-data/route.ts`: cabang `general` → item dari `item.supply_items`
    (key `supplies`), scope company+branch.
  - Verifikasi: typecheck baseline (0 tambahan), alur create(header+item supply)+
    filter module_type=general+detail-join diuji langsung ke Postgres (rollback).
  - CATATAN: hanya `PrModuleType` (pr-schemas) yang dilebarkan — `PurchasingModuleType`
    (module-scope) & union `returns/grn/*` TIDAK perlu disentuh di B2 (PR tak memakainya),
    jadi tak ada cascade 7-error. Union itu untuk B4/B5.
- **Sisa B2 (B2b frontend)**: feature `general-pr` (clone `product-pr`, MODULE_TYPE),
  form ramping (tanpa vendor-price-list, harga dari supply_items), route fisik
  `/dashboard/items/general/purchasing/pr/*`, menu `items.general.purchasing.pr`.

## Test Plan

- Typecheck + build hijau; migrasi apply bersih di dev (idempoten, pola
  `IF NOT EXISTS` seperti template).
- Uji regresi scope lama: buat 1 PO `raw_material` + 1 `product`, pastikan
  daftar & total masing-masing tak tercampur PO `general`.
- Uji percabangan stok: terima 1 item `stockable=false` (stok tetap) + 1
  `stockable=true` (stok naik) dalam 1 GRN.
- Uji constraint: coba insert `purchase_order_items` dengan dua FK item terisi →
  ditolak DB.
- Smoke: role pembeli buka `/dashboard/general/*`, alur PR→PO→Receive→Invoice.

## Automation Log

- 2026-07-23: Epic dibuat setelah analisis modul purchasing bersama owner.
  Keputusan: (a) REUSE modul via `module_type` ketiga, bukan modul baru —
  seluruh mesin PR→PO→GRN→Return→Invoice→Approval dipakai ulang; (b) barang
  operasional = campuran expense/stok → master item `supply_items` ber-flag
  `stockable`; (c) reuse tabel `vendors` untuk pemasok; (d) tanpa BOM/Produksi.
  Template implementasi = cara scope `product` ditambahkan (migrasi
  20260702130000 + 20260702140000). Implementasi belum dimulai.
- 2026-07-23: **Task Group A SELESAI** (migrasi
  `20260723210000_purchasing_general_supply.sql`, applied di dev). Isi:
  - CHECK `module_type` di `purchase_requests` & `purchase_orders` dilonggarkan
    menerima `general`.
  - Master baru `item.supply_items` (ber-flag `stockable`) + `item.supply_categories`
    (mirror `raw_material_categories`); unik per-tenant `(company_id,branch_id,kode)`.
  - Kolom `supply_item_id` + FK di `purchase_order_items` & `pr_items`.
  - Diskriminan item PO dilonggarkan `raw_material XOR product` →
    `num_nonnulls(raw_material_id, product_id, supply_item_id) = 1`. Diuji: supply
    saja lolos, dua target ditolak, nol ditolak, raw_material saja tetap lolos
    (regresi aman).
  - **Deviasi dari asumsi Scope**: (1) tabel item PR bernama `purchasing.pr_items`
    (bukan `purchase_request_items`) dan TAK punya CHECK diskriminan → cukup tambah
    kolom. (2) Master pakai konvensi asli: `kategori` varchar denormalisasi +
    `satuan_id` FK ke `item.units` (bukan `category_id`/`unit_id`). (3) View
    `v_purchase_orders` = level header (join vendor sudah ada) → TIDAK diubah.
    (4) Pelebaran tipe TS `PurchasingModuleType` ditunda ke Task B — ada union
    sempit duplikat `"raw_material"|"product"` di `src/features/purchasing/returns/*`
    yang harus dilebarkan bersamaan saat wiring feature layer (menghindari 7 error
    TS menggantung di Task A).
  - Verifikasi: migrasi apply bersih (ledger tercatat), typecheck tetap di baseline
    (463 error pre-existing, 0 tambahan). Belum ada perubahan runtime → tak perlu
    rebuild/PM2. Lanjut Task B: cabang `module_type='general'` di route
    PR/PO/GRN/Return/Invoice + route/menu `/dashboard/general`.
