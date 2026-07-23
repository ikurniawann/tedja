# EPIC-018: Lampiran & OCR — Do Bisa Membaca Dokumen

status: on-progress
environment: dev
retries: 0

## Goal

Do bisa menerima lampiran (foto, PDF, DOCX, Excel, CSV), membaca isinya, lalu
menjawab berdasarkan dokumen itu. Lib ekstraksinya dibuat bebas-modul sejak awal
karena purchasing akan memakainya untuk scan nota/faktur di epic terpisah.

## Evidence (2026-07-21)

1. **OCR sudah ada dan sudah bekerja** — bukan perlu "diaktifkan". `tesseract.js`
   v7 terpasang, dipakai `src/lib/recruitment/cv-extract.ts` untuk CV kandidat.
   Diuji langsung: gambar berisi "Faktur Pembelian Nomor 12345" terbaca persis
   dalam < 1 detik.
2. **Data bahasa sudah lokal** — `eng.traineddata` (5,2 MB) dan `ind.traineddata`
   (1,8 MB) di root repo adalah cache unduhan tesseract.js, jadi OCR tidak lagi
   bergantung koneksi ke CDN saat runtime.
3. **Pipeline dokumen sudah terbukti** — `cv-extract.ts` menangani PDF (unpdf),
   DOCX (mammoth), gambar (OCR), plus fallback OCR untuk PDF hasil scan. Tetapi
   ia terikat ke storage rekrutmen (`cvUrlToDiskPath`), jadi tidak bisa dipakai
   ulang apa adanya.
4. **`xlsx` sudah jadi dependensi** — Excel tidak butuh paket baru.

## Keputusan Owner (2026-07-21)

- Mulai dari **chat Do**; purchasing menyusul sebagai modul terpisah.
- **Excel/CSV wajib didukung** agar file bisa dianalisis, bukan cuma dokumen teks.

## Scope

**Fase A — Lampiran di chat Do (selesai)**
- `src/lib/attachments/extract.ts`: ekstraksi bebas-modul (Buffer + nama file).
- `POST /api/ai/assistant/attachment`: unggah → teks, ber-guard login.
- UI chat: tombol klip, daftar lampiran, hapus per item, kirim bersama pesan.

**Fase B — Purchasing (belum)**
- Scan nota/faktur mengisi otomatis nomor, tanggal, dan total.
- Perlu penyimpanan file permanen + pemetaan hasil OCR ke field form.

## Non-Goals

- Menyimpan file lampiran chat secara permanen (lihat Keputusan Desain).
- Analisis gambar non-teks (grafik, foto produk) — itu ranah vision, bukan OCR.

## Keputusan Desain

- **File chat tidak disimpan.** Yang dibutuhkan Do hanya teksnya; menyimpan
  dokumen HR/keuangan yang diunggah sambil lalu menambah permukaan kebocoran
  tanpa manfaat jelas. Purchasing yang butuh arsip akan menyimpan di modulnya.
- **Spreadsheet dirender sebagai CSV per sheet**, bukan JSON. Bentuk datar lebih
  mudah dianalisis model dan jauh lebih hemat token daripada objek per sel.
- **Validasi berdasarkan ekstensi, bukan MIME** — MIME dari browser mudah
  dipalsukan, dan pemilihan ekstraktor memang bergantung ekstensi.
- **Lampiran hanya ikut satu pesan** lalu dikosongkan, supaya pertanyaan
  berikutnya tidak diam-diam membawa dokumen lama.

## Batas yang Ditegakkan

| Batas | Nilai | Alasan |
|---|---|---|
| Ukuran file | 10 MB | OCR file besar bisa menghabiskan memori & waktu |
| Teks per file | 20.000 char | Melindungi jendela konteks |
| Total semua lampiran | 40.000 char | Satu pesan tidak boleh membengkak tak terkendali |
| Jumlah file | 5 | Idem |
| Timeout OCR | 120 detik | Scan padat butuh waktu, tapi tidak boleh menggantung |

## Acceptance Criteria

- [x] PDF, DOCX, gambar, XLSX, dan CSV bisa dilampirkan dan terbaca.
- [x] PDF hasil scan (tanpa lapisan teks) otomatis jatuh ke OCR.
- [x] Endpoint menolak tanpa login, file kosong, terlalu besar, dan format asing.
- [x] Teks yang terlalu panjang dipotong dan ditandai, bukan diam-diam hilang.
- [x] Lampiran bisa dihapus sebelum dikirim.
- [ ] Uji end-to-end di browser dengan sesi login (unggah → tanya → jawab).

## Test Plan

- Unit: dukungan format, pemotongan teks, pembersihan baris, spreadsheet → CSV,
  penolakan file kosong & format asing (8 test).
- Manual: lampirkan foto nota, PDF, dan Excel; pastikan jawaban Do memakai isinya.

## Catatan Teknis Penting

OCR **tidak bisa diuji di vitest**: environment jsdom membuat tesseract.js
me-resolve path worker sebagai URL (`http://localhost:3000/…/worker-script/node/
index.js`) sehingga gagal. Ini murni artefak lingkungan test — jalur yang sama
diverifikasi berhasil di runtime Node sungguhan (`node harness.mjs` →
"Faktur Pembelian Nomor 12345"), dan route memakai `runtime = "nodejs"`.
Karena itu unit test sengaja tidak mencakup OCR; verifikasinya manual.

## Automation Log

- 2026-07-21 — **Fase A selesai.** Lib ekstraksi bebas-modul + endpoint unggah +
  UI lampiran di chat Do. Ditemukan bahwa OCR sudah aktif sejak modul CV
  (bukan perlu diaktifkan) dan `xlsx` sudah terpasang, sehingga tidak ada
  dependensi baru sama sekali. 676 test hijau, build sukses.
  Sisa: uji end-to-end di browser; Fase B (purchasing) belum dimulai.
