# Task: POS Journal Mapping, KDS, Nomor Antrian

## Goal
Integrasi jurnal POS (cash-basis), KDS tampilkan semua order belum diproses kitchen/bar (termasuk bayar langsung), nomor antrian pendek harian saat Order/Payment.

## Plan
- [x] Delta: `queue_number` + RPC harian atomik; perbaiki seed journal mapping POS (DISCOUNT/SC/TAX optional)
- [x] `ensureQueueNumber` pada open-bill, checkout, table-order/split/transfer; tampil receipt + KDS + toast
- [x] Payment jangan `completed`; KDS filter item belum served; status per station; persist station di checkout
- [x] `lib/pos/accounting-*` + hook POST checkout, PATCH pay, split pay
- [x] Void cek `payment_status`; orders list lunas vs dapur; test amount/method

## Review
- Jurnal POS: `postPosSaleAccountingJournals` setelah lunas (cash/QRIS/card/ARK/gift). NFC Tab skip. Split pakai document id pembayaran split.
- Template mapping: DISCOUNT + SERVICE_CHARGE optional, TAX `is_required=false`.
- KDS: order paid tetap `status=pending` sampai kitchen/bar selesai; bump per station; tab Kitchen/Bar filter item aktif.
- Antrian: `queue_number` 001… harian per company/branch, tampil besar di receipt/KDS/toast.
- Void lunas ditolak via `payment_status=paid`. Tab orders "Lunas" memakai payment_status.
- Migrasi: `database/migrations/deltas/20260809070000_pos_queue_number_journal_mapping.sql` — jalankan `npm run db:migrate:apply`.

## Items Station (user input)
- [x] Delta `item.products.station` + `v_products_cogs.station`
- [x] Form insert/edit Items: field Station (kitchen/bar/bakery/dessert/merchandise/photobooth)
- [x] Create/update + apply-recipe-hpp sync `pos_products.station` dari input user
- Migrasi: `database/migrations/deltas/20260809120000_item_products_station.sql` — jalankan `npm run db:migrate:apply`.

## KDS bump Konfirmasi
- [x] `kitchen_status` boleh `confirmed` (delta check constraint) + map order→item 1:1
- [x] Toast + loading tombol bump; group KDS pakai `station_status`

## TV antrian customer
- [x] `/pos/queue` fullscreen: Sedang disiapkan vs Siap diambil, nomor besar, poll 3s + bunyi ready
- [x] Entry dari KDS (ikon TV) dan kasir (TV Antrian)
- [x] Fix `useTheme must be used within ThemeProvider`: AppSidebar Suspense fallback tanpa ThemeToggle
- [x] Menu IAM `pos.kitchen.queue-board` — POS → Dapur & Cetak → TV Antrian (`/pos/queue`)

## UI insert/edit produk
- [x] Layout 8+4 seperti master Bahan Baku; field 2 kolom; harga sidebar; BOM table style PR
- [x] Token semantik (tanpa pink keras); toast stall Indonesia

## Printer Bluetooth kasir
- [x] Pairing 1x di `/dashboard/pos/printer-settings` (Hubungkan + Test print + baud)
- [x] Modal Print Struk kasir hanya cetak, tanpa tombol pairing
