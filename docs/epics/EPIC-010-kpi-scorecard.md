# EPIC-010: KPI Scorecard — Penilaian Kinerja Otomatis dari Data Operasional

status: coding
environment: dev
retries: 0

## Goal

Membangun sistem KPI scorecard 3 lapis (perusahaan/outlet → department → individu)
yang **terisi otomatis dari data transaksi** modul yang sudah ada (POS, absensi
v2, payroll, purchasing, inventory, recruitment, logbook), dengan engine
attainment generik + katalog indikator spesifik per role. Skor bermuara ke modul
Performance Review, tampil di ESS, dan bisa dipakai untuk bonus payroll serta
rekomendasi perpanjangan kontrak PKWT.

## Latar & Posisi Modul Lama

- "KPI" logbook saat ini = kepatuhan checklist (leading indicator) → turun
  pangkat jadi SATU indikator dalam scorecard, bukan KPI utama.
- `hris.kpi_templates` + employee-KPI progress yang ada = wadah komponen
  kualitatif (penilaian atasan) + muara scorecard.
- Keunggulan Arkiv vs HRIS standalone: ±80% indikator terisi mesin dari data
  yang SUDAH ada — bukan input manual yang bisa dikarang.

## Keputusan Owner (2026-07-19)

1. **Katalog indikator & bobot default per role: DISETUJUI** (tabel di bawah).
2. **Skor 0–100 tanpa grade banding** (tidak ada A/B/C/D).
3. **Cadence bulanan untuk SEMUA role** (indikator sampel kecil ditangani
   aturan minimum data, bukan dengan mengubah cadence).

## Aturan Umum Engine

| Aturan | Isi |
|---|---|
| Attainment | higher-better: `min(120%, actual/target)` · lower-better: `min(120%, target/actual)` · boolean: 100%/0% |
| Skor komposit | `Σ (bobot_i × attainment_i)`, Σ bobot = 100 per role |
| Pengecualian adil | Cuti approved & libur terjadwal tidak menghukum kehadiran (pakai lib `daily-roster`) |
| Prorata | Masuk/keluar tengah periode → pakai `periodCoverage` dari lib payroll (konsisten slip gaji) |
| Minimum data | Sampel < ambang (mis. < 5 shift/bulan) → indikator dikeluarkan, bobot didistribusi ulang proporsional |
| Counter-metric | Indikator volume/kecepatan selalu dipasangkan lawan akurasinya |
| Snapshot | Angka aktual dibekukan per periode (pola snapshot payroll) — skor tidak berubah walau data mentah berubah |

## Katalog Indikator per Role (DISETUJUI)

### pos (POS Cashier)
| Indikator | Formula | Sumber | Arah | Bobot |
|---|---|---|---|---|
| Ketepatan hadir | shift on-time / terjadwal | absensi v2 `is_late` | ↑ | 20 |
| Selisih kas closing | Σ\|selisih\| / Σ setoran seharusnya | POS closing report | ↓ | 25 |
| Sales per shift dijaga | actual / target shift | POS orders × shift | ↑ | 20 |
| Void/refund rate | nilai void / total sales | POS orders | ↓ | 10 |
| Kepatuhan checklist | % logbook selesai | logbook | ↑ | 10 |
| Penilaian supervisor | rubrik 1–5 | KPI review (manual) | ↑ | 15 |

### pos_supervisor
| Indikator | Formula | Sumber | Arah | Bobot |
|---|---|---|---|---|
| Omzet outlet vs target | actual / target bulanan | POS dashboard | ↑ | 25 |
| Profit margin outlet | actual margin / target | POS profit report | ↑ | 15 |
| Disiplin tim | % on-time kasir binaan | rekap absensi | ↑ | 15 |
| Total selisih kas outlet | Σ\|selisih\| semua shift | closing report | ↓ | 10 |
| Kepatuhan logbook harian | % hari kerja submitted | logbook | ↑ | 10 |
| Selisih opname area POS | \|variance\| / nilai stok | inventory opname | ↓ | 10 |
| Penilaian atasan | rubrik | manual | ↑ | 15 |

### warehouse_staff / warehouse_admin
| Indikator | Formula | Sumber | Arah | Bobot |
|---|---|---|---|---|
| Ketepatan hadir | on-time / terjadwal | absensi | ↑ | 20 |
| Akurasi stock opname | 1 − (\|variance\| / nilai dihitung) | inventory opname | ↑ | 30 |
| Kecepatan GRN | rata-rata hari PO tiba → GRN | purchasing/GRN | ↓ | 15 |
| Adjustment tak terjelaskan | nilai adjustment non-opname / nilai stok | inventory adjustment | ↓ | 10 |
| Kepatuhan checklist gudang | % logbook | logbook | ↑ | 10 |
| Penilaian atasan | rubrik | manual | ↑ | 15 |

