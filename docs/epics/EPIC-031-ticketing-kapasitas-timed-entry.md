# EPIC-031: Ticketing — Kuota Harian, Kapasitas & Timed-Entry

status: on-progress
environment: local
retries: 0

## Goal

Menutup gap benchmark #2 vs accesso (lihat
[`BENCHMARK-ticketing-vs-accesso.md`](./BENCHMARK-ticketing-vs-accesso.md)):
venue bisa menetapkan **kuota pengunjung per tanggal** (dan nanti per slot
waktu), booking online berhenti otomatis saat penuh (**sold-out otomatis** di
kalender wizard), dan ops bisa melihat okupansi per tanggal. Menggantikan rem
manual satu-satunya saat ini: `blok-online` per rentang tanggal.

Konteks historis: kuota harian **sengaja di-defer** saat EPIC-023 Fase D1
(komentar migrasi `20260722130000`: "Kuota harian TIDAK ikut MVP (keputusan
2026-07-22); blok-online per tanggal (R1) adalah rem manualnya"). Epic ini
adalah pelunasan defer tersebut.

## Evidence — titik sambung sistem existing (audit 2026-07-25)

- **Skema kalender per produk**: `ticketing.ticket_product_dates` — date_kind
  `high-season` | `blok-online` (+ `blackout` dipakai season pass EPIC-028).
  Rentang tanggal + label + is_active. **Tidak ada kolom kapasitas/slot.**
- **Header booking**: `ticket_bookings` (visit_date, status
  `menunggu-bayar|terbayar|digunakan|kedaluwarsa|dibatalkan` + `hangus`
  EPIC-023 lanjutan). Index **`idx_ticket_bookings_venue_date`
  (branch_id, visit_date, status)** sudah ada — siap untuk hitung okupansi.
- **Hitungan per ORANG sudah ada**: `ticket_booking_guests` = 1 baris per
  orang (paket meledak per anggota); `totalQty` di create route dihitung
  per orang (`persons_per_unit`). Kuota harus konsisten pakai basis ini.
- **Jalur create booking**: `POST /api/public/booking/[slug]`
  (`src/app/api/public/booking/[slug]/route.ts`) — harga & kelayakan
  dihitung ulang server-side dari `buildPublicCatalog()`
  (`src/lib/ticketing/booking-server.ts`), insert dalam `withTransaction`.
  Titik enforcement kuota = di dalam transaksi ini.
- **Pelepasan kuota otomatis sudah ada jalurnya**: lazy expiry
  (`expireBookingIfDue`), webhook EXPIRED → `kedaluwarsa`, pembatalan
  dashboard → `dibatalkan`, penghangus 3 lapis (`booking-forfeit-watcher`).
  Status-status ini tinggal dikecualikan dari hitungan okupansi — **tidak
  perlu mekanisme release terpisah**.
- **Config per venue**: `ticket_settings` (re_entry_policy, credit limit,
  booking_slug) — anchor natural untuk kapasitas default venue.
- **UI kalender wizard**: `booking-calendar.tsx` (custom inline, redesign
  Airbnb 23 Jul) — tinggal diberi state disabled/sold-out per tanggal.
- **Pengaturan Tiket**: `/dashboard/ticketing/settings` — tempat UI kuota.
- **Loket walk-in**: `ticket_visits` TIDAK punya konsep visit_date kuota
  (kontrol fisik di gate) — lihat Keputusan Desain #3.

## Keputusan Desain (dikunci owner 2026-07-25 — lihat Automation Log)

1. **Model kuota MVP = venue-wide per tanggal** (kapasitas taman), bukan per
   produk — **DIKONFIRMASI owner**. Default venue di
   `ticket_settings.daily_capacity` (**NULL = unlimited** → perilaku
   sekarang, nol regresi; keputusan owner: memang ada venue/stok yang
   unlimited), override per rentang tanggal di tabel baru (pola sama dengan
   `ticket_product_dates`: start/end + label, mis. "Lebaran 5.000/hari").
   Kuota per produk/event = fase lanjut.
2. **Kuota dikonsumsi per ORANG oleh booking online** dengan status yang
   "memegang" kursi: `menunggu-bayar` (reservasi sementara — otomatis lepas
   saat kedaluwarsa invoice Xendit, jalur expiry existing), `terbayar`,
   `digunakan`. Status `kedaluwarsa|dibatalkan|hangus` tidak dihitung.
   Ini sekaligus = fitur **reservasi**: seat tertahan selama menunggu bayar.
