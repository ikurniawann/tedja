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

## Review
- Migrasi: `20260812140000_accounting_ar_documents.sql` applied
- Cek Journal Mapping: event SALE_* + role AR terisi COA 1201001 / 4101001 / 1102001
- Cash In/Out: jurnal langsung (bukan Journal Mapping event) tagged `source_module=CASH_BANK`