### purchasing_staff / purchasing_admin (S/A) · purchasing_manager (Mgr)
| Indikator | Formula | Sumber | Arah | S/A | Mgr |
|---|---|---|---|---|---|
| PO fulfillment rate | qty diterima / dipesan | lib `po-fulfillment-progress` | ↑ | 30 | 20 |
| Lead time PO → lengkap | rata-rata hari | PO + GRN timestamps | ↓ | 20 | 15 |
| Ketepatan bayar vendor | dibayar ≤ jatuh tempo / total | vendor-payments | ↑ | 10 | 15 |
| Ketepatan hadir | on-time / terjadwal | absensi | ↑ | 15 | 10 |
| Efisiensi harga (fase lanjut) | Δ harga vs baseline item | PO history | ↓ | — | 15 |
| Kepatuhan checklist | % logbook | logbook | ↑ | 10 | 10 |
| Penilaian atasan | rubrik | manual | ↑ | 15 | 15 |

Catatan Mgr tanpa efisiensi harga (belum ada baseline): bobotnya dialihkan
sementara ke fulfillment (20→30) + lead time (15→20) sampai fase lanjut aktif.

> ⚠️ **TODO WAJIB (keputusan owner 2026-07-19):** indikator **efisiensi harga
> purchasing_manager HARUS di-update** saat baseline harga per item tersedia —
> aktifkan indikatornya, kembalikan bobot ke 20/15/15. Jangan biarkan
> pengalihan sementara ini jadi permanen.

### finance_staff
| Indikator | Formula | Sumber | Arah | Bobot |
|---|---|---|---|---|
| Payroll run tepat jadwal | paid_at ≤ tgl gajian / total run | payroll `paid_at` | ↑ | 25 |
| SLA vendor payment | rata-rata hari invoice → dibayar | vendor-payments | ↓ | 20 |
| Closing tervalidasi ≤ H+1 | tepat waktu / total | POS closing | ↑ | 20 |
| Ketepatan hadir | on-time / terjadwal | absensi | ↑ | 15 |
| Penilaian atasan | rubrik | manual | ↑ | 20 |

### hrd (HRD) · hiring_manager (HM)
| Indikator | Formula | Sumber | Arah | HRD | HM |
|---|---|---|---|---|---|
| SLA approval cuti | rata-rata hari pengajuan → keputusan | leaves timestamps | ↓ | 20 | — |
| Payroll siap ≤ H-2 | run approved sebelum deadline | payroll | ↑ | 15 | — |
| Kontrak tak kedaluwarsa diam-diam | diputuskan ≤ H-14 sebelum habis / total | contracts `end_date` | ↑ | 15 | — |
| Time-to-hire | rata-rata hari vacancy → offer accepted | recruitment pipeline | ↓ | 10 | 40 |
| Pipeline hygiene | % kandidat tanpa status basi > 7 hari | pipeline | ↑ | 5 | 20 |
| Review KPI tim tepat waktu | % scorecard direview ≤ tgl 5 | modul KPI ini | ↑ | 10 | 15 |
| Ketepatan hadir | on-time / terjadwal | absensi | ↑ | 10 | 10 |
| Penilaian atasan | rubrik | manual | ↑ | 15 | 15 |

### qc_staff
| Indikator | Formula | Sumber | Arah | Bobot |
|---|---|---|---|---|
| Ketepatan hadir | on-time / terjadwal | absensi | ↑ | 25 |
| Kepatuhan checklist QC | % logbook template QC | logbook | ↑ | 35 |
| Temuan ditindaklanjuti | closed / total (notes logbook dulu; tabel sendiri fase lanjut) | logbook | ↑ | 15 |
| Penilaian atasan | rubrik | manual | ↑ | 25 |

### employee (umum, scorecard minimum)
Kehadiran 30 · Telat 15 (↓, menit telat/menit kerja) · Kepatuhan pengajuan
(cuti/lembur diajukan sebelum H) 15 · Logbook (bila dept memakai) 10 ·
Penilaian atasan 30.

### direksi — TIDAK di-scorecard
Konsumen dashboard lapis-1. Penilaian level ini kandidat layer OKR kuartalan
(epic terpisah, non-goal di sini).

