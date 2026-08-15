# Task: QRIS kasir auto-selesai seperti tunai

## Goal
Setelah pelanggan bayar QRIS, order langsung checkout + modal antrian
muncul — tanpa klik Confirm payment.

## Plan
- [x] Helper `isXenditQrPaid` + tes
- [x] GET `/api/pos/qris/[id]/status` (poll Xendit QR + payments)
- [x] PaymentModal poll ~2.5s, auto-`onConfirm` saat lunas
- [x] Sembunyikan Confirm saat QR dinamis aktif; fallback Confirm jika QR gagal
- [x] Verifikasi tes unit

## Review
- QRIS dinamis: kasir tidak klik Confirm. Poll Xendit tiap 2.5s.
- Lunas → `handleCreateOrder` yang sama dengan tunai → modal antrian.
- QR gagal dibuat: Confirm tetap ada (QR statis meja).
