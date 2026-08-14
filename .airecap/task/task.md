# Task: Accounting AP/AR native

## Goal
AP + AR sebagai modul kerja native di Accounting (spek 2026-08-12).

## Done
- [x] AP Phase 1 (schema, GRN→invoice, payment, payable, aging, deprecate Purchasing pay)
- [x] AR schema + SALE_AR_INVOICE / SALE_AR_RECEIPT mapping (module SALES)
- [x] AR store/API/UI: receivable, invoices, receipts, aging
- [x] B2B terbit (terkirim) → create AR invoice + jurnal
- [x] Lazy sync terkirim existing → AR
- [x] Finance pay POST 410; CTA “Terima di Accounting”

## Accounting Period soft close
- [x] Accounting Period list + open/close CTA
- [x] Period Closing wizard (block on DRAFT JE)
- [x] API GET `/api/accounting/fiscal-periods`, POST `.../close`
- Soft close only — no closing journals

## Cash In / Cash Out
- [x] Store: `createCashMovement` / `listCashMovements` / `listPostableAccounts`
- [x] API: `/api/accounting/cash-bank/cash-in|cash-out|accounts-options`
- [x] UI: list + DialogPanel form di `/dashboard/accounting/cash-bank/cash-in|cash-out`
- Cash In: Debit kas/bank, Credit akun lawan → JE MANUAL POSTED (`source_document_type=cash_in`)
- Cash Out: Debit akun lawan, Credit kas/bank → JE MANUAL POSTED (`source_document_type=cash_out`)

## Still optional / later
- [ ] AR Invoice non-B2B (manual) — menu masih bisa pakai list AR; create form belum
- [ ] Backfill AP dari GRN lama
- [ ] Hapus dual-write vendor_payments / deal_payments
- [ ] Detail pages AP/AR
- [x] Transfer: `/dashboard/accounting/cash-bank/transfer` — Debit tujuan, Credit asal, `source_document_type=cash_transfer`

## POS Manual Discount (item + transaksi)
- [x] Spec + plan
- [x] Helpers + unit tests (`manual-discount.ts`)
- [x] Migrasi `20260813090000_pos_manual_discount.sql` (applied)
- [x] Cart state + ManualDiscountDialog + CartPanel
- [x] Checkout + orders/open-bill server recompute stack

## POS Payment Methods master
- [x] Tabel `pos.payment_methods` + seed handler (cash/qris/credit/ark_wallet/nfc_tab/gift_card)
- [x] API GET/PATCH `/api/pos/payment-methods`
- [x] PaymentModal load dinamis (`?active=1`) + fallback default
- [x] Halaman `/dashboard/pos/payment-methods` + menu `pos.loyalty.payment-methods`
- ARK tetap `handler=ark_wallet` → skema wallet existing

- [x] PATCH campaign guard: edit aturan hanya jika `captured_count = 0` (toggle aktif tetap boleh)
- [x] PATCH/DELETE code: rename/limit/hapus hanya jika `usage_count = 0`
- [x] UI list: tombol Edit campaign; detail: edit/hapus voucher unused
- [x] Edit jumlah voucher (sync target count: generate / hapus unused)

## Tax & Service Settings UI
- [x] Spec + plan (Approach A reskin)
- [x] UI: kartu Tax + Service, fee/rounding di Pengaturan lanjutan
- [x] Menu `settings.billing` → **Tax & Service** (`20260813120000_settings_tax_service_menu.sql`)
- Route: `/dashboard/settings/billing` (POS path tetap redirect)

## POS menu regroup
- [x] Migrasi `20260813123000_pos_menu_regroup.sql`
- Grup: Operasional → Produk & Stok → Dapur & Cetak → Member → **Pengaturan** (baru) → Laporan
- Metode Bayar + Printer pindah ke Pengaturan; label ID (Pesanan/Meja/Antrian Cetak)

## Promo offer rules (admin CRUD)
- [x] Spec + plan (POS apply later)
- [x] Tabel `promo.offer_rules` + `offer_rule_items`
- [x] Menu CRM → Promo: Bundling / Buy X Get Y / Diskon Volume
- [x] API `/api/promo/offers` + UI CRUD
- [x] Integrasi kasir POS: evaluator + stack `offer_discount` + banner promo aktif
- [x] API `GET /api/pos/offer-rules` + server recompute di create order / open-bill

## Review
- Migrasi: `20260812140000_accounting_ar_documents.sql` applied
- Cek Journal Mapping: event SALE_* + role AR terisi COA 1201001 / 4101001 / 1102001
- Cash In/Out: jurnal langsung (bukan Journal Mapping event) tagged `source_module=CASH_BANK`
- Manual discount: stack item → offer → membership → promo → transaksi; type/value persisted