## Target — siapa yang set

- Omzet & profit per outlet: super_admin/direksi.
- Disiplin & SLA: HRD.
- Rasio akurasi: default sistem (mis. selisih kas ≤0,5%), bisa dioverride.

## Scope per Fase

- **Fase A — Skema + engine murni**: tabel `kpi_indicators` (katalog: code,
  nama, satuan, arah, sumber auto/manual, agregasi), `kpi_targets` (periode ×
  scope outlet/dept/role/employee), `kpi_snapshots` (aktual beku per periode),
  `kpi_scorecards` (skor komposit per karyawan-periode). Lib murni
  `src/lib/kpi/` (attainment, redistribusi bobot minimum-data, prorata) —
  unit-tested penuh, pola `lib/payroll`.
- **Fase B — Kolektor auto gelombang 1** (paling murah, data sudah ada):
  on-time % (absensi), selisih closing (POS), logbook compliance, PO
  fulfillment. Job snapshot bulanan idempoten (re-run aman).
- **Fase C — UI scorecard**: halaman HRD (semua karyawan, filter dept/periode),
  kepala dept (timnya), integrasi Performance Review (komponen kualitatif =
  rubrik atasan), tampilan skor di ESS beranda + halaman riwayat pribadi.
- **Fase D — Target setting UI + kolektor gelombang 2** (sales/shift, opname
  variance, lead time GRN, SLA cuti, payroll on-time, kontrak, time-to-hire)
  + hook bonus payroll & rekomendasi perpanjangan PKWT (decision support,
  bukan otomatis memutus).

## Non-Goals

- Layer OKR kuartalan (epic terpisah bila dibutuhkan).
- Efisiensi harga purchasing & tabel temuan QC (fase lanjut, ditandai di atas).
- Pemutusan kontrak/bonus OTOMATIS dari skor — sistem hanya menyajikan
  rekomendasi; keputusan tetap manusia.
- Multi-tenant scoping tabel KPI (selaras penundaan epic multi-tenant payroll).

## Acceptance Criteria (ringkas per fase)

- [ ] A: engine attainment lulus unit test (higher/lower/boolean, cap 120%,
      redistribusi bobot, prorata); skema termigrasi + tercatat tracker.
- [ ] B: snapshot bulanan menghasilkan angka yang bisa diaudit balik ke data
      sumber; re-run periode sama idempoten.
- [ ] C: HRD melihat scorecard semua karyawan; karyawan melihat skornya di ESS;
      komponen manual mengalir dari Performance Review.
- [ ] D: target bisa di-set per outlet/dept/role; skor muncul sebagai
      rekomendasi di halaman kontrak (PKWT jatuh tempo) dan bisa diisi ke
      kolom bonus payroll secara manual-assisted.

## Test Plan

Unit (lib kpi penuh) · integrasi kolektor vs data seed · E2E alur HRD set
target → snapshot → skor → review → tampil ESS.

## Agent Routing

Desain selesai (sesi brainstorming 2026-07-19). Implementasi: /task-work per
fase → review + security gate → build → deploy dev.

## Done Signal

Semua AC tercentang + Automation Log terisi + ready-for-qa.

## Automation Log

- 2026-07-19 — Epic dibuat dari brainstorming owner: KPI scorecard dipilih
  (bukan OKR) utk operasional; katalog indikator per role + bobot DISETUJUI;
  skor 0–100 tanpa grade; cadence bulanan semua role; direksi tidak
  di-scorecard (kandidat OKR terpisah). Status: backlog (menunggu go
  implementasi Fase A).
- 2026-07-19 — **Fase A SELESAI.** (1) Lib murni `src/lib/kpi/` — attainment
  (higher/lower/boolean, cap 120%, target-0 lower-better = tepat 0→1.0,
  data absen→null) + composeScore (redistribusi bobot proporsional, skor
  final cap 100 dgn rawScore utk audit) — 22 unit test hijau, TDD. (2) Migrasi
  `20260719090000_kpi_scorecard_fase_a.sql` (applied+tracked): 5 tabel di
  schema `performance` (kpi_indicators, kpi_role_indicators, kpi_targets
  dgn scope employee>dept>role>default, kpi_snapshots beku+source_detail
  audit, kpi_scorecards draft/final) + seed 32 indikator & 70 bobot role —
  diverifikasi Σ bobot = 100.00 utk 12 role. `price_efficiency` di-seed
  is_active=false dgn TODO owner di kolom notes (aktifkan saat baseline
  harga ada; kembalikan bobot purchasing_manager 20/15/15) — juga ditandai
  ⚠ di bagian katalog epic ini. Berikutnya: Fase B kolektor gelombang 1
  (att_ontime, pos_cash_variance, logbook_compliance, po_fulfillment).