3. **Walk-in loket IKUT mengurangi kuota** — **KEPUTUSAN OWNER 25 Jul**
   (mengubah usulan awal). Rincian:
   - 1 orang walk-in = 1 gelang terdaftar di visit (`ticket_visit_bands`);
     tanggal = `opened_at` dalam WIB. Visit `void` tidak dihitung; gelang
     dilepas/hilang tetap dihitung (orangnya sudah masuk).
   - **Anti dobel-hitung redeem**: visit hasil redeem booking
     (`ticket_bookings.visit_id` menunjuk visit itu) DIKECUALIKAN dari
     hitungan walk-in — orangnya sudah dihitung sebagai booking.
   - Loket saat kuota penuh: registrasi visit/tambah gelang **ditolak**
     dengan pesan jelas (enforcement server, bukan cuma UI). Override
     supervisor = tidak ada di MVP (fail-closed, konsisten gate).
   - Entry season pass (EPIC-028, `ticket_pass_entries`) BELUM dihitung di
     MVP — dicatat sebagai fase lanjut (lihat Open Questions).
4. **Anti-oversell: hitung ulang di bawah kunci, bukan counter.** Di dalam
   `withTransaction` (create booking DAN create visit/tambah gelang loket):
   `pg_advisory_xact_lock` per (branch_id, tanggal) → `COUNT` orang live
   dari bookings+guests dan visits+bands (index venue_date sudah ada) →
   tolak bila `terpakai + qty > kapasitas`. Konsisten dengan filosofi
   codebase ("jangan percaya state — hitung ulang"); counter reserved_count
   ditolak karena rawan drift dengan banyak jalur pelepasan status.
5. **Kapasitas boleh diturunkan di bawah okupansi berjalan** — booking
   existing tidak dibatalkan, hanya transaksi baru tertolak; UI pengaturan
   menampilkan peringatan bila okupansi > kapasitas baru.
6. **Timed-entry slot = fase terpisah di epic yang sama** (Fase D), di atas
   fondasi kuota harian — bukan digabung, supaya kuota harian bisa rilis
   duluan (pola horizontal EPIC-027).
7. **Publik hanya melihat penuh/tersedia** — **KEPUTUSAN OWNER 25 Jul**:
   tidak ada angka sisa kuota / badge "tersisa N" di halaman booking publik.
   Angka detail (booked/capacity) hanya di dashboard ops (Fase C).

## Fase

### Fase A — Skema + pengaturan kuota

| Task group | Scope (PR-sized) |
|---|---|
| **A1 Skema** | Migrasi: `ticket_settings.daily_capacity int NULL CHECK (>0)`; tabel baru `ticketing.ticket_capacity_dates` (company/branch, label, start_date, end_date, capacity int CHECK (>=0; 0 = tutup online), is_active, audit; CHECK end>=start; index (branch_id, start_date, end_date)). Capacity 0 = tanggal tutup penjualan online (superset blok-online venue-wide). |
| **A2 Resolver murni + test** | `src/lib/ticketing/capacity.ts`: `resolveDailyCapacity(date, settings, overrides)` — override menang atas default, overlap → capacity TERKECIL menang (konservatif; beda dari high-season). Unit test pola `pricing.test.ts`. |
| **A3 UI Pengaturan** | Seksi "Kapasitas Harian" di `/dashboard/ticketing/settings`: input default venue + CRUD rentang override (pola UI kalender high-season existing); peringatan bila okupansi tanggal berjalan > kapasitas baru. API `GET/PUT /api/ticketing/settings` diperluas + endpoint CRUD capacity-dates. |

### Fase B — Enforcement (online + loket) + sold-out di booking publik

