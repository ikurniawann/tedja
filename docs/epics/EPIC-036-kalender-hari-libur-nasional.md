# EPIC-036: Kalender Hari Libur Nasional — Master Libur, Cuti Bersama & Dampaknya ke Cuti/Lembur

status: coding
environment: dev
retries: 0

## Goal

Sistem punya **satu master hari libur** (libur nasional, cuti bersama, dan libur
internal perusahaan) yang dipakai bersama oleh kalender ESS, monitoring absensi,
perhitungan hari cuti, dan perhitungan lembur.

Pemicunya pertanyaan owner: *"kalender ESS bisa ngga auto integrasi dengan public
holiday Indonesia?"* Jawabannya bisa — tapi bukan dengan menempel API pihak ketiga
sebagai sumber kebenaran (lihat **Temuan Sumber Data**).

## Kondisi Sekarang

Tidak ada konsep hari libur nasional sama sekali di kode:

| Tempat | Kondisi |
|---|---|
| [`AttendanceCalendar.tsx:155,172`](../../src/components/hris/AttendanceCalendar.tsx) | "Libur" hanya dari pola shift per-karyawan (`shift_id === null`). Minggu cuma diwarnai merah dari indeks hari (`isSunday`, baris 169) — bukan dari data |
| [`daily-roster.ts:19-29`](../../src/lib/hris/daily-roster.ts) | Status hanya `hadir · cuti · libur · alpha`. Tidak ada `libur_nasional` |
| [`leaves/route.ts:247-260`](../../src/app/api/hris/leaves/route.ts) | `calculateBusinessDays()` **hanya** mengecualikan Sabtu–Minggu |
| [`calculator.ts:276`](../../src/lib/payroll/calculator.ts) | Lembur memakai satu `overtimeMultiplier` flat, tidak membedakan hari kerja vs hari libur resmi |
| `database/migrations` | Tidak ada tabel libur (`grep holiday` → nihil) |

**Konsekuensi nyata, bukan kosmetik:** cuti yang melewati tanggal merah **tetap
memotong jatah cuti tahunan karyawan**. Cuti 3 hari yang di dalamnya ada 17 Agustus
tetap dihitung 3 hari. Ini bug saldo cuti yang sudah berjalan, dan epic ini yang
memperbaikinya.

## Temuan Sumber Data (probe 2026-07-29)

Empat kandidat sumber "public holiday Indonesia" diuji langsung:

| Sumber | Status | Layak? |
|---|---|---|
| `dayoffapi.vercel.app` | **Mati** — HTTP 402 `DEPLOYMENT_DISABLED` | ❌ |
| `api-harilibur.vercel.app` | **Mati** — HTTP 402 `DEPLOYMENT_DISABLED` | ❌ |
| `date.nager.at/api/v3/PublicHolidays/2026/ID` | Hidup, tapi **hanya 8 tanggal** untuk 2026 — tanpa Imlek, Nyepi, Idul Fitri, Idul Adha, Waisak, Maulid, dan tanpa cuti bersama sama sekali | ❌ materially incomplete |
| Google Calendar ICS `id.indonesian#holiday@group.v.calendar.google.com` | Hidup, **28 entri untuk 2026**, sudah melabeli `Cuti Bersama …` dan menandai `(belum pasti)` untuk Waisak & Maulid | ⚠ kandidat impor, **bukan** sumber kebenaran |

Dua API komunitas yang paling umum dipakai sudah tumbang — bukti langsung kenapa
API pihak ketiga tidak boleh jadi dependency runtime untuk angka yang menyentuh
saldo cuti dan gaji.

Google ICS pun perlu kurasi: keluarannya memuat tanggal yang **bukan** libur resmi —
`1 Ramadan` (19 Feb), `Hari Paskah` (5 Apr, jatuh Minggu), `Hari Kedua Muharram`,
`Malam Tahun Baru` (31 Des).

Alasan yang lebih fundamental: daftar resmi terbit lewat **SKB 3 Menteri** (biasanya
~September untuk tahun berikutnya), dan tanggal hijriah bisa digeser pemerintah
H-beberapa hari. Sumber apa pun yang berubah diam-diam tidak boleh menyetir payroll.

