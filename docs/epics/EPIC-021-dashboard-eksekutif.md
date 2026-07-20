# EPIC-021: /dashboard — Ringkasan Eksekutif Lintas Modul

status: coding
environment: dev
retries: 0

## Goal

Halaman `/dashboard` menjadi ringkasan high-level + taktis lintas modul untuk
super_admin dan owner (direksi): sekali buka terlihat kondisi bisnis, insight
yang bisa ditindaklanjuti, dan antrean keputusan — semua angka berpembanding
dan ber-deep-link. Analisis dalam tetap di dashboard modul masing-masing.

## Evidence (audit 2026-07-21)

1. **`/dashboard` sebelumnya bukan dashboard global — ia dashboard rekrutmen.**
   Landing merender `RecruitmentDashboardPage` (kandidat bulan ini, kandidat
   butuh perhatian, ekspor CSV) untuk SEMUA role non-employee. Jejak sejarah
   aplikasi yang tumbuh dari produk talentpool.
2. Bahan sudah tersedia dari EPIC-019: `buildDesktopOverview` (denyut hari ini),
   nav-badges, query tool Do — tinggal ditumpangi lapisan insight.

## Keputusan Owner (2026-07-21)

- Dashboard rekrutmen pindah ke **`/dashboard/rekrutmen`** (konten tidak diubah).
- **`/dashboard` khusus super_admin + owner** (dipetakan ke `direksi`), berisi
  informasi high-level & taktis lintas modul untuk pengambilan keputusan.

## Scope

**Fase A — pemindahan + eksekutif v1 (selesai)**
- Routing: super_admin/direksi → Ringkasan Eksekutif; employee → `/dashboard/me`
  (aturan lama); role lain → redirect `/dashboard/rekrutmen` (konten yang sama
  dengan yang mereka lihat sebelum halaman berganti isi — least surprise).
- Menu `hris.recruitment.dashboard` (→ /dashboard/rekrutmen) di atas grup
  Rekrutmen, izin disalin dari Pipeline. Migrasi `20260721030000`, applied.
- `src/lib/dashboard/executive.ts`: menumpang `buildDesktopOverview` + insight
  baru — tren 14 hari, top 5 produk 7 hari, nilai persediaan
  (qty × unit_cost), purchasing bulan berjalan per status, payroll run terakhir,
  kontrak `active` berakhir ≤30 hari. Gagal-aman per seksi; 4 unit test.
- `GET /api/dashboard/executive`: gate super_admin+direksi, cache 60 dtk,
  hasil ber-seksi-gagal tidak di-cache (pola /api/desktop/overview).
- Halaman: KPI berpembanding ganda (vs kemarin DAN vs hari sama minggu lalu),
  tren 14 hari dengan pembanding minggu berjalan vs minggu sebelumnya,
  Perlu Keputusan, produk terlaris, inventori (nilai + menipis), purchasing,
  payroll & kontrak, CRM 7 hari. Auto-refresh 60 dtk saat tab terlihat.

**Fase B — kandidat lanjutan (belum, butuh keputusan owner)**
- Breakdown per brand/outlet (company_id/branch_id sudah ada di pos_orders).
- Target omzet harian/bulanan → % pencapaian.
- Dashboard role-aware untuk role lain (purchasing, finance, pos_supervisor) —
  usulan pemetaan sudah dibahas, belum diputuskan.

## Non-Goals

- Grafik analitik berat / library chart — bar CSS cukup untuk tren ringkas.
- Mengubah isi dashboard rekrutmen.
- Realtime — polling 60 dtk cukup.

## Acceptance Criteria

- [x] super_admin & direksi melihat Ringkasan Eksekutif di `/dashboard`.
- [x] Role lain mendarat di konten yang sama seperti sebelumnya (rekrutmen),
      kini di `/dashboard/rekrutmen`; employee tetap ke `/dashboard/me`.
- [x] Endpoint eksekutif menolak 401 tanpa login; role di luar daftar ditolak.
- [x] Setiap kartu ber-deep-link; KPI omzet berpembanding ganda.
- [x] Seksi gagal hanya menandai kartunya (diverifikasi: kolom `total_amount`
      yang keliru di purchasing membuat SATU kartu gagal, sisanya tetap hidup —
      lalu diperbaiki ke kolom `total`).
- [x] Build hijau; 704 test hijau (4 baru).
- [ ] QA manual: login direksi sungguhan (bukan hanya super_admin).

## Test Plan

- Unit: tren selalu 14 titik urut, gagal parsial, payroll null saat belum ada
  run, prefix `overview:` untuk kegagalan bawaan.
- Smoke data dev: seluruh seksi terisi (top produk: Nasi Goreng Spesial 5×;
  persediaan Rp 115 rb; PO bulan ini 1/Rp 127.650; payroll Agu 2026 paid;
  kontrak ≤30 hari: 1).
- Manual: login super_admin → /dashboard; login hrd → terlempar ke
  /dashboard/rekrutmen dengan konten lama.

## Automation Log

- 2026-07-21 — Fase A selesai satu sesi. Insiden kecil selama smoke: seksi
  purchasing gagal karena mengasumsikan kolom `total_amount` (nama di
  pos_orders) padahal purchase_orders memakai `total` — persis jenis bug yang
  ditangkap pola gagal-aman + smoke data sungguhan sebelum sampai ke user.
  Status → coding (sisa QA login direksi).
