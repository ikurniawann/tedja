# Modules — Registry Deploy

Registry modul yang **bisa dipanggil namanya** saat ingin dinaikkan ke
production. Selama status masih `dev`, modul hanya ada di branch
`development` dan **tidak** dipromosikan ke `production`.

Cara memakai: sebut nama modulnya, mis. *"deploy MODULE-RESORT ke production"*.
Prosedurnya mengikuti bagian **Checklist rilis** di dokumen modul.

| Modul | Judul | Status | Epic | Migration | Catatan |
|-------|-------|--------|------|-----------|---------|
| `MODULE-BRANDING` | Merek instance multi-perusahaan | `production` | [EPIC-045](../epics/EPIC-045-resort-akomodasi.md#module-branding) | — | Rilis 2026-09-07. Default tetap Sulu in Wounderland bila `NEXT_PUBLIC_APP_NAME` kosong |
| `MODULE-RESORT` | Resort & Akomodasi (booking kamar, front office, folio) | `production` | [EPIC-045](../epics/EPIC-045-resort-akomodasi.md) | `20260906130000_resort_booking.sql` | Rilis 2026-09-07 **tanpa data contoh**. Menu Resort baru muncul setelah migration di-apply; master tipe & unit kamar diisi manual lewat Resort → Kamar & Tipe |

## Modul yang sengaja TIDAK ada di branch ini

Seeder demo tinggal permanen di `development` dan tidak pernah dipromosikan —
semuanya memanggil `assertLocalTarget()` sehingga berhenti bila `DATABASE_URL`
bukan database lokal.

| Modul | Judul | Ada di |
|-------|-------|--------|
| `MODULE-RESORT-DEMO` | Data contoh Resort untuk venue utama | `development` |
| `MODULE-DUSUN-BAMBU` | Tenant demo Dusun Bambu (bisnis, resort, F&B, ticketing) | `development` |

Konsekuensinya: promosi `development` → `production` berikutnya akan membawa
berkas seeder itu ikut. Bila tetap tidak diinginkan, promosikan lewat
cherry-pick commit kode saja (pola yang dipakai pada rilis 2026-09-07 ini),
bukan merge penuh.

## Arti status

| Status | Arti |
|--------|------|
| `dev` | Sudah di branch `development`, terverifikasi lokal, menunggu perintah owner untuk dipromosikan ke `production` |
| `dev-only` | Sengaja tidak untuk production (data demo / alat bantu lokal) |
| `production` | Sudah live; tanggal rilis dicatat di dokumen modul |