- 2026-07-19 — **Fase B SELESAI.** Kolektor gelombang 1 di `src/lib/kpi/`:
  `attendance-ontime.ts` (murni, reuse resolver `lib/hris/shifts` ISO dow 1-7;
  basis hari terjadwal − cuti approved; fallback basis hadir; 6 test),
  `collectors.ts` (4 kolektor SQL parameterized: att_ontime,
  pos_cash_variance via pos_shifts.variance/expected_cash per cashier→employee,
  logbook_compliance per department dibagikan ke anggota, po_fulfillment
  qty_received/qty_ordered per pembuat PO), `targets.ts` (resolusi
  employee>dept>role>generic, periode-eksak>umum; 6 test), `snapshot.ts`
  (orkestrator idempoten — upsert snapshot+scorecard draft, scorecard FINAL
  tidak ditimpa via conditional ON CONFLICT). Route: POST
  /api/hris/kpi/snapshot (KPI_MANAGE_ROLES) + GET /api/hris/kpi/scorecards
  (HR semua; non-HR dikunci scorecard sendiri). Temuan saat verifikasi: tabel
  users = `configuration.users` (bukan public) — diperbaiki. Verifikasi dev
  7/2026: 4 karyawan → 8 snapshot + 4 scorecard, angka teraudit (Indra 1/13
  on-time → 8.10; Wahyu logbook 66,7%/90% → 74.07; tanpa data → null),
  re-run idempoten, 1 final dilewati, endpoint 401 tanpa login. 39 unit test
  kpi hijau, build sukses. Review gate berjalan (hasil menyusul).
  Berikutnya: Fase C UI scorecard.
- 2026-07-19 — **Perbaikan review Fase B** (code-reviewer: 0 CRITICAL, 3 HIGH,
  4 MEDIUM, 3 LOW): [HIGH] tie-break resolusi target kini deterministik
  (bulan-eksak > tahun-saja > umum) + target bulan-tanpa-tahun ("bulan ini
  tiap tahun") kini reachable — keduanya ber-regression-test; [HIGH] N+1
  dihapus — snapshot & scorecard di-upsert BATCH via unnest dalam SATU
  transaksi (rollback bersih, counter dari rowCount akurat); [MEDIUM]
  karyawan ber-scorecard FINAL kini dibekukan TOTAL (snapshot-nya pun tidak
  di-refresh, jejak audit cocok dgn breakdown terkunci); [LOW] excluded[]
  melaporkan komponen bobot-0, GET scorecards limit 500, validasi periode
  eksplisit. Deferred: integration test snapshot/collectors (dicatat,
  perlu fixture DB). 41 unit test hijau.
- 2026-07-19 — **Fase C SELESAI.** API: PATCH scorecards finalize/reopen
  (guard KPI_MANAGE_ROLES, reviewed_by/at), POST /api/hris/kpi/rubric
  (nilai 1-5 → snapshot manual supervisor_rubric target 5 + recompose;
  final → 409; sementara KPI_MANAGE_ROLES — penilaian atasan langsung
  reporting_to menyusul), GET scorecards + mode history=N (ESS) + peta
  indikator utk label breakdown; `recomposeScorecard` di lib snapshot.
  UI `src/features/hris/kpi/`: halaman HRD /dashboard/hris/kpi-scorecard
  (filter periode, Jalankan Snapshot ber-konfirmasi, tabel skor, dialog
  breakdown + input rubrik + finalisasi) & ESS /dashboard/me/kpi (skor
  terakhir + riwayat 12 bulan + breakdown read-only). Menu: migrasi
  `20260719130000` (hris.performance.kpi-scorecard utk super_admin/admin/
  hrd; ess.kpi semua role) applied+tracked. Verifikasi dev end-to-end:
  rubrik Wahyu 4/5 → skor 74.07→78.52 (cek manual matematika cocok),
  finalize → rubrik 409 → reopen OK, history me utk akun tanpa employee →
  kosong ramah (bug ditemukan saat uji & difix), halaman HRD/ESS 200.
  Build hijau. Sisa: Fase D (target setting UI + kolektor gelombang 2 +
  hook bonus payroll & rekomendasi PKWT).
