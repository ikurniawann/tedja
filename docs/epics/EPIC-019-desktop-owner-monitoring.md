# EPIC-019: Desktop Arkiv OS — Pusat Monitoring Owner

status: backlog
environment: dev
retries: 0

## Goal

Mengubah desktop `/arkiv-os` dari launcher cantik berisi angka pajangan menjadi
permukaan monitoring yang benar-benar dipakai owner/level tinggi: sekali buka
langsung terlihat denyut bisnis hari ini (omzet, tim, stok, hal yang menunggu
keputusan), setiap angka bisa diklik menuju modulnya, dan pertanyaan lanjutan
bisa langsung dilempar ke Do.

## Evidence (audit 2026-07-21)

Anchor: `src/components/arkiv/arkiv-os-desktop.tsx` (2.588 baris).

1. **Semua angka monitoring saat ini hardcoded.** `DesktopWidgets` menampilkan
   "System Health 98%" dan "Pending 8 — Approvals & reviews" sebagai string
   literal (baris 813–814). Notification Center berisi array 4 string statis
   (baris 132–137: "5 kandidat baru…", "3 PO perlu approval…"). Toast pembuka
   "3 pending approval notifications" juga literal. **Tidak ada satu pun call
   data dari desktop.** Bagi owner ini lebih buruk dari kosong — angka palsu
   menumbuhkan kebiasaan mengabaikan angka.
2. **Data aslinya sudah tersedia, tinggal disambungkan:**
   - `/api/pos/dashboard/{stats,weekly,funnel,attention,sources}` — penjualan.
   - `/api/hris/nav-badges` — jumlah pending per modul ESS/HR.
   - Logika roster harian (`deriveRosterStatus`, EPIC-007) — hadir/terlambat/belum absen.
   - Query tool Do (EPIC-017 Fase D): `stok_menipis`, `penjualan_periode`,
     `absensi_hari_ini` — sudah teruji dengan data dev.
   - `buildSystemSummary` di route Do — agregat count 8 modul (pola yang benar,
     tetapi terkubur di route asisten).
3. **Desktop dirender juga untuk pengunjung belum login** (ikon punya
   `loginHref`); widget dengan data bisnis wajib digate login + role.
4. **Preferensi user sudah ada fondasinya** — visibilitas widget & posisi ikon
   tersimpan di localStorage; tinggal diperluas.

## Prinsip Desain (kenapa, bukan hanya apa)

- **Glanceable dulu, drill-down kemudian.** Owner butuh ≤5 detik untuk tahu
  "hari ini sehat atau tidak". Detail = klik menuju modul, bukan menumpuk tabel
  di desktop.
- **Setiap angka harus bisa dipertanggungjawabkan.** Angka tanpa tautan ke
  sumbernya akan bernasib sama dengan "98%" — diabaikan. Semua kartu deep-link
  ke halaman modul terkait.
- **Perbandingan, bukan angka telanjang.** "Omzet Rp 3,2 jt" tidak bermakna;
  "Rp 3,2 jt · +18% vs kemarin" bermakna.
- **Satu fetch, bukan delapan.** Desktop memanggil SATU endpoint agregasi;
  fan-out query terjadi paralel di server. Menghindari waterfall, dan
  permukaan auth-nya satu pintu.
- **Data gagal ≠ desktop rusak.** Tiap kartu punya state gagal sendiri;
  kegagalan satu query tidak menjatuhkan yang lain (pola `safeCount` yang
  sudah dipakai Do).

## Rancangan Widget (usulan — menunggu keputusan owner)

| Widget | Isi | Sumber (sudah ada) | Deep link |
|---|---|---|---|
| **Pulsa Bisnis** | Omzet & jumlah pesanan hari ini vs kemarin, rata-rata per pesanan | query `penjualan_periode` + `/api/pos/dashboard/stats` | `/dashboard/pos/reports` |
| **Tim Hari Ini** | Hadir · terlambat · belum absen · cuti (angka roster) | logika daily-roster EPIC-007 | `/dashboard/hris/attendance` |
| **Perlu Keputusan** | Cuti/lembur/pinjaman pending, PO menunggu approval, kandidat baru | nav-badges + count per modul | halaman approval masing-masing |
| **Stok Menipis** | n bahan di bawah minimum + 3 teratas | query `stok_menipis` | `/dashboard/inventory` |
| **Member/CRM** (opsional) | Member baru minggu ini, XP terdistribusi | tabel crm_* | `/dashboard/crm` |

Notification Center memakai data "Perlu Keputusan" yang sama — satu sumber,
dua tampilan; string statis dihapus.

## Scope (bertahap, satu fase = satu PR)