## Keputusan Desain

1. **Tabel sebagai sumber kebenaran.** Data hidup di database, di-CRUD HRD.
2. **Impor = alat bantu, bukan sinkronisasi otomatis.** Tombol "Impor kalender
   `<tahun>`" menarik ICS → menampilkan preview bercentang → HRD memilih mana yang
   benar tanggal merah → baru masuk sebagai `aktif`. **Tidak ada cron yang menulis
   diam-diam.** Sekali setahun, ~10 menit.
3. **Tanpa `company_id`.** Tabel HRIS di repo ini tidak punya kolom tenant
   (dikonfirmasi: `grep company_id database/migrations/schemas/hris/*.sql` → nihil);
   isolasi antar-klien dilakukan per-database (lihat [EPIC-035](./EPIC-035-habitat-instance-kedua.md)).
   Libur internal perusahaan cukup dibedakan lewat kolom `type`.
4. **Cuti bersama ≠ libur nasional.** Menurut SKB, cuti bersama **memotong** jatah
   cuti tahunan, sedangkan libur nasional tidak. Perbedaan ini di-encode di data
   (`type` + `deducts_leave`), bukan di-hardcode di logika.

## Skema (rancangan)

```sql
CREATE TABLE hris.public_holidays (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  holiday_date   date NOT NULL,
  name           text NOT NULL,
  type           text NOT NULL CHECK (type IN ('nasional','cuti_bersama','perusahaan')),
  -- true = hari ini tetap memotong jatah cuti tahunan (default untuk cuti bersama)
  deducts_leave  boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'aktif' CHECK (status IN ('draft','aktif')),
  source         text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','impor')),
  source_ref     text,          -- UID event ICS → impor ulang idempoten
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE UNIQUE INDEX uq_public_holidays_date_name
  ON hris.public_holidays (holiday_date, name) WHERE deleted_at IS NULL;
CREATE INDEX ix_public_holidays_date
  ON hris.public_holidays (holiday_date) WHERE deleted_at IS NULL AND status = 'aktif';
```

Satu tanggal boleh punya lebih dari satu baris (mis. Idul Fitri hari ke-1 dan ke-2
yang berdempetan dengan cuti bersama), jadi unique-nya `(tanggal, nama)` — bukan
tanggal saja.

Logika murni ditaruh di `src/lib/hris/holidays.ts` (`isHoliday`, `countWorkingDays`,
`resolveDayType`) supaya bisa diuji tanpa database dan dipakai ulang oleh kalender,
roster, cuti, dan lembur — pola yang sama dengan `shifts.ts` dan `daily-roster.ts`.

## Fase

| Fase | Scope (PR-sized) | Status |
|---|---|---|
| **A** | Delta skema `hris.public_holidays` + seed libur nasional & cuti bersama 2026 (dikurasi manual) + modul murni `src/lib/hris/holidays.ts` beserta unit test | ✅ selesai |
| **B** | Halaman admin `/dashboard/hris/holidays` (sibling `/dashboard/hris/shifts`) + API CRUD + delta menu `hris.holidays` (grant `super_admin`, `hrd`) | ✅ selesai |
| **C** | Kalender ESS & monitoring: `AttendanceCalendar` menampilkan tanggal merah + nama libur; `daily-roster` menambah status `libur_nasional` | ✅ selesai |
| **D** | Cuti: `calculateBusinessDays` mengecualikan libur aktif yang `deducts_leave = false`; berlaku untuk pengajuan baru saja | belum |
| **E** | Importer ICS: tarik → preview bercentang → simpan sebagai `aktif`. Idempoten via `source_ref` | belum |
| **F** (opsional) | Lembur hari libur resmi: multiplier terpisah di `calculator.ts` mengikuti Kepmenaker. **Menyentuh payroll — perlu keputusan owner sendiri** | belum |

Fase A–C sudah menjawab pertanyaan awal ("kalender ESS tahu tanggal merah").
Fase D yang memperbaiki bug saldo cuti. E mempercepat pengisian tahunan. F terpisah
karena menyentuh angka gaji.

## ⚠ Risiko