| Task group | Scope (PR-sized) |
|---|---|
| **B1 Helper hitung + enforcement online** | Helper server `countCapacityUsed(branch, date)` (di `capacity` lib server): SUM guests booking status memegang-kuota + SUM gelang visit walk-in hari itu (WIB, exclude void & visit hasil redeem via `ticket_bookings.visit_id`). Dipakai di `POST /api/public/booking/[slug]` dalam transaksi: advisory lock (branch, visit_date) → hitung → `409` "kuota tanggal ini sudah penuh" bila melebihi. |
| **B2 Enforcement loket (walk-in)** | Enforcement yang sama di jalur loket: `POST /api/ticketing/visits` (registrasi visit + gelang) dan endpoint tambah gelang ke visit berjalan — advisory lock (branch, hari ini WIB) → hitung → tolak dengan pesan jelas bila `terpakai + jumlah gelang baru > kapasitas`. Redeem booking TIDAK kena cek ini (kuota sudah dipegang bookingnya). |
| **B3 Availability API** | `GET /api/public/booking/[slug]/availability?from&to` (maks 92 hari, pola reports): per tanggal → `{status: available\|sold_out\|closed}` — **tanpa angka sisa** (keputusan owner #7). 1 query agregat GROUP BY tanggal, BUKAN N+1. Rate-limit publik pola catalog. |
| **B4 Wizard sold-out** | `booking-calendar.tsx`: konsumsi availability → tanggal sold_out/closed disabled + label "Penuh"; guard langkah ringkasan re-check sebelum submit (pesan ramah bila keburu penuh). Tanpa badge angka sisa. |

### Fase C — Ops & visibilitas

| Task group | Scope (PR-sized) |
|---|---|
| **C1 Kalender okupansi** | Halaman/panel di dashboard Booking (`/dashboard/ticketing/booking`): kalender bulanan okupansi per tanggal (booked/capacity, %; warna); drill-down ke daftar booking tanggal itu (filter existing). |
| **C2 Laporan** | Kartu okupansi di `/dashboard/ticketing/reports` (rata-rata okupansi, tanggal penuh, potensi hilang saat sold-out) — pola net-void tidak relevan di sini (basis = bookings, bukan ledger). |

### Fase D — Timed-entry slot (lanjut, boleh rilis terpisah)

| Task group | Scope (PR-sized) |
|---|---|
| **D1 Skema slot** | `ticket_time_slots` (template per venue: label, start_time, end_time, capacity, is_active) + `ticket_bookings.slot_id NULL` (NULL = tiket sepanjang hari — backward compatible). Kuota slot ⊂ kuota harian. |
| **D2 Wizard + enforcement** | Langkah pilih jam di wizard (hanya bila venue punya slot aktif); enforcement pola B1 per (date, slot); availability per slot. |
| **D3 Gate window** | `gate/tap` & redeem loket validasi jam slot (grace period configurable, mis. ±30 menit; di luar → denied dengan alasan jelas, override supervisor = keputusan owner). |

**Dependensi:** A1 → A2 → A3; B setelah A2 (B1 → B2 & B3 paralel → B4);
C setelah B1; D setelah B stabil. Rilis bisa bertahap: A+B saja sudah menutup
"kuota harian + sold-out otomatis" untuk online sekaligus walk-in.

## Non-Goals (epic ini)

- Dynamic/demand-based pricing (gap #5 — epic terpisah).
- Kuota per produk/varian (fase lanjut bila ada kebutuhan event khusus).
- Hitung entry season pass ke kuota (fase lanjut — lihat Open Questions).
- Reserved seating peta kursi (gap #10), virtual queuing (gap #3).
- Waitlist / notifikasi "tanggal kembali tersedia".
- Override supervisor saat loket penuh (fail-closed di MVP).

## Acceptance Criteria

- [ ] Venue tanpa `daily_capacity` & tanpa override (= **unlimited**,
      keputusan owner) → perilaku identik sekarang (nol regresi; katalog,
      harga, blok-online, loket tetap).
- [ ] Booking online ditolak 409 saat orang terpakai + qty > kapasitas
      tanggal itu; dua booking bersamaan tidak bisa oversell (uji race:
      advisory lock terbukti serialisasi per tanggal).
- [ ] **Walk-in loket** ditolak (registrasi visit / tambah gelang) saat
      kapasitas hari ini penuh; walk-in yang masuk mengurangi sisa kuota
      online tanggal yang sama.
- [ ] **Tidak ada dobel hitung**: booking di-redeem jadi visit → total
      terpakai tanggal itu TIDAK bertambah (visit ber-`visit_id` booking
      dikecualikan dari hitungan walk-in).
- [ ] Booking `kedaluwarsa`/`dibatalkan`/`hangus` dan visit `void` otomatis
      melepas kuota (tanpa aksi tambahan — hilang dari hitungan).
- [ ] Kalender wizard menandai Penuh/closed (disabled) — **tanpa angka
      sisa** di publik; submit saat keburu penuh → pesan ramah, bukan 500.
- [ ] Override rentang tanggal menang atas default venue; overlap → kapasitas
      terkecil; capacity 0 menutup penjualan online + walk-in tanggal itu.
- [ ] Kalender okupansi dashboard menampilkan (booking + walk-in)/capacity
      per tanggal sesuai data.
- [ ] (Fase D) Booking ber-slot ditolak di gate di luar jendela slot+grace;
      booking tanpa slot tetap berlaku sepanjang hari.

## Test Plan

- **Unit** (`capacity.test.ts`): resolver default/override/overlap/0/NULL
  (unlimited); formula hitung: status memegang-kuota vs melepas, exclude
  visit redeem & void.
- **Integration/SQL smoke** (pola rollback EPIC-023): create booking sampai
  penuh → 409; walk-in saat penuh → ditolak; expiry → kuota terbuka lagi;
  redeem booking → hitungan tetap; race 2 transaksi paralel (online vs
  online, online vs loket).
- **API**: availability agregat konsisten dengan daftar booking + visits;
  rate limit.
- **UI**: wizard tanggal penuh disabled tanpa angka; loket pesan penuh;
  settings warning okupansi > kapasitas baru.
- **E2E happy path**: set kapasitas 3 → booking online 2 orang → walk-in 1
  → tanggal Penuh di kalender & loket tolak orang ke-4 → void visit →
  tersedia lagi.

## Open Questions (terjawab 2026-07-25, sisa yang terbuka di bawah)

1. ~~Venue-wide atau per produk?~~ → **Venue-wide dulu** (owner).
2. ~~Walk-in ikut mengurangi kuota?~~ → **Ya, dihitung** (owner; usulan awal
   "tidak" dibatalkan).
3. ~~Angka sisa ke publik?~~ → **Cukup penuh/tersedia**, tanpa angka; dan
   harus support venue/stok **unlimited** (daily_capacity NULL) (owner).
4. ~~Ambang "limited"~~ → gugur (tidak ada badge angka/limited di publik).
5. **MASIH TERBUKA**: Fase D (slot jam) langsung setelah A–C, atau tunggu
   kebutuhan riil venue (mis. sesi pertunjukan)?
6. **MASIH TERBUKA** (muncul dari keputusan #2): entry **season pass**
   (EPIC-028) ikut dihitung ke kuota harian? MVP: tidak — pass holder tak
   lewat loket/booking. Kalau taman sering penuh oleh pass holder, perlu
   fase lanjut hitung `ticket_pass_entries` granted.

## Automation Log

- 2026-07-25 — Epic dibuat dari gap benchmark #2 (accesso timed-entry &
  capacity). Audit titik sambung selesai: enforcement di transaksi create
  booking publik; pelepasan kuota menumpang jalur status existing (lazy
  expiry/webhook/hangus); hitung-di-bawah-kunci dipilih atas counter.
- 2026-07-25 — Owner menjawab open questions: (1) venue-wide dulu,
  (2) **walk-in DIHITUNG** (revisi desain: enforcement juga di loket
  `POST /visits` + tambah gelang, anti dobel-hitung visit redeem via
  `ticket_bookings.visit_id`, fail-closed tanpa override supervisor),
  (3) publik cukup penuh/tersedia tanpa angka + wajib support unlimited
  (daily_capacity NULL). Fase B dipecah B1–B4. Status → **on-progress**;
  siap mulai Fase A1.
- 2026-07-25 — **A1 SELESAI**: migrasi `20260725180000_ticketing_daily_capacity.sql`
  applied di dev — `ticket_settings.daily_capacity int NULL` (CHECK NULL/>0)
  + tabel `ticketing.ticket_capacity_dates` (label, start/end, capacity
  CHECK >=0, is_active, audit; index partial venue+range WHERE is_active).
  Verifikasi DB: kolom/tabel/index ada, kedua CHECK menolak nilai invalid.
- 2026-07-25 — **A2 SELESAI** (TDD red→green): `src/lib/ticketing/capacity.ts`
  — `resolveDailyCapacity` (override menang atas default, overlap → TERKECIL,
  0 = tutup, non-aktif diabaikan, tanggal invalid throw; reuse
  `isValidCalendarDate` pricing), `isCapacityExceeded` (null = unlimited
  tak pernah melebihi), konstanta `CAPACITY_HOLDING_BOOKING_STATUSES`
  (menunggu-bayar|terbayar|digunakan). 16 unit test `capacity.test.ts`
  hijau; regresi lib ticketing 87/87 hijau; nol error TS baru.
- 2026-07-25 — **A3 SELESAI (Fase A TUNTAS), live dev**: seksi "Kapasitas
  Harian" di Pengaturan Tiket (`capacity-section.tsx`, terpasang di
  `ticketing-settings-page.tsx`) — input default venue (kosong = unlimited)
  + CRUD override rentang tanggal (label/start/end/capacity, 0 = badge
  Tutup, toggle aktif, hapus). API: `GET/PUT /api/ticketing/settings`
  diperluas `daily_capacity` (partial update aman — kolom lain tak
  tersentuh); route baru `GET/POST /api/ticketing/capacity-dates` +
  `PATCH/DELETE /api/ticketing/capacity-dates/[id]` (super_admin via
  requireTicketingContext default; PATCH validasi rentang pakai nilai FINAL
  gabungan lama+patch; hard delete sah — baris murni konfigurasi). Feature
  layer masters: types/api/queries + query key `capacityDates`. CATATAN:
  peringatan "okupansi > kapasitas baru" versi LIVE ditunda ke Fase C
  (butuh `countCapacityUsed` B1) — A3 pakai teks statis penjelas
  konsekuensi. Verifikasi: tsc bersih di file tersentuh, 87 test hijau,
  build OK (BUILD_ID ada) → pm2 restart, smoke 307/401 normal, kedua route
  muncul di manifest build.
- 2026-07-25 — **Fase A di-commit** (69210aec feat; fac1bd10 docs EPIC-030+
  benchmark+registry). Baris registry EPIC-029 sengaja TIDAK ikut
  (kode EPIC-029 milik sesi lain masih uncommitted — patch parsial README).
- 2026-07-25 — **B1 SELESAI, live dev**: `src/lib/ticketing/capacity-server.ts`
  — `acquireCapacityLock` (pg_advisory_xact_lock hashtext(branch)+
  hashtext(date)), `loadEffectiveCapacity` (settings + override aktif →
  resolver murni), `countCapacityUsed` (1 query 2 subcount: guest booking
  status memegang-kuota + gelang visit non-void hari itu WIB dengan NOT
  EXISTS bookings.visit_id = anti dobel-hitung redeem),
  `assertCapacityAvailable` (cek murah tanpa lock bila unlimited → lock →
  resolve ULANG → hitung → `CapacityFullError` 409; pesan beda utk
  capacity 0 "tanggal ditutup"). Wiring `POST /api/public/booking/[slug]`:
  guard di AWAL withTransaction (sebelum insert, kompatibel retry 23505);
  catch route kini menerjemahkan statusCode → 409 (pola staff-passes).
  Verifikasi: tsc bersih; smoke SQL rollback 7 asersi OK (pending memegang
  kuota, walk-in terhitung, redeem TIDAK dobel, kedaluwarsa/void melepas,
  override terkecil menang); RACE test riil 2 transaksi paralel kapasitas 1
  → tepat 1 LOLOS 1 PENUH (advisory lock terbukti serialisasi), cleanup 0
  sisa. Build OK → pm2 restart, /booking/sulu 200. CATATAN penemuan: dev DB
  ternyata TIDAK punya ticket_types & registry gelang kosong — visit_bands
  kini ber-`variant_id` (revisi R1), smoke pakai gelang temp in-txn.
- 2026-07-25 — **B2 SELESAI, live dev**: guard kuota di `POST
  /api/ticketing/visits` — `assertCapacityAvailable` di AWAL withTransaction
  (sebelum lock gelang FOR UPDATE; urutan lock konsisten dgn jalur booking →
  bebas deadlock antar-jalur), tanggal = `todayJakartaDate()`, additional =
  `uids.length` (satuan + anggota paket, 1 gelang = 1 orang). Catch route
  sudah ber-pola statusCode → 409 otomatis. Scope temuan: TIDAK ada endpoint
  tambah-gelang mid-visit (registrasi one-shot) — guard cukup di POST;
  redeem booking insert visit sendiri di route redeem (line ~268) → bebas
  guard sesuai desain. Verifikasi: tsc bersih, build OK → pm2 restart,
  smoke 401/200 normal.
