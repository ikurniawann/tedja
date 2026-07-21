# EPIC-022: Sales Funneling — Leads B2B (Corporate, Sekolah & Booking Acara Privat)

status: on-progress
environment: dev
retries: 0

## Goal

Membangun modul **Sales Funneling** baru (menu terpisah dari CRM loyalty
existing) ala Freshsales/Freshworks yang disederhanakan, khusus untuk
**leads B2B**: corporate gathering, field trip sekolah, komunitas, dan booking
acara privat (ulang tahun, buyout venue). Kelola **prospek instansi + PIC-nya**,
dorong lewat **pipeline kanban** dari kontak pertama sampai acara ter-booking,
catat **aktivitas & follow-up** dengan pengingat WA, dan lihat **laporan
funnel** (conversion per tahap, win rate, nilai pipeline).

## Keputusan Owner (2026-07-21)

1. **Nama menu: "Sales Funneling".**
2. **Target lead = B2B/instansi**, bukan customer perorangan walk-in:
   corporate, sekolah, komunitas, travel agent, serta booking acara privat.
   Lead perorangan tetap bisa dicatat (jenis "perorangan") untuk acara privat
   seperti ulang tahun.
3. **Akses: Super Admin + role `sales` (baru).** Role `sales` belum ada di
   `iam.roles` → dibuat via delta di Fase A (preseden:
   `20260716150000_role_employee_ess.sql`). Catatan teknis: `sales` TIDAK
   dimasukkan ke `FULL_ACCESS_ROLES` (`src/lib/iam/access.ts`) — gerbang
   akses diperluas jadi route-aware agar `sales` boleh masuk
   `/dashboard/sales-funnel/*` (plus ESS-nya sendiri) tanpa membuka seluruh
   dashboard.
4. **Enam tahap pipeline default DISETUJUI**: `Prospek Baru → Dihubungi →
   Proposal/Penawaran → Nego/Survey Lokasi → Menang (Booked) → Kalah`
   (tetap konfigurable Super Admin).
5. **Pengingat WA dua arah**: follow-up jatuh tempo → WA ke penanggung
   jawab; owner dapat **rekap harian** ringkas (jumlah follow-up hari ini,
   deal macet, booking baru) — numpang infrastruktur EPIC-020 Notifikasi
   WA Owner.
6. **Scope per outlet** — setiap lead & deal terikat `outlet_id` (wajib,
   bukan nullable); filter outlet di semua list/kanban/laporan mengikuti
   scope bisnis user.

Referensi: https://www.freshworks.com/crm/sales/ — diambil 5 pilar intinya
(lead management, pipeline/deal kanban, 360° customer view, aktivitas, laporan),
DIBUANG semua yang enterprise: Freddy AI, email sequence, telephony bawaan,
territory management, forecasting kuartalan, workflow automation kompleks.
Pengganti otomasi = pengingat & template pesan via WA gateway existing.

## Prinsip Simplifikasi UMKM

1. **Satu pipeline default, tahap bisa diubah** — tidak ada multi-pipeline di
   MVP. Default 6 tahap mengikuti alur penawaran B2B venue:
   `Prospek Baru → Dihubungi → Proposal/Penawaran → Nego/Survey Lokasi →
   Menang (Booked) → Kalah`. Nama/urutan tahap konfigurable Super Admin.
2. **WA-first, bukan email-first** — UMKM Indonesia jualan lewat WA. Semua
   quick action & pengingat lewat WA gateway existing
   (`src/lib/whatsapp/gateway.ts` → `sendGatewayText()`), bukan email.
3. **Tanpa AI/skoring rumit** — lead "panas/hangat/dingin" cukup label manual.
4. **Nyambung ke ekosistem existing** — lead yang menang bisa ditautkan ke
   `pos.pos_customers` (member loyalty), sehingga 360° view menampilkan
   riwayat transaksi POS + status member CRM loyalty.
5. **Tenant-scoped** — beda dari member loyalty yang global by design
   (EPIC-011), semua tabel Sales CRM WAJIB `company_id` + `outlet_id`
   (leads/deals adalah aset bisnis per venue, bukan identitas platform).

## Fitur (Rincian)

### 1. Leads — Prospek B2B (Instansi + PIC)
- CRUD lead berorientasi instansi: **nama instansi**, **jenis instansi**
  (`corporate`, `sekolah`, `komunitas`, `travel-agent`, `pemerintah`,
  `perorangan`, `lainnya`), **PIC**: nama, jabatan, no. WA (wajib, kunci
  dedup), email opsional; kota/alamat, sumber (`wa`, `instagram`, `referral`,
  `google`, `pameran/canvassing`, `lainnya`), label suhu (panas/hangat/
  dingin), catatan, penanggung jawab (user sales).