1. **Retroaktif ke cuti lama.** Mengubah `calculateBusinessDays` tanpa batas akan
   membuat `total_days` cuti historis tidak lagi cocok dengan saldo yang sudah
   terpotong. **Rekomendasi: tidak ada backfill** — aturan baru hanya berlaku untuk
   pengajuan sejak fase D rilis. Perlu konfirmasi owner.
2. **Cuti bersama memotong jatah cuti.** Kalau semua baris diperlakukan sama seperti
   libur nasional, karyawan mendapat tambahan hari cuti gratis yang tidak seharusnya.
   Karena itu `deducts_leave` ada di data sejak fase A, bukan ditambahkan belakangan.
3. **Tanggal "belum pasti".** Waisak & Maulid 2026 ditandai tentatif oleh sumbernya
   sendiri, dan Idul Fitri/Adha bisa digeser pemerintah. Jangan hardcode di kode —
   HRD harus bisa mengubahnya tanpa deploy.
4. **Timezone kolom `date`.** Kolom `date` Postgres diserialisasi server (TZ WIB)
   menjadi ISO UTC bergeser 17:00 hari sebelumnya. Wajib memakai pola `wibDateKey`
   yang sudah ada di [`AttendanceCalendar.tsx:49`](../../src/components/hris/AttendanceCalendar.tsx)
   dan `dateColToIso` di payroll — jebakan yang sudah pernah menggigit di EPIC-008.
5. **Instance kedua.** Habitat punya database sendiri; seed libur harus dijalankan
   di kedua instance, bukan sekali di Sulu saja.
6. **Outbound network saat impor.** Fase E menambah dependency jaringan keluar dari
   container. Harus gagal dengan pesan jelas dan tidak memblokir halaman admin
   kalau ICS tak terjangkau.

## Non-Goals

- Tidak ada cron/auto-sync yang menulis ke tabel tanpa persetujuan HRD.
- Tidak menyentuh harga tiket / POS hari libur — ticketing sudah punya harga musiman
  sendiri ([EPIC-023](./EPIC-023-ticketing-theme-park.md)).
- Tidak membuat kalender cuti bersama per-daerah (mis. libur pilkada lokal) di v1 —
  bisa dimasukkan manual bertipe `perusahaan`.
- Tidak mengubah pola shift/roster; libur nasional adalah lapisan di atasnya.

## Acceptance Criteria

- [ ] Tabel `hris.public_holidays` ada, terisi libur nasional + cuti bersama 2026
- [ ] HRD bisa menambah/ubah/hapus libur dari `/dashboard/hris/holidays` tanpa deploy
- [ ] Menu `hris.holidays` tampil untuk `super_admin` + `hrd`, tidak untuk role lain
- [ ] Kalender ESS menampilkan tanggal merah beserta nama liburnya, di bulan mana pun
- [ ] Monitoring absensi tidak lagi menandai karyawan `alpha` pada hari libur nasional
- [ ] Pengajuan cuti yang melewati libur nasional **tidak** memotong hari libur itu
- [ ] Pengajuan cuti yang melewati cuti bersama **tetap** memotong (sesuai SKB)
- [ ] Cuti yang sudah approved sebelum rilis tidak berubah `total_days`-nya
- [ ] Impor ICS menampilkan preview dan tidak menyimpan apa pun sebelum dicentang
- [ ] Impor ulang tahun yang sama tidak menghasilkan duplikat

## Test Plan

| Lapisan | Cakupan |
|---|---|
| Unit (`holidays.test.ts`) | `isHoliday` happy/edge (batas awal-akhir rentang, libur di Sabtu/Minggu, baris `draft` diabaikan); `countWorkingDays` untuk rentang 1 hari, rentang penuh libur, rentang bercampur cuti bersama |
| Unit (roster) | `deriveRosterStatus` — prioritas `hadir` > `cuti` > `libur_nasional` > `libur` > `alpha` |
| Integrasi | `POST /api/hris/leaves` melewati 17 Agustus → `total_days` berkurang 1; melewati cuti bersama → tidak berkurang |
| Integrasi | CRUD `/api/hris/holidays` menolak role non-HRD (403) |
| Manual | Kalender ESS bulan Maret 2026 (klaster Nyepi + Idul Fitri) tampil benar di mobile & desktop |
| Parser ICS | Fixture ICS 2026 → 28 event terbaca, `Cuti Bersama` terdeteksi, `1 Ramadan`/`Hari Paskah` tidak otomatis tercentang |

