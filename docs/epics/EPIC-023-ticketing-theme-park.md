# EPIC-023: Ticketing Theme Park — NFC Postpaid, Harga Musiman & Channel Manager

status: coding
environment: dev
retries: 0

## Goal

Membangun modul **Ticketing** untuk skenario theme park sebagai modul baru di
sistem ini (jaga-jaga bisnis berkembang membangun theme park). Tiga pilar:

1. **NFC Postpaid (bukan deposit)** — pengunjung **daftar dulu di loket**,
   diberi **gelang/kartu NFC**, lalu: tap NFC di **gate** → tagihan tiket
   masuk tercatat; di dalam area, tap NFC di kasir **F&B** → pembelian
   menumpuk di tagihan NFC; semua **dibayar sekali di akhir** saat keluar
   (settlement di POS).
2. **Ticket management proper** — master jenis tiket (**child/adult**),
   matriks harga per **musim (regular/high season)** dengan kalender musim
   yang bisa diatur owner.
3. **Channel manager** — distribusi tiket ke kanal penjualan: **walk-in**
   (loket) dan **website booking** (beli online, dapat kode booking, tukar
   gelang NFC di loket), dengan harga per kanal.

## Konteks Repo (hasil scoping 2026-07-21)

Infrastruktur existing menutup ±70% kebutuhan — modul ini lebih banyak
merangkai daripada membangun dari nol:

- **NFC layer sudah jadi**: `src/features/pos/nfc/` (PC/SC ACR1555 +
  keyboard wedge + bridge), `pos_customers.nfc_uid`
  (delta `20260713100000`), pola scan→aksi di
  `src/features/pos/cashier/nfc-scan-action.ts`.
- **POS F&B lengkap**: `pos_orders` + `pos_order_items` +
  `pos_split_payments`, katalog `pos_products` + varian/modifier, resep
  `pos_recipes` + pengurangan stok via RPC transaksi
  (`migrations/004_pos_transaction_rpc.sql`). Penjualan F&B di dalam park
  = order POS biasa, hanya metode bayarnya baru ("NFC Tab").
- **Ledger stored-value**: `pos_wallet_transactions`
  (balance_before/after) — pola ledger dicontoh untuk tab postpaid, tapi
  arah saldo terbalik (menumpuk tagihan, bukan mengurangi saldo).
- **Booking template**: `pos_reservations` + `src/features/pos/reservation/`.
- **Pembayaran online**: Xendit sudah terintegrasi (topup ARK Coin) —
  dipakai ulang untuk website booking prepaid.
- **Tenancy & migrasi**: pola `company_id` + `branch_id` + delta
  `database/migrations/deltas/YYYYMMDDHHMMSS_*.sql` (preseden sales-funnel
  F1), menu/role via delta `iam.menus`/`iam.roles`.
- **Yang benar-benar baru (greenfield)**: konsep tiket & harga musiman,
  sesi kunjungan (visit/tab) postpaid, tap-charge di gate, channel manager.

## Keputusan Owner (2026-07-21)

1. **Multi mekanisme bayar DISETUJUI** — tiga mekanisme hidup
   berdampingan: (a) **prepaid/deposit** — top-up saldo ke gelang NFC di
   awal, tap memotong saldo, sisa di-refund saat keluar; (b) **standar**
   — cash/QRIS/EDC langsung di kasir POS existing (tanpa gelang);
   (c) **postpaid** — tagihan menumpuk di gelang, bayar di akhir.
   Implementasi: `ticket_visits.payment_mode` (`postpaid`/`prepaid`) di
   atas **ledger tab yang sama** — prepaid punya baris `deposit`, saldo =
   deposit − charges; postpaid dijaga credit limit. Alur gate/F&B/
   settlement satu kode, hanya aturan validasi & akhir cerita yang beda.
2. **Gelang bisa perorangan ATAU rombongan** — untuk settlement keluarga
   / anak kecil, satu pembayar men-settle beberapa gelang sekaligus
   (visit group); gelang tunggal tetap bisa settle sendiri.
