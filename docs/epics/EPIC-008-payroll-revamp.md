# EPIC-008: Payroll & Gaji — Integrasi Flow HRIS Terbaru

status: on-progress
environment: dev
retries: 0

## Goal

Merombak modul Payroll (HRIS Fase 2, dibangun 2026-05-05) yang saat ini
terputus total dari fitur HRIS terbaru: absensi v2 berbasis shift (EPIC-007),
kuota cuti, dan kontrak PKWT/PKWTT (EPIC-006). Payroll harus menghitung gaji
dari data operasional sungguhan (shift, keterlambatan, lembur, cuti, kontrak,
cicilan pinjaman), aman secara akses, punya satu sumber kebenaran konfigurasi,
dan karyawan bisa melihat slip gajinya sendiri lewat ESS.

## Evidence (hasil audit 2026-07-17)

Anchor kode: engine `src/lib/payroll/calculator.ts` (535 baris),
batch `src/app/api/hris/payroll/[id]/calculate/route.ts`,
status flow `src/app/api/hris/payroll/[id]/route.ts`,
skema `database/migrations/schemas/hris/000000000017{0,1,2,3}_*.sql` +
`..._employee_salary.sql`.

1. **Terputus dari HRIS baru** — payroll hanya membaca `attendance.status`
   (string kasar) + cuti `unpaid`; mengabaikan `shift_id`,
   `scheduled_start/end`, `late_minutes`, `overtime_hours`, `leave_balances`,
   dan `employment_contracts` sepenuhnya (grep: 0 referensi).
2. **Lembur tidak pernah masuk** — input `overtimeHours` selalu 0 di batch
   route; kolom `attendance.overtime_hours`/`is_overtime` tidak dipakai.
3. **Keterlambatan tidak berdampak** — `late_days` dihitung & disimpan tapi
   tidak pernah menghasilkan potongan apa pun.
4. **Dua sumber kebenaran konfigurasi** — engine memakai konstanta hardcoded
   (BPJS caps, bracket PPh21, PTKP) padahal tabel `payroll_settings` dan
   `payroll_tax_config` ada; keduanya bisa saling menyimpang. Ada indikasi bug
   bracket PPh21: `limit` diperlakukan sebagai lebar bracket tapi diisi
   campuran nilai kumulatif & lebar (calculator.ts:131–137, 192–198).
5. **Auth bolong** — endpoint paling sensitif (buat run, ubah status,
   calculate, hapus) TANPA `requireApiRole`; hanya `payslips` dan
   `employee-salary` yang dijaga. Pola auth campur (`db.auth.getUser()` vs
   `requireApiRole`).
6. **THR pakai magic string** — gate `employment_status==='permanent'`
   padahal default employees `'probation'` dan sumber kebenaran jenis
   hubungan kerja sekarang adalah kontrak (pkwt/pkwtt).
7. **Hari kerja pakai fallback 20** — bukan dari jadwal shift karyawan;
   hourly rate hardcoded base/hariKerja/8 jam.
8. **Cicilan pinjaman tidak mengalir** — tabel `loans` + approval ada, tapi
   kalkulator tidak menarik `monthly_installment` aktif ke
   `payroll_details.loan_deduction` dan saldo tidak berkurang saat run paid.
9. **Tidak ada slip gaji ESS** — karyawan tidak bisa melihat slipnya sendiri;
   API `payslips` dibatasi HR/finance; langkah "kirim payslip" di doc lama
   tidak diimplementasi (`payslip_sent` tak terpakai); "PDF" = window.print().
10. **Duplikasi logika** — `calculatePayrollForEmployee()` vs loop inline di
    batch route memuat data yang sama dua versi.
11. **Integritas** — `payroll_details` tanpa FK; pola delete-before-insert.
    Tidak ada proraté untuk karyawan masuk/keluar di tengah bulan.

## Scope

- Perombakan engine kalkulasi + integrasi shift/absensi/cuti/kontrak/pinjaman.
- Penguatan auth & status flow run payroll.
- Konfigurasi tunggal dari DB (settings + tax config).
- Slip gaji ESS untuk role employee.
- Non-goals: multi-tenant HRIS (tidak ada `business_id` di seluruh skema hris
  — keputusan arsitektur terpisah, lihat Open Questions), modul benefits
  (`benefits`/`employee_benefits` tetap tidak disentuh), pembayaran/transfer
  bank otomatis, e-Bupot/pelaporan pajak.

## Tasks

