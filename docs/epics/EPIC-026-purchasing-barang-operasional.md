# EPIC-026: Purchasing Barang Operasional (Non-F&B, Non-Jual)

status: on-progress
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

**B. Siklus dokumen (reuse mesin)**
6. Cabang `module_type === 'general'` di route PR/PO/GRN/Return/Invoice/Approval
   (`src/app/api/purchasing/*`) + schema Zod item bercabang ke `supply_item_id`.
7. Pemasok: reuse tabel `vendors` (pola product scope) untuk barang operasional.
8. Route & menu: duplikat `PRODUCT_ROUTES`/`PRODUCT_NAV_GROUPS` jadi
   `GENERAL_ROUTES`/`GENERAL_NAV_GROUPS`; TANPA grup Production/BOM.

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