## Agent Routing

| Fase | Agent |
|---|---|
| A | `database-reviewer` (skema + index parsial), `tdd-guide` (modul murni) |
| B | `typescript-reviewer`, `security-reviewer` (endpoint tulis + grant menu) |
| C | `react-reviewer` |
| D | `tdd-guide` + `code-reviewer` (menyentuh saldo cuti) |
| E–F | `security-reviewer` (outbound fetch), `database-reviewer` (payroll) |

## Done Signal

Fase A–D lolos gate review/security/test, ter-deploy di DEV, dan HRD bisa
memverifikasi: buka kalender ESS bulan Maret 2026 → klaster Nyepi/Idul Fitri tampil
sebagai tanggal merah bernama; ajukan cuti yang melewatinya → potongan jatah sesuai
aturan. Status naik ke `ready-for-qa`.

## Automation Log

- 2026-07-29 — Epic dibuat dari pertanyaan owner soal integrasi public holiday di
  kalender ESS. Audit kode: tidak ada tabel/logika libur sama sekali; "Libur" di
  kalender murni berasal dari `shift_id IS NULL`. Ditemukan bug turunan —
  `calculateBusinessDays` (`leaves/route.ts:247`) hanya mengecualikan akhir pekan,
  sehingga cuti yang melewati tanggal merah memotong jatah cuti karyawan.
  Empat sumber data diprobe langsung: dua API komunitas Indonesia
  (`dayoffapi`, `api-harilibur`) **mati** dengan HTTP 402 `DEPLOYMENT_DISABLED`,
  `date.nager.at` hidup tapi hanya memuat 8 dari ~28 tanggal 2026, Google Calendar
  ICS lengkap (28 entri, melabeli cuti bersama) tapi memuat non-libur seperti
  `1 Ramadan` dan `Hari Paskah`. Keputusan: **tabel sebagai sumber kebenaran,
  impor ICS sebagai alat bantu dengan persetujuan HRD** — tidak ada auto-sync.
- 2026-07-29 — **Fase A TUNTAS.** Delta
  `20260729100000_hris_public_holidays.sql` + modul murni
  `src/lib/hris/holidays.ts` + 18 unit test (TDD: RED → GREEN). Diterapkan ke
  `arkiv_local`, 24 baris seed 2026 terverifikasi.
  Keputusan yang diambil saat implementasi:
  1. **Libur nasional menang atas cuti bersama** bila keduanya jatuh di tanggal
     yang sama — hari itu memang libur resmi, dan tafsir yang menguntungkan
     karyawan yang benar secara aturan.
  2. **`countLeaveDays` boleh mengembalikan 0** (rentang yang seluruhnya libur).
     Pemanggil yang memutuskan artinya — perilaku lama `Math.max(1, days)`
     sengaja tidak dibawa ke modul murni supaya Fase D bisa menolak pengajuan
     cuti di hari libur, bukan diam-diam menghitungnya 1 hari.
  3. **Akhir pekan tetap Sabtu+Minggu**, menyamai perilaku lama. Kalau operasional
     sebenarnya 6 hari kerja, itu keputusan kebijakan tersendiri — jangan
     diselundupkan lewat epic ini.
  4. Tiga tanggal diberi catatan verifikasi SKB; `2026-05-28` (Idul Adha hari
     kedua) masuk sebagai **`draft`** sehingga belum mempengaruhi perhitungan
     apa pun sampai HRD menyetujui. Empat entri kalender yang bukan tanggal merah
     (`1 Ramadan`, `Hari Paskah`, `Hari Kedua Muharram`, `Malam Tahun Baru`)
     ditinggalkan sebagai komentar di delta beserta alasannya.
  Dua temuan lingkungan saat menerapkan migrasi, bukan bagian epic ini:
  (a) database `arkiv_local` tertinggal 5 delta dari branch `development` —
  ikut diterapkan sekalian; (b) delta
  `20260727151000_products_cogs_respect_bom_unit.sql` gagal dengan
  `permission denied for schema public` karena role `arkiv_local` tidak punya
  hak `CREATE` di schema `public` (gejala yang sama pernah muncul di EPIC-034).
  Diperbaiki dengan `GRANT CREATE, USAGE ON SCHEMA public TO arkiv_local` di
  database lokal. **Server DEV/produksi kemungkinan punya masalah yang sama** —
  perlu dicek terpisah sebelum delta itu di-deploy.