- Satu instansi bisa punya lebih dari satu PIC (kontak sekunder opsional,
  cukup di catatan untuk MVP; tabel kontak terpisah menyusul jika perlu).
- Status lead: `baru → dihubungi → qualified → tidak-cocok`.
- Import CSV sederhana + deteksi duplikat by no. WA PIC / nama instansi.
- Konversi lead → deal (sekali klik, lead qualified otomatis buka deal di
  tahap pertama pipeline). Satu instansi bisa punya banyak deal (acara
  berulang: gathering tahunan, field trip per semester).

### 2. Pipeline & Deals — Kanban
- Papan kanban drag-and-drop per tahap (reuse pola
  `src/features/hris/pipeline/components/pipeline-page.tsx`,
  lib `@hello-pangea/dnd` sudah ada di deps).
- Kartu deal berorientasi acara: judul, **jenis acara** (`gathering`,
  `field-trip`, `ulang-tahun`, `buyout-venue`, `lainnya`), **tanggal acara
  (tentatif/fix)**, **estimasi pax**, nilai estimasi (Rp), instansi/PIC
  tertaut, penanggung jawab, umur deal di tahap (badge "macet" jika > X hari,
  X konfigurable).
- Tahap `Menang (Booked)` → wajib isi nilai final + tanggal acara fix;
  opsional tautkan PIC ke `pos_customers`. Tahap `Kalah` → wajib pilih alasan
  kalah (master konfigurable: harga, kompetitor, jadwal tidak cocok, tidak
  jadi acara, tidak respon, dll).
- Detail deal via Sheet (slide-over) berisi timeline aktivitas.

### 3. Profil Instansi 360°
- Halaman detail instansi: identitas + PIC, semua deal/acara
  (menang/kalah/berjalan) — terlihat instansi mana yang repeat order,
  timeline aktivitas, total nilai acara sepanjang riwayat, riwayat transaksi
  POS + tier member loyalty PIC (jika tertaut `pos_customers`), tombol
  Chat WA ke PIC.

### 4. Aktivitas & Follow-up
- Aktivitas per lead/deal: tipe (`telepon`, `wa`, `meeting`, `catatan`),
  due date, penanggung jawab, status selesai.
- Halaman "Follow-up Hari Ini" (agenda lintas deal, terlambat disorot).
- Pengingat WA otomatis ke penanggung jawab untuk follow-up yang jatuh
  tempo hari ini (pola cron/watcher existing ala `cs-sla-watcher.ts`).
- Template pesan WA (master sederhana) + tombol kirim cepat dari kartu deal.

### 5. Laporan Funnel
- Funnel conversion per tahap (berapa masuk, berapa lolos, % konversi).
- Win rate, total nilai pipeline berjalan, nilai menang (booking) per periode.
- Breakdown per **jenis instansi** & **jenis acara** (corporate vs sekolah vs
  privat), per sumber lead, dan per penanggung jawab (leaderboard sederhana).
- Kalender/daftar acara ter-booking ke depan (dari deal Menang + tanggal
  acara) — bahan koordinasi ke ops.
- Rekap alasan kalah.

### Non-Goals (MVP)
- Multi-pipeline, email campaign/sequence, lead scoring otomatis/AI,
  forecasting, integrasi kalender eksternal, round-robin assignment.
- Broadcast WA massal (sudah wilayah omnichannel EPIC-013).

## Desain Data (sketsa — skema `crm`, prefix `crm_sales_`)

Semua tabel: `company_id`, `outlet_id`, `created_by`, timestamps.

- `crm_sales_leads` — id, org_name, org_type (`corporate`/`sekolah`/
  `komunitas`/`travel-agent`/`pemerintah`/`perorangan`/`lainnya`), pic_name,
  pic_title, pic_phone (unik per company), pic_email, city, source,
  temperature, status, notes, owner_user_id, customer_id (nullable FK
  `pos_customers` — PIC sebagai member).
- `crm_sales_stages` — master tahap: name, sort_order, is_won, is_lost,
  stuck_threshold_days.
- `crm_sales_deals` — id, lead_id, title, event_type (`gathering`/
  `field-trip`/`ulang-tahun`/`buyout-venue`/`lainnya`), event_date,
  is_event_date_fixed, pax_estimate, stage_id, value_estimate, value_final,
  owner_user_id, lost_reason_id, entered_stage_at, closed_at.
- `crm_sales_activities` — id, deal_id/lead_id, type, due_at, done_at,
  owner_user_id, notes, reminder_sent_at.