**Fase A — Fondasi data**
- `src/lib/desktop/overview.ts`: kumpulan query murni (reuse query tool Do +
  nav-badges), tiap bagian gagal-aman, teruji unit.
- `GET /api/desktop/overview`: satu endpoint agregasi, gate login + role
  (`super_admin` dulu; daftar role owner menyusul keputusan), cache server
  60 detik supaya refresh murah.

**Fase B — Widget nyata menggantikan yang palsu**
- Ganti `DesktopWidgets` + Notification Center + toast pembuka dengan data
  Fase A; hapus seluruh string hardcoded.
- Skeleton saat memuat, state gagal per kartu, auto-refresh (interval 60–120 dtk,
  berhenti saat tab tidak terlihat).
- Deep link di setiap kartu/baris notifikasi.

**Fase C — Kustomisasi & kenyamanan**
- Pilih widget mana yang tampil + urutannya (perluas mekanisme localStorage
  yang ada), layout responsif utk layar laptop kecil.
- Perbandingan periode di Pulsa Bisnis (hari ini vs kemarin vs minggu lalu).

**Fase D — Jembatan ke Do**
- Tombol "tanya Do" di tiap widget → membuka Do dengan pertanyaan berkonteks
  ("kenapa omzet hari ini turun dibanding kemarin?") — memanfaatkan tool
  calling EPIC-017 yang sudah jalan.

## Non-Goals

- Grafik/chart berat di desktop (dashboard analitik per modul sudah ada; desktop
  cukup angka + arah perubahan).
- Realtime websocket — polling 60–120 detik cukup untuk kebutuhan monitoring owner.
- Multi-tenant/branch scoping baru (mengikuti scoping data yang ada).
- Redesign visual desktop (tema, wallpaper, dock) — sudah bagus, bukan masalahnya.

## Acceptance Criteria

- [ ] Tidak ada lagi angka/notifikasi hardcoded di desktop (grep "98%" dll = 0).
- [ ] Sebelum login: widget data bisnis tidak dirender sama sekali (bukan
      sekadar disembunyikan di klien — endpoint menolak 401).
- [ ] Satu kali buka desktop = satu call `/api/desktop/overview`; respons < 1,5
      dtk pada data dev (cache hangat < 200 ms).
- [ ] Setiap kartu & notifikasi punya deep link yang benar.
- [ ] Kegagalan satu sumber data hanya menandai kartunya, kartu lain tetap terisi.
- [ ] Pulsa Bisnis menampilkan pembanding vs kemarin.
- [ ] Widget bisa disembunyikan/diurutkan dan preferensi bertahan antar sesi.
- [ ] Build hijau, test hijau; unit test menutup query overview & pemilihan role.

## Test Plan

- Unit: tiap query overview (mock db), gate role, agregasi gagal-parsial.
- Manual dev: login super_admin → semua kartu terisi angka yang cocok dengan
  halaman modulnya; logout → widget hilang & endpoint 401; matikan satu tabel
  (simulasi) → hanya kartu itu yang gagal.

## Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Query agregasi membebani DB tiap refresh | Cache server 60 dtk + count ber-LIMIT; refresh berhenti saat tab hidden |
| Angka desktop ≠ angka halaman modul (beda definisi) | Reuse query yang SAMA dengan modul/tool Do, bukan menulis ulang; selisih = bug |
| Desktop publik membocorkan data bisnis | Endpoint 401 tanpa login; komponen widget tidak dirender sebelum auth |
| File desktop 2.588 baris makin bengkak | Widget baru dipecah ke `src/components/arkiv/widgets/` |

## Keputusan yang Dibutuhkan dari Owner

- [ ] Lima widget usulan di atas: mana yang wajib, mana yang dibuang? (CRM opsional)
- [ ] Role selain `super_admin` yang boleh melihat (mis. role `owner` khusus?)
- [ ] Interval refresh: 60 atau 120 detik?

## Done Signal

Semua Acceptance Criteria tercentang + Automation Log terisi + status
`ready-for-qa`.

## Automation Log

- 2026-07-21 — Epic dibuat dari audit desktop: seluruh angka monitoring ternyata
  hardcoded (System Health 98%, Pending 8, 4 notifikasi statis) dan desktop
  tidak memanggil satu pun endpoint data — padahal sumber datanya sudah lengkap
  (pos/dashboard, nav-badges, daily-roster, query tool Do EPIC-017). Rencana:
  satu endpoint agregasi ber-cache → widget nyata ber-deep-link → kustomisasi →
  jembatan ke Do. Menunggu keputusan owner (pilihan widget, role, interval).
  Status → backlog.