1. **Fase A — Stop pendarahan: auth, konfigurasi, bug engine** ✅ (2026-07-17)
   - `requireApiRole(['super_admin','hrd','finance_staff'])` di SEMUA endpoint
     payroll run (GET/POST/PUT/DELETE/calculate); pola auth seragam
     (`lib/payroll/roles.ts`); pengubahan tarif (PUT settings) lebih ketat:
     super_admin + hrd saja.
   - Engine membaca `payroll_settings` + `payroll_tax_config` (per tax_year)
     via `lib/payroll/config.loadPayrollConfig`; konstanta hardcoded jadi
     fallback default saja. Halaman pengaturan baru
     `/dashboard/hris/payroll/settings` (BPJS, Tapera, THR/lembur, PTKP &
     bracket per tahun pajak) + API `GET/PUT /api/hris/payroll-settings`
     (Zod, batas kumulatif bracket divalidasi harus naik ketat).
   - Bracket PPh21 hardcoded terverifikasi BENAR (nilai = lebar lapisan);
     konversi batas kumulatif DB → lebar via `cumulativeLimitsToBrackets`.
     Bug sungguhan yang diperbaiki: (a) Tapera terpotong GANDA dari
     penghasilan kena pajak & keliru mengikuti flag BPJS TK, (b) biaya
     jabatan (5%, maks 6jt/thn) tidak pernah diterapkan, (c) PKP kini
     dibulatkan ke ribuan penuh ke bawah (ketentuan DJP), (d) pph21_annual
     disimpan nilai tahunan sebenarnya (bukan bulanan×12).
     24 unit test `lib/payroll/calculator.test.ts` dengan angka acuan manual.
   - Loader tunggal `lib/payroll/inputs.ts` dipakai batch & per-karyawan;
     seluruh console.log debug dihapus; karyawan yang dilewati kalkulasi
     kini dilaporkan eksplisit di respons (`summary.skipped`).
   - Guard status flow: transisi sah hanya draft→processing→completed→paid,
     run `paid` tidak bisa dihapus, calculate tetap khusus `draft`.
   - Review gate (code-reviewer): APPROVE, 0 CRITICAL/HIGH. Catatan MEDIUM
     "segregation of duties" (satu akun bisa process+approve+paid sendiri)
     → keputusan produk, lihat Open Questions #5.
2. **Fase B — Integrasi absensi v2 + shift**
   - `working_days` dihitung dari jadwal shift karyawan
     (`employee_shifts` via `lib/hris/shifts.resolveShiftForDate`) untuk
     periode berjalan, bukan fallback 20; jam kerja harian dari durasi shift,
     bukan hardcoded 8 jam.
   - **Pengajuan lembur dua arah** (keputusan owner 2026-07-17): tabel
     `hris.overtime_requests` — (a) karyawan mengajukan lembur via ESS,
     disetujui HRD/atasan; (b) HRD membuat penugasan lembur atas nama
     perusahaan (source `company`), karyawan mengonfirmasi. Jam lembur yang
     masuk payroll = jam dari pengajuan approved yang terealisasi
     (dicocokkan dengan clock-out attendance), bukan overtime_hours mentah.
   - Potongan keterlambatan berbasis `attendance.late_minutes` dengan aturan
     konfigurabel di `payroll_settings` (mis. per-menit / flat per kejadian /
     nonaktif) — kebijakan final tunggu keputusan (Open Questions).
   - Cuti: unpaid leave tetap memotong; cuti berbayar (annual/sick/dll yang
     approved) dihitung hadir-dibayar, tidak memotong; sumber hari dari
     `leaves` approved yang overlap periode.
3. **Fase C — Integrasi kontrak PKWT/PKWTT**
   - Kelayakan & basis THR dari `employment_contracts` aktif (tipe pkwtt/pkwt
     + tanggal mulai untuk prorata), bukan magic string `employment_status`.
   - Saat kontrak ditandatangani/aktif, auto-buat versi `employee_salary`
     baru dari snapshot gaji kontrak (base_salary + allowances jsonb) supaya
     dua sumber gaji tidak menyimpang.
   - Proraté masuk/keluar tengah bulan dari tanggal mulai/berakhir kontrak
     (hari kerja terjadwal aktual dalam periode).
4. **Fase D — Pinjaman (kasbon) mengalir ke payroll**
   - Kalkulator menarik cicilan `loans` aktif (status approved, periode ≥
     first_installment) → `payroll_details.loan_deduction`.
   - Saat run ditandai `paid`: kurangi `remaining_balance`, tambah
     `paid_amount`, tandai lunas otomatis (transaksional, idempoten).
5. **Fase E — Slip gaji ESS + distribusi**
   - Halaman ESS `/dashboard/me/slip-gaji`: daftar slip per periode milik
     sendiri + detail slip (komponen penghasilan/potongan/netto/kehadiran);
     API `payslips` mendukung `employee_id=me` untuk role employee, hanya
     run berstatus `paid` yang terlihat karyawan.
   - Menu iam `ess.payroll` untuk role employee (pola menu ESS EPIC-007).
   - Tandai `payslip_sent/payslip_sent_at` saat distribusi; notifikasi
     WhatsApp "slip gaji terbit" via pola wa.me (mengikuti Fase 4 EPIC-007).
6. **Fase F — Integritas data + QA**
   - FK `payroll_details` → `payroll_runs` (ON DELETE CASCADE) + →
     `employees`; hapus pola delete-before-insert manual jika sudah aman.
   - Unit test kalkulator menyeluruh (PPh21, BPJS caps, THR prorata, proraté
     tengah bulan, lembur, potongan telat, cicilan) + test guard status flow.
   - Update `docs/hris/HRIS_FASE2_PAYROLL_COMPLETE.md` → tandai superseded
     oleh epic ini.