3. **Credit limit WAJIB** untuk mode postpaid (konfigurable per venue,
   default di setting) — di atas limit, tap F&B ditolak & diarahkan
   bayar parsial.
4. **High season = kalender manual** — rentang tanggal bernama yang
   diatur owner (mis. "Libur Lebaran 2027"); weekend/tanggal merah
   otomatis menyusul nanti.
5. **Re-entry = konfigurable di Ticketing Settings** (`sekali-masuk` /
   `bebas-keluar-masuk`) — masih dilema, jadi jangan di-hardcode;
   default awal ditentukan saat Fase B.

## Keputusan Menunggu Owner (blocker sebelum on-progress)

1. **Kategori tiket**: cukup `child`/`adult`, atau + `toddler` (gratis) /
   `senior`? Batas kategori pakai **umur** atau **tinggi badan** (praktik
   umum theme park)?
2. **Website booking**: bayar di muka via Xendit (rekomendasi — kanal
   online prepaid, tap gate tidak men-charge lagi karena tiket sudah
   lunas), atau ikut postpaid juga?
3. **Kebijakan gelang hilang**: denda berapa? Tagihan tab-nya bagaimana
   (tetap ditagih by data, gelang diblokir)? Untuk mode prepaid, sisa
   saldo gelang hilang dikembalikan atau hangus?
4. **Penempatan modul**: theme park = **branch/venue baru** di hierarki
   existing (rekomendasi — tenancy `company_id`+`branch_id` langsung
   bekerja) atau entitas terpisah?

## Prinsip Desain

1. **Modular & opsional** — modul Ticketing berdiri sendiri (menu, skema
   DB, role); venue yang tidak punya theme park tidak melihat menu ini.
2. **Gelang NFC = aset berputar, bukan identitas member.** UID gelang
   di-assign ke sesi kunjungan (visit) saat registrasi dan dilepas saat
   settlement — beda dengan `pos_customers.nfc_uid` (kartu member
   permanen). Pengunjung boleh opsional ditautkan ke member loyalty untuk
   XP/riwayat.
3. **F&B numpang POS existing** — jangan bikin kasir kedua. Order F&B
   tetap `pos_orders` (stok/resep/laporan shift jalan otomatis), hanya
   ada metode pembayaran baru **"NFC Tab"** yang memindahkan tagihan ke
   visit, bukan menerima uang.
4. **Tab = ledger append-only** — setiap charge (tiket, F&B, penalti,
   koreksi) satu baris; total tagihan = SUM ledger. Void = baris
   pembalik, bukan delete. Settlement transaksional (`withTransaction`).
5. **Tenant-scoped** — semua tabel WAJIB `company_id` + `branch_id`
   (tiket adalah aset bisnis per venue), mengikuti preseden sales-funnel.
6. **Harga = matriks yang di-resolve saat charge**: `jenis tiket × musim
   (dari tanggal kunjungan) × kanal` → satu harga pasti. Harga yang sudah
   ter-charge di-snapshot di ledger (perubahan master tidak mengubah
   tagihan berjalan).

## Fitur (Rincian)

### 1. Master Tiket & Harga Musiman
- **Jenis tiket**: child/adult (extensible: toddler/senior/disabled),
  dengan definisi batas (umur/tinggi) sebagai teks aturan di loket.
- **Kalender musim**: daftar musim bernama dengan rentang tanggal +
  tipe (`regular`/`high`); resolusi tanggal → musim (default `regular`
  bila tak ada yang cocok; high season menang bila overlap).
- **Matriks harga**: jenis tiket × musim × kanal → harga. UI grid
  sederhana ala spreadsheet. Validasi: tidak boleh ada lubang harga untuk
  kanal aktif.

