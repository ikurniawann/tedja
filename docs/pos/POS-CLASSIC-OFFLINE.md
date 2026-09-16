# POS Classic & Mode Offline

Status: live 2026-09-16. Menu **POS → Operasional → POS Classic** (`/dashboard/pos/classic`).

## POS Classic

Kulit kasir gaya klasik (tombol besar, keypad angka) untuk layar sentuh — engine
sama dengan POS utama (`usePosCart`, `usePosProducts`, `usePosCheckout`,
`PaymentModal`, `CustomizationModal`, `printThermalReceipt`). POS utama tidak diubah.

- Kode: `src/features/pos/classic/`, route `src/app/dashboard/(dashboard)/pos/classic/page.tsx`.
- Shell tanpa sidebar: `isPosImmersiveShell` (`src/features/pos/tablet-mode.ts`).
- Menu & hak akses: migrasi `20260916100000_pos_classic_menu.sql` — meniru grant menu Kasir.
- Pemilih stall ada di header (sidebar disembunyikan). Satu stall → dipilih otomatis.
  Server menolak transaksi bila user "semua stall" belum memilih stall aktif.
- Belum di Classic (diarahkan ke POS utama): gift card, merchandise ber-SKU, tap NFC,
  promo/offer, split bill, open bill.

## Mode offline

| Lapisan | Mekanisme | Berkas |
|---|---|---|
| Halaman bisa dibuka tanpa internet | Service worker: `/_next/static` cache-first; navigasi & RSC `/dashboard/pos/*` dan GET API katalog/pengaturan kasir network-first dengan fallback cache. Respons redirect (mis. ke /login) tidak pernah di-cache. | `public/sw.js`, registrar `src/features/pos/classic/components/pos-offline-registrar.tsx`, allowlist `/sw.js` di `src/lib/auth/middleware.ts` |
| Katalog & pelanggan | IndexedDB `arkiv-pos-db` (sudah ada sebelumnya) | `src/lib/pos-db.ts`, `use-pos-products.ts`, `use-pos-customers.ts` |
| Transaksi offline | Payload `createOrder` disusun oleh `buildOfflineOrderPayload` (pemetaan item identik dengan `use-pos-checkout`) lalu masuk antrian IndexedDB; struk sementara `OFFLINE-…`. | `src/lib/pos/offline-sync.ts`, `src/hooks/use-pos-offline.ts` |
| Sinkron otomatis | Event `online` (+1,5 dtk) dan interval 45 dtk selama antrian belum kosong. Gagal jaringan/5xx → tetap `pending` (dicoba lagi); ditolak server (validasi/stok/stall) → `failed`, kasir memilih **Coba Lagi** atau **Buang**. Item tersangkut `syncing` dipulihkan saat halaman dibuka. | `use-pos-offline.ts` |
| Indikator | Badge header "N menunggu sinkron · M gagal" → dialog antrian. | `classic-cashier-page.tsx` |

Batasan yang disengaja:

- Offline hanya tunai / QRIS statis / kartu. ARK Coin, gift card, NFC tab, FOC butuh validasi server.
- Nomor order resmi baru terbit saat sinkron; struk offline memakai nomor `OFFLINE-…`.
- Stok dicek saat sinkron, bukan saat transaksi offline; penolakan muncul sebagai item `failed`.
- Belum ada kunci idempoten di server: bila sinkron terputus tepat setelah server menyimpan
  tetapi sebelum respons sampai, order bisa terkirim dua kali (item tetap `pending`).
- Auto-sync juga aktif di POS utama (hook yang sama); tombol "Sync Now" lama tetap ada.

Uji E2E (Playwright, scratchpad `e2e-offline.js`): buka Classic online → SW precache
(30 chunk + 1 halaman + 6 API) → `setOffline(true)` + reload → halaman & 8 produk tampil →
bayar tunai → `OFFLINE-…` + badge 1 → `setOffline(false)` → terkirim otomatis 2 dtk →
order `paid` 2 item ada di `pos.pos_orders` (dihapus lagi setelah uji).