## Acceptance Criteria

- [ ] Semua endpoint payroll menolak akses tanpa role yang berhak (403).
- [ ] Mengubah rate BPJS/PPh21 di pengaturan langsung mengubah hasil
      kalkulasi tanpa deploy ulang; angka PPh21 cocok dengan acuan resmi.
- [ ] Hari kerja & jam kerja dihitung dari jadwal shift karyawan; karyawan
      tanpa jadwal ditangani eksplisit (bukan diam-diam 20 hari).
- [ ] Lembur tervalidasi dan menit keterlambatan tercermin di slip sesuai
      aturan yang dikonfigurasi.
- [ ] THR & proraté mengikuti kontrak aktif (PKWT/PKWTT + tanggal).
- [ ] Cicilan pinjaman terpotong otomatis dan saldo pinjaman berkurang saat
      run paid (idempoten — tidak dobel potong).
- [ ] Karyawan melihat slip gaji miliknya sendiri (hanya run paid) di ESS;
      tidak bisa melihat slip orang lain.
- [ ] Status flow run tidak bisa dilompati/dirusak (calculate non-draft
      ditolak, run paid tidak bisa dihapus).
- [ ] Unit test kalkulator hijau; lint + build hijau.

## Test Plan

- Unit: kalkulator (bracket PPh21 nilai acuan, BPJS caps, THR prorata pkwt/
  pkwtt, proraté tengah bulan, lembur, telat, cicilan), resolusi hari kerja
  dari pola shift (termasuk shift malam & minggu tanpa jadwal).
- Integration: siklus penuh run (create→calculate→process→approve→paid) via
  API dengan role berbeda; akses ESS `employee_id=me`; idempotensi potong
  cicilan saat paid dipanggil dua kali.
- E2E (dev): HRD membuat run periode berjalan pada data seed shift+absensi,
  verifikasi angka slip 1 karyawan secara manual; karyawan login lihat slip.

## Agent Routing

- Implementasi: Claude Code per fase (satu fase = satu task group = satu PR).
- Review gate: typescript-reviewer + security-reviewer (auth & data gaji =
  sensitif), database-reviewer untuk migrasi FK/settings.
- Test gate: unit (calculator, shifts resolve) + build + lint.

## Done Signal

Semua fase A–F selesai, acceptance criteria tercentang, status → ready-for-qa
dengan QA manusia memverifikasi 1 siklus payroll penuh di dev.

## Open Questions — DIPUTUSKAN (owner, 2026-07-17)

1. **Potongan keterlambatan** → **konfigurabel** di pengaturan payroll
   (mode: nonaktif / per-menit / flat per kejadian), nonaktif by default.
2. **Lembur** → **pengajuan lembur tersendiri, dua arah**: karyawan
   mengajukan sendiri (ESS) DAN perusahaan bisa menugaskan lembur — HRD yang
   membuat pengajuan jika dari perusahaan. Detail di Fase B.
3. **Multi-tenant** → ikut best practice: di luar scope epic ini, ditangani
   sebagai epic arsitektur terpisah (menambah `business_id` ke seluruh skema
   hris sekaligus, bukan tambal sulam di payroll saja).
4. **Proraté** → basis hari kerja terjadwal dari pola shift (best practice,
   konsisten dengan absensi v2).
5. **[BARU — dari review Fase A] Segregation of duties** — saat ini satu
   akun (hrd/finance) bisa memproses, meng-approve, dan menandai paid run
   yang sama sendirian. Perlu keputusan: wajibkan approver ≠ processor,
   atau batasi transisi `paid` ke role tertentu? (belum diputuskan)

## Automation Log

- 2026-07-17 — Epic dibuat dari audit menyeluruh modul payroll (Explore
  agent): payroll HRIS Fase 2 terkonfirmasi terputus dari absensi v2/shift/
  kontrak/kuota cuti, auth bolong di endpoint run/calculate, konfigurasi
  hardcoded menyimpang dari tabel settings. Status: backlog (menunggu
  keputusan Open Questions + go dari owner).
- 2026-07-17 — Owner memutuskan Open Questions 1–4 (potongan telat
  konfigurabel; lembur via pengajuan dua arah karyawan/perusahaan;
  multi-tenant epic terpisah; proraté basis hari terjadwal). Status →
  on-progress.
- 2026-07-17 — Fase A selesai. Temuan penting: bracket PPh21 hardcoded
  ternyata sudah benar (nilai = lebar lapisan), bug sebenarnya adalah Tapera
  dobel-potong dari PKP + biaya jabatan tak pernah diterapkan — keduanya
  diperbaiki dengan regression test. Gates: 338 unit test hijau, tsc bersih,
  eslint 0 error, build produksi sukses, code-review APPROVE (2 MEDIUM:
  validasi bracket → langsung diperbaiki; segregation of duties → Open
  Question #5). CATATAN DEPLOY: perubahan menaikkan akurasi PPh21 — hasil
  kalkulasi run draft lama akan berubah sedikit saat dihitung ulang (bukan
  bug).