### 2. Registrasi & Gelang NFC (Loket Masuk)
- **Registry gelang**: stok gelang per venue (uid, label fisik, status
  `tersedia`/`dipakai`/`hilang`/`rusak`) — scan sekali untuk mendaftarkan
  gelang baru ke sistem.
- **Registrasi kunjungan (walk-in)**: petugas loket input komposisi
  rombongan (X adult + Y child), nama & no. WA penanggung jawab
  (opsional tautkan member), **pilih mode bayar**: `postpaid` (bayar di
  akhir, credit limit aktif) atau `prepaid` (top-up saldo sekarang —
  terima cash/QRIS di loket, tercatat sebagai baris `deposit` di tab),
  lalu **tap gelang satu per satu** → tiap gelang terikat 1 tiket
  (kategori tertentu) dalam 1 **visit group**. Top-up ulang di dalam
  area bisa dilakukan di kasir mana pun (mode prepaid).
- **Redeem booking online**: input/scan kode booking → data rombongan &
  tiket prepaid terisi otomatis → tinggal tap gelang.
- Visit berstatus `open` sejak registrasi; belum ada charge sampai tap
  gate (keputusan #7 menentukan detail).

### 3. Gate — Tap Masuk (Charge Tiket)
- **Mode Gate**: halaman fullscreen khusus (tablet + reader NFC di gate,
  reuse `pos-nfc-shell`) — tap gelang → tampil hijau/merah + kategori
  tiket + nama rombongan.
- Tap pertama → **charge tiket** ke tab visit dengan harga hasil resolve
  matriks (kecuali tiket prepaid online → tandai `digunakan` tanpa
  charge). Tap ulang → sesuai kebijakan re-entry (keputusan #7).
- Gelang tak dikenal / visit sudah `settled` / gelang `hilang` → merah +
  alasan. Semua tap tercatat di log gate (audit & hitung traffic).

### 4. F&B di Dalam — Tap Bayar ke Tab
- Di kasir POS existing: metode pembayaran baru **"NFC Tab"** — tap
  gelang di layar pembayaran → order lunas secara kasir (masuk
  `pos_split_payments` method `nfc_tab`), tagihannya pindah jadi baris
  charge di tab visit (referensi `order_id`).
- Guard per mode: visit harus `open`; **postpaid** → total tab setelah
  order ≤ credit limit; **prepaid** → saldo (deposit − charges) cukup.
  Gagal guard → tolak dengan pesan jelas + arahkan bayar
  parsial/top-up. Pengunjung tanpa gelang tetap bisa bayar
  cash/QRIS/EDC/Ark Coin seperti biasa (mekanisme standar, nol perubahan).
- Stok/resep/KDS/laporan shift jalan seperti order biasa — nol perubahan
  di alur dapur.

### 5. Settlement — Kasir Keluar
- Tap gelang (atau cari by nama/WA) → tampil **rincian tagihan**: tiket
  per kepala + daftar order F&B + penalti (+ deposit yang sudah masuk,
  untuk prepaid); settle **per gelang** atau **satu rombongan
  sekaligus** (satu pembayar untuk keluarga/anak kecil).
- **Postpaid**: bayar total via layar pembayaran POS (cash/QRIS/EDC,
  split payment existing). **Prepaid**: sisa saldo di-**refund**
  (baris `refund-deposit` di ledger); kurang saldo → bayar selisih.
  Sukses → visit `settled`, gelang kembali `tersedia`, struk gabungan.
- Kasus khusus: gelang hilang (denda + settle by data), visit menginap
  >1 hari operasional (daftar "tab menggantung" untuk ops), void charge
  oleh supervisor (baris pembalik + alasan).

### 6. Channel Manager
- **Master kanal**: `walk-in` & `website` (MVP), extensible ke OTA/agen
  (harga per kanal sudah disiapkan di matriks; alokasi kuota per kanal =
  fase lanjutan).
- **Website booking (public page)**: pilih tanggal kunjungan → sistem
  resolve musim & tampilkan harga per jenis tiket → isi jumlah adult/
  child + data pemesan → bayar Xendit (reuse pola topup) → **kode
  booking + QR** dikirim via WA/email; halaman status booking.
- **Kuota harian** (kapasitas venue per tanggal, opsional MVP): booking
  online berhenti saat kuota penuh; walk-in warning saja.
- Kelola booking di dashboard: daftar per tanggal, status
  (`menunggu-bayar`/`terbayar`/`digunakan`/`kedaluwarsa`/`dibatalkan`),
  refund manual = catatan status (uang dikembalikan di luar sistem, MVP).

### 7. Laporan & Monitoring
- **Traffic**: pengunjung per hari/jam (dari log gate), breakdown
  child/adult, occupancy vs kuota.
- **Revenue**: tiket vs F&B, per kanal, per musim; ATV per pengunjung.
- **Tab monitor (live)**: visit open saat ini, total tagihan berjalan,
  tab menggantung/lewat jam operasional.
- **Gelang**: stok per status, riwayat gelang hilang/denda.
- Rekonsiliasi kasir keluar nyambung ke closing report shift existing.

### Non-Goals (MVP)
- Integrasi OTA nyata (Traveloka/tiket.com) — struktur kanal disiapkan,
  koneksi API menyusul.
- Dynamic pricing otomatis (surge), paket bundling tiket+F&B, annual
  pass/season pass, akses wahana per-tiket (semua tiket = general
  admission dulu).
- Hardware turnstile terintegrasi (gate = petugas + tablet + reader dulu).
- Refund otomatis Xendit.

## Desain Data (sketsa — skema `ticketing`, prefix `ticket_`)

Semua tabel: `company_id`, `branch_id`, `created_by`, timestamps.

- `ticket_types` — code (`adult`/`child`/…), name, rule_note (batas
  umur/tinggi), sort_order, is_active.
- `ticket_seasons` — name, season_kind (`regular`/`high`), start_date,
  end_date, is_active. (Resolusi: high menang bila overlap; default
  regular.)
- `ticket_channels` — code (`walk-in`/`website`/…), name, is_active,
  is_online (butuh pembayaran di muka).
- `ticket_prices` — ticket_type_id × season_kind × channel_id → price.
  Unique constraint per kombinasi.
- `ticket_bands` — nfc_uid (unique per venue), label, status
  (`tersedia`/`dipakai`/`hilang`/`rusak`).
- `ticket_bookings` — booking_code (unique), channel_id, visit_date,
  contact_name/phone/email, status, total_amount,
  xendit_transaction_id, expires_at; child `ticket_booking_items`
  (ticket_type_id, qty, unit_price).
- `ticket_settings` — konfigurasi per venue: re_entry_policy
  (`sekali-masuk`/`bebas-keluar-masuk`), default_credit_limit,
  default_payment_mode, dsb. (satu baris per branch).
- `ticket_visits` — visit group: contact_name/phone, customer_id
  (nullable FK `pos_customers`), booking_id (nullable),
  **payment_mode (`postpaid`/`prepaid`)**, status
  (`open`/`settled`/`void`), credit_limit (postpaid), opened_at,
  settled_at, settled_order_ref.
- `ticket_visit_bands` — visit_id × band_id + ticket_type_id +
  entered_at (tap gate pertama), status per gelang.
- `ticket_visit_charges` — **ledger tab dua arah**: visit_id, band_id
  (nullable), charge_type (`tiket`/`fnb`/`denda`/`koreksi` = debit;
  `deposit`/`refund-deposit`/`pembayaran` = kredit), direction
  (`debit`/`kredit`), description, amount (snapshot), pos_order_id
  (nullable FK `pos_orders`), price_context (jsonb: type/season/channel
  saat resolve), voided_by_charge_id. Saldo/total tagihan = agregat
  ledger; prepaid: kredit − debit ≥ 0, postpaid: debit − kredit ≤ limit.
- `ticket_gate_events` — band_uid, visit_id (nullable), gate_label,
  result (`masuk`/`ditolak-…`), created_at. Append-only.

Integrasi POS: nilai baru `nfc_tab` di `pos_split_payments.payment_method`
+ kolom/referensi `visit_id` pada pembayaran tersebut (atau cukup
`reference_number` = visit id — putuskan saat Fase C).

Migrasi via `database/migrations/deltas/<timestamp>_ticketing_fase_a.sql`
dst. Menu + role (`ticketing` / reuse kasir) via delta `iam.*`.

## Task Groups (PR-sized, 1 group = 1 branch = 1 PR)

### Fase A — Fondasi: skema, menu, master tiket & harga
- Delta migrasi: skema `ticketing` + tabel master (`ticket_types`,
  `ticket_seasons`, `ticket_channels`, `ticket_prices`, `ticket_bands`,
  `ticket_settings`) + seed default (adult/child, kanal walk-in/website)
  + menu "Ticketing" granted `super_admin`.
- Route `src/app/dashboard/(dashboard)/ticketing/settings`, feature
  `src/features/ticketing/masters/`: CRUD jenis tiket, kalender musim,
  grid matriks harga, registry gelang (scan-untuk-daftar), dan
  **Ticketing Settings** (kebijakan re-entry, default credit limit,
  default mode bayar).
- Resolver harga `src/lib/ticketing/pricing.ts` (tanggal+tipe+kanal →
  harga) — unit test lengkap (edge: overlap musim, lubang harga).

### Fase B — Visit Core: registrasi, gate tap-charge, settlement
- Delta: `ticket_visits`, `ticket_visit_bands`, `ticket_visit_charges`,
  `ticket_gate_events`.
- Loket masuk: form registrasi rombongan + **pilih mode bayar
  (postpaid/prepaid + top-up awal)** + tap-assign gelang
  (reuse `src/features/pos/nfc/`).
- Mode Gate fullscreen: tap → charge tiket (idempotent per kebijakan
  re-entry dari `ticket_settings`), layar hijau/merah, log gate.
- Kasir keluar: rincian tab per gelang/rombongan, settlement
  transaksional reuse layar pembayaran POS (postpaid: bayar total;
  prepaid: refund sisa saldo), gelang release, struk. Top-up ulang
  saldo prepaid di kasir.

### Fase C — F&B on Tab
- Metode pembayaran "NFC Tab" di kasir POS: tap gelang → validasi visit
  open + credit limit → tulis `pos_split_payments` (`nfc_tab`) + baris
  charge di tab (satu transaksi DB).
- Void order ber-nfc_tab → baris pembalik di tab.
- Tab monitor live di dashboard ticketing.

### Fase D — Channel Manager: website booking
- Delta: `ticket_bookings` + items. Public page `src/app/booking/`
  (pilih tanggal → harga musiman → bayar Xendit → kode booking + QR via
  WA gateway).
- Redeem kode booking di loket masuk (prepaid: tap gate tanpa charge).
- Dashboard kelola booking + kuota harian (opsional).

### Fase E — Laporan & Ops
- Laporan traffic, revenue tiket vs F&B per kanal/musim, rekap gelang,
  tab menggantung; sambungan ke closing report shift.

## Acceptance Criteria (ringkas)

- Semua query ticketing terfilter `company_id` + `branch_id`; tidak ada
  kebocoran antar venue.
- Resolver harga deterministik: satu tanggal+tipe+kanal selalu → tepat
  satu harga; charge men-snapshot harga (ubah master ≠ ubah tab berjalan).
- Tap gate idempotent sesuai kebijakan re-entry; tidak mungkin double
  charge tiket untuk gelang yang sama di visit yang sama.
- Charge F&B + `pos_split_payments` ditulis dalam satu transaksi;
  gagal salah satu → rollback keduanya.
- Settlement menutup visit secara atomik; gelang kembali `tersedia`;
  visit `settled` menolak charge baru.
- Guard mode bayar ditegakkan di server (bukan hanya UI): postpaid
  tidak bisa melewati credit limit; prepaid tidak bisa bersaldo
  negatif; refund sisa saldo tercatat sebagai baris ledger.
- Settlement rombongan (multi-gelang, satu pembayar) dan settlement
  per gelang dua-duanya didukung dan atomik.
- Booking online tidak bisa digunakan 2x (status `digunakan` idempotent).
- Response API memakai envelope `successResponse`/`paginatedResponse`;
  role guard pola `src/lib/crm/server.ts`.

## Automation Log

- 2026-07-21 — Epic dibuat (status **backlog**, masih rencana owner).
  Scoping repo: NFC layer (`src/features/pos/nfc/`), ledger wallet,
  katalog F&B + resep + RPC stok, reservation template, dan Xendit topup
  semuanya reusable; greenfield = harga musiman, visit/tab postpaid,
  gate tap-charge, channel manager. 8 keputusan owner tercatat sebagai
  blocker sebelum on-progress.
- 2026-07-21 — Owner memutuskan 5 hal: (1) multi mekanisme bayar
  disetujui — prepaid/deposit + standar cash/QRIS + postpaid, via
  `payment_mode` per visit di atas ledger dua arah yang sama;
  (2) gelang bisa perorangan atau rombongan (settlement keluarga/anak);
  (3) credit limit wajib untuk postpaid; (4) high season = kalender
  manual; (5) re-entry konfigurable di Ticketing Settings (masih
  dilema, jangan hardcode). Sisa 4 keputusan menunggu: kategori tiket
  tambahan, prepaid-nya website booking, kebijakan gelang hilang,
  penempatan venue di hierarki.
- 2026-07-21 — **Fase A SELESAI** (status `coding`). Delta
  `20260722060000_ticketing_fase_a.sql` applied: skema `ticketing` +
  6 tabel master (`ticket_types`, `ticket_seasons`, `ticket_channels`,
  `ticket_prices`, `ticket_bands`, `ticket_settings`) + menu
  "Ticketing → Pengaturan Tiket" granted `super_admin`. Halaman
  `/dashboard/ticketing/settings` (section: jenis tiket, kalender
  musim, matriks harga, registry gelang, kebijakan operasional).
  Resolver harga murni `src/lib/ticketing/pricing.ts` — 13 unit test
  lulus (overlap musim high menang, lubang harga → null wajib tolak).
  Keputusan implementasi: seed master TIDAK di migrasi (tabel
  ber-tenant) — bootstrap adult/child + kanal walk-in/website terjadi
  saat pertama buka `/api/ticketing/settings`; guard role pola
  `requireTicketingContext` (super_admin, venue fallback
  `crm_settings`); UID NFC dinormalisasi hex uppercase
  (`normalizeNfcUid`, min 8 hex).
- 2026-07-21 — **Fase B SELESAI** (status `coding`). Delta
  `20260722070000_ticketing_fase_b.sql` applied: `ticket_visits`,
  `ticket_visit_bands` (unique index parsial — satu gelang tak bisa
  aktif di 2 visit), `ticket_visit_charges` (ledger append-only + CHECK
  `chk_charge_direction`), `ticket_gate_events`; menu Loket & Kasir +
  Mode Gate granted super_admin/pos_supervisor/pos. **Keputusan arah
  ledger**: `refund-deposit` = DEBIT (sketsa epic menulis kredit, tapi
  refund mengurangi titipan — visit settled selalu berakhir debit =
  kredit). Lib murni `tab.ts` (16 unit test): computeTabSummary,
  canCharge (guard saldo prepaid / plafon postpaid), settlementPlan.
  API: register visit (kunci gelang FOR UPDATE ORDER BY id), top-up
  prepaid, settle rombongan + settle per gelang (postpaid saja;
  prepaid wajib settle rombongan utk refund), gate tap idempotent
  (entered_at + kebijakan re-entry; harga 0 = tiket comp sah, masuk
  tanpa baris ledger); semua ber-rate-limit (`checkRateLimit`) dan
  serialisasi via `ticket_visits FOR UPDATE`. UI: Loket (registrasi
  tap-beruntun, tabel visit + settle/top-up dialog) & Mode Gate
  fullscreen (PC/SC bridge + keyboard wedge, layar hijau/merah).
  Gate hasil: security review 0 CRITICAL/HIGH (2 MEDIUM ditutup:
  company_id di cek duplikat gelang, rate limit; pembulatan 2dp per
  baris ledger), code review 0 CRITICAL/HIGH (log gate branch tanpa
  kanal, guard due=0 settle per-gelang, active_band_count di list —
  semua ditutup). Verifikasi: build lulus, lint bersih, 29 unit test,
  smoke test SQL end-to-end (register → tap → settle → ledger seimbang
  → gelang release) lulus dgn rollback. **Hutang teknis dicatat**:
  belum ada integration test route ber-uang (butuh infra mock auth —
  konsisten dgn preseden sales-funnel, unit + smoke SQL dulu).
- 2026-07-21 — **Fase C SELESAI** (status `coding`). Delta
  `20260722080000_ticketing_fase_c.sql` applied: enum `nfc_tab` di
  `pos_payment_method`, CHECK arah dilonggarkan (`koreksi` boleh dua
  arah utk baris pembalik void), + index unik parsial
  `uq_ticket_visit_charges_fnb_order` (1 order = 1 charge fnb aktif,
  lapis DB). **Keputusan implementasi** (opsi di sketsa epic): order
  single-payment menyimpan metode di `pos_orders.payment_method`
  langsung — TIDAK menulis `pos_split_payments`; tautan ke tab =
  `ticket_visit_charges.pos_order_id`. Jembatan
  `src/lib/ticketing/tab-server.ts`: `chargeFnbOrderToTab`
  (transaksional, lock visit, guard saldo/plafon dicek ulang di dalam
  lock, idempotent per order, `markOrderPaid` menandai order
  completed/paid DI transaksi yang sama — charge & status tak mungkin
  terpisah) + `checkTabForCharge` (pratinjau PaymentModal). Kasir:
  metode "NFC Tab" di PaymentModal (panel tap + pratinjau nama/mode/
  sisa; opsi tersembunyi tanpa prop `onCheckNfcTab`), dukung checkout
  langsung & bayar open bill; nilai dioper eksplisit ke
  `handleCreateOrder` (setState + panggilan setick = stale closure).
  Void supervisor: endpoint `charges/[chargeId]/void` (super_admin/
  pos_supervisor, baris pembalik `koreksi` kredit, sekali per baris)
  + tombol Void di dialog (disembunyikan utk kasir). Tab monitor:
  `tab/stats` + 4 kartu di Loket (refresh 30 dtk); closing shift
  menampilkan bucket `nfc_tab` di method_breakdown (bukan uang masuk
  shift — ditagih saat settlement). Gate hasil: security review
  1 CRITICAL ditutup (**PATCH /api/pos/orders/[id] tanpa gerbang
  auth — celah lama, kini 401 + rate limit**), audit log percobaan
  gagal, index unik DB; code review 2 HIGH ditutup (nominal charge
  nfc_tab = turunan server bukan total_amount klien; atomisitas
  charge+paid satu transaksi), order partial ditolak, kompensasi
  delete dicek error + fallback cancelled. Catatan disengaja: void
  charge fnb TIDAK mengubah `pos_orders.payment_status` (order tetap
  paid; pembalikan hidup di ledger tab — rekonsiliasi lewat ledger).
  Verifikasi: 33 unit test, build lulus, smoke SQL Fase C (enum,
  charge ber-referensi order, dup-check, baris pembalik, ledger
  netral pasca void, fnb-kredit ditolak) lulus dgn rollback.