- `crm_sales_lost_reasons` — master alasan kalah.
- `crm_sales_wa_templates` — master template pesan.

Migrasi via `database/migrations/deltas/<timestamp>_sales_crm_fase_a.sql` dst.
Menu didaftarkan via delta INSERT `iam.menus` + `iam.role_menu_permissions`
(contoh: `20260719190000_crm_settings_menu.sql`).

## Task Groups (PR-sized, 1 group = 1 branch = 1 PR)

### Fase A — Fondasi: skema DB, role `sales`, menu, Leads CRUD
- Delta migrasi: tabel + seed tahap default + **role `sales` baru di
  `iam.roles`** + menu "Sales Funneling" (group) dengan submenu Leads,
  granted ke `super_admin` + `sales`.
- Perluas gerbang akses `src/lib/iam/access.ts` (+ guard layout) jadi
  route-aware: role `sales` boleh `/dashboard/sales-funnel/*` + ESS, tanpa
  akses dashboard lain.
- Route `src/app/dashboard/(dashboard)/sales-funnel/leads`, feature
  `src/features/sales-funnel/leads/`, API `src/app/api/sales-funnel/leads`
  dengan role guard `super_admin`/`sales` (pola `src/lib/crm/server.ts`).
- Leads list (filter status/jenis instansi/sumber/owner), form dialog
  instansi+PIC, import CSV, dedup no. WA PIC.

### Fase B — Pipeline Kanban Deals
- Kanban drag-drop, konversi lead→deal, aturan tahap menang/kalah,
  konfigurasi tahap di Settings, badge deal macet.

### Fase C — Aktivitas, Follow-up & Pengingat WA
- CRUD aktivitas + timeline di Sheet deal, halaman Follow-up Hari Ini,
  watcher pengingat WA jatuh tempo, template pesan + kirim cepat.

### Fase D — Profil Instansi 360° & Integrasi Loyalty
- Halaman detail instansi (riwayat semua deal/acara, repeat order), tautan
  PIC ke `pos_customers` (riwayat POS + tier member), alur
  "Menang → jadikan PIC member".

### Fase E — Laporan Funnel
- Halaman laporan: funnel per tahap, win rate, nilai pipeline, per jenis
  instansi/acara, per sumber, per owner, kalender acara ter-booking,
  rekap alasan kalah.

## Acceptance Criteria (ringkas)

- Semua query leads/deals terfilter `company_id` (+ `outlet_id` bila relevan);
  tidak ada kebocoran antar tenant.
- Drag-drop kanban mempersist perubahan tahap dan mencatat `entered_stage_at`.
- Deal Kalah tidak bisa disimpan tanpa alasan; deal Menang tanpa nilai final.
- Pengingat WA terkirim maksimal 1x per aktivitas (idempotent,
  `reminder_sent_at`).
- Response API memakai envelope `successResponse`/`paginatedResponse`;
  role guard konsisten dengan pola `src/lib/crm/server.ts`.

## Automation Log

- 2026-07-21 — Epic dibuat (status backlog). Riset referensi Freshsales +
  eksplorasi repo: kanban reuse pola pipeline rekrutmen HRIS
  (`@hello-pangea/dnd`), WA via `sendGatewayText()`, tabel baru di skema
  `crm` prefix `crm_sales_` dengan tenant scoping `company_id`/`outlet_id`
  (beda dari member loyalty yang global by design per EPIC-011).
- 2026-07-21 — Keputusan owner: nama menu **"Sales Funneling"**; target lead
  **B2B/instansi** (corporate, sekolah, komunitas, booking acara privat).
  Model data diubah: lead = instansi + PIC (org_name, org_type, pic_*), deal
  membawa event_type + event_date + pax_estimate; tahap default jadi 6
  (tambah Proposal & Survey Lokasi); laporan breakdown per jenis
  instansi/acara + kalender acara ter-booking.
- 2026-07-21 — Keputusan owner: akses = **Super Admin + role `sales` baru**.
  Verifikasi repo: role `sales` belum ada di `iam.roles`;
  `FULL_ACCESS_ROLES = ["super_admin","hrd"]` di `src/lib/iam/access.ts:12`
  mengunci role lain ke ESS-only → Fase A wajib buat role via delta DAN
  memperluas gerbang akses jadi route-aware (sales → sales-funnel + ESS
  saja), BUKAN menambah `sales` ke FULL_ACCESS_ROLES.
