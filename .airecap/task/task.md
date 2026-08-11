# Task: POS 1 order = 1 stall (opsi 1)

## Goal
Kasir jual hanya di stall aktif; 1 `pos_orders` = 1 stall. Switch stall diblok jika cart berisi.

## Plan
- [x] Helper murni + test: resolve sell stall, cart-has-items, item stall check shape
- [x] Migration `pos_orders.warehouse_id`
- [x] Catalog: `resolvePosProductStallScope` ikut stall aktif (tolak "Semua Stall")
- [x] Checkout + open-bill: validasi item vs stall, stamp `warehouse_id`
- [x] StallSwitcher: blok ganti stall jika `pos_cart_state` punya items; extend switch ke user multi-stall
- [x] Laporan transaksi: filter/join `o.warehouse_id`
- [x] Verifikasi unit test

## Decisions
- Cart non-empty + switch stall → **blok** (bukan auto-clear)
- Mode "Semua Stall" → tidak boleh jual di POS
- Satu assignment → auto pakai stall itu

## Review
- Helper: `src/lib/pos/pos-sell-stall.ts` + server resolver
- Delta: `20260811080000_pos_orders_warehouse_id.sql` — **jalankan migrasi** sebelum deploy POS
- Catalog & checkout menolak mode Semua Stall / multi tanpa pilihan
- Switcher: toast blok jika cart berisi; `can_switch_stall` untuk multi-stall non-admin
- Laporan transaksi prefer `o.warehouse_id`, fallback legacy item-infer
- Test: `pos-sell-stall.test.ts` 12 passed; `tsc --noEmit` OK