- 2026-07-29 — **Fase B TUNTAS.** API CRUD `/api/hris/holidays` (+ `[id]`),
  halaman `/dashboard/hris/holidays`, delta menu
  `20260729110000_hris_holidays_menu.sql` (`hris.kepegawaian.holidays`, order 35,
  tepat di bawah "Shift Kerja").
  Keputusan yang diambil saat implementasi:
  1. **Baca terbuka, tulis dipersempit.** `GET` cukup `requireApiUser` — kalender
     ESS setiap karyawan butuh tanggal merah, dan isinya kalender publik, bukan
     data pribadi. `POST/PATCH/DELETE` dibatasi `super_admin` + `hrd` saja
     (bukan pola `super_admin`+`admin` seperti menu kepegawaian lain) karena isi
     tabel ini menyetir potongan jatah cuti.
  2. **Baris `draft` disembunyikan dari karyawan.** Hanya keluar lewat
     `include_draft=1` untuk role HR, supaya tanggal yang belum pasti tidak
     tampil sebagai tanggal merah di kalender ESS.
  3. **Hapus = soft delete.** Baris dirujuk perhitungan cuti historis, dan index
     unique-nya parsial (`WHERE deleted_at IS NULL`) sehingga tanggal+nama yang
     sama tetap bisa ditambahkan lagi setelahnya.
  4. `deducts_leave` ikut default tipenya baik di form maupun di `PATCH` — ubah
     tipe ke `cuti_bersama` tanpa menyebut `deducts_leave` tidak akan
     meninggalkan baris yang bertentangan dengan SKB.
  5. Kolom `note` sengaja tidak memakai `COALESCE` seperti kolom lain: itu
     membuat catatan mustahil dikosongkan. Dipisah lewat flag "dikirim atau
     tidak".
- 2026-07-29 — **Fase C TUNTAS.** `AttendanceCalendar` menarik libur per bulan
  tampak dan menampilkan tanggal merah **beserta namanya** (sel + popup detail +
  legenda); `deriveRosterStatus` menambah status `libur_nasional`; endpoint
  `daily-roster` ikut mengembalikan `holidays`; tab monitoring menampilkan
  banner nama libur. 7 unit test baru (total 122 lolos).
  Keputusan yang diambil saat implementasi:
  1. **Prioritas status:** `hadir` > `cuti` > `libur_nasional` > `libur` >
     `absen`. Absensi menang karena karyawan yang tetap masuk di hari libur
     memang hadir; `libur_nasional` menang atas jadwal shift sehingga karyawan
     terjadwal **tidak lagi dihitung mangkir** saat kantor tutup — inilah yang
     memperbaiki keluhan monitoring.
  2. **Ketiga tipe libur sama-sama berarti kantor tutup** untuk kehadiran.
     `deducts_leave` murni urusan potongan jatah cuti (Fase D), bukan absensi.
  3. **Gagal memuat libur tidak memblokir kalender** — tanggal merah hilang,
     jadwal & absensi tetap tampil. Kalender ESS tidak boleh mati karena satu
     endpoint tambahan.
  4. Tanggal dibawa sebagai teks `YYYY-MM-DD` dari SQL (`holiday_date::text`)
     sehingga cocok langsung dengan kunci sel kalender — menghindari jebakan
     geser timezone kolom `date` (risiko #4).
  Gate: `vitest` 122/122 lolos, `eslint` bersih untuk seluruh berkas epic,
  `tsc --noEmit` tidak menghasilkan error baru di berkas epic (601 error
  pre-existing repo tidak tersentuh), `next build` EXIT=0 dengan ketiga route
  baru terdaftar.