- 2026-07-21 — Keputusan owner final (3 item PENDING terjawab): (1) enam
  tahap pipeline default disetujui; (2) pengingat WA ke penanggung jawab +
  rekap harian owner via infrastruktur EPIC-020; (3) scope **per outlet**
  (`outlet_id` wajib di leads & deals). Semua keputusan lengkap → status
  naik `backlog` → `on-progress`. Fase A siap dieksekusi.
- 2026-07-21 — **Fase A SELESAI & live di dev.** Konsistensi sistem: "per
  outlet" diimplementasikan sebagai `company_id` + `branch_id` (FK
  `configuration.companies/branches` — hierarki venue existing, bukan kolom
  outlet_id baru). Delta `20260721130000_sales_funnel_fase_a.sql` applied:
  6 tabel `crm.crm_sales_*`, seed 6 tahap + alasan kalah, role `sales`,
  menu `sales-funnel`/`sales-funnel.leads` (grant super_admin+sales, code
  ditambahkan ke whitelist retire `database/seeders/iam-menus.sql`).
  Gerbang akses route-aware: `ROLE_MODULE_PATHS`/`canAccessPath` di
  `src/lib/iam/access.ts` + `filterNavByPrefixes` (sales → sales-funnel +
  ESS, TIDAK masuk FULL_ACCESS_ROLES). API `/api/sales-funnel/leads`
  (list/create/update/delete/import CSV via CsvImporter+xlsx, dedup no. WA
  kanonik 62…), scope via `getApiUserScope`+`importBusinessIds`, fallback
  venue `crm_settings` default. UI `src/features/sales-funnel/leads/`.
  Gate review PASS (0 CRITICAL): temuan HIGH tenant-isolation fail-open
  (user tanpa scope company lolos filter) diperbaiki jadi fail-closed
  (`requireCompanyScope`), + validasi telepon pasca-normalisasi, UUID owner
  filter, email import. Build + typecheck bersih (0 error baru), migrasi
  terverifikasi di DB dev, PM2 restart, smoke test 200/401 OK.
  Belum: E2E login role sales (butuh akun uji — human QA).
- 2026-07-21 — **Fase B SELESAI & live di dev.** Pipeline Kanban Deals:
  delta `20260721160000_sales_funnel_fase_b.sql` applied — menu
  `sales-funnel.pipeline` (grant super_admin+sales) + `sales-funnel.settings`
  (super_admin saja), keduanya masuk whitelist retire `iam-menus.sql`.
  API: `GET/POST /api/sales-funnel/deals` (kanban + konversi lead→deal;
  lead baru/dihubungi otomatis qualified; deal mewarisi venue dari lead;
  masuk tahap pertama aktif), `PATCH/DELETE /deals/[id]` dengan aturan
  tahap — Menang wajib value_final + event_date (otomatis fix, closed_at
  diisi), Kalah wajib lost_reason_id, kembali ke tahap berjalan mereset
  closed_at/lost_reason, setiap pindah mencatat `entered_stage_at`;
  `GET /stages` (+`?all=1` super_admin), `PATCH /stages/[id]` (super_admin;
  tolak nonaktifkan tahap Menang/Kalah atau tahap ber-deal berjalan);
  `GET /lost-reasons`. UI: `src/features/sales-funnel/pipeline/` (kanban
  @hello-pangea/dnd pola HRIS, optimistic update + rollback, badge macet
  per `stuck_threshold_days`, dialog wajib Menang/Kalah), tombol "Konversi
  ke Deal" di tabel Leads, `src/features/sales-funnel/settings/` halaman
  Pengaturan Funnel (guard server-side super_admin di route — role sales
  bisa capai prefix via ROLE_MODULE_PATHS).
  Gate review PASS (0 CRITICAL): HIGH unbounded deals query → LIMIT 500 +
  window closed 90 hari; MEDIUM owner_user_id client-trusted (security +
  code review, juga berlaku di leads Fase A) → `validateAssignableOwner`
  (role sales/super_admin + satu company) DAN role sales hanya boleh
  assign dirinya sendiri, diterapkan di deals & leads POST/PATCH; MEDIUM
  optimistic update tak sinkron closed_at/is_won → patch cache lengkap
  dari cache stages; MEDIUM lead picker tanpa debounce → debounce 300ms;
  + validasi tanggal kalender (tolak 9999-13-40). LOW ditunda: oracle
  403/404 (pola Fase A, keputusan produk), picker lead cap 20 baris.
  Typecheck 0 error baru, build bersih, migrasi + menu/grant terverifikasi
  di DB dev, PM2 restart, smoke test 401 fail-closed OK.
  Belum: E2E kanban role sales (butuh akun uji — human QA). Sisa: Fase C
  (aktivitas + follow-up + pengingat WA), D (360°), E (laporan).
