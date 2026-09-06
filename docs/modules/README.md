# Modules — Registry Deploy

Registry modul yang **bisa dipanggil namanya** saat ingin dinaikkan ke
production. Selama status masih `dev`, modul hanya ada di branch
`development` dan **tidak** dipromosikan ke `production`.

Cara memakai: sebut nama modulnya, mis. *"deploy MODULE-RESORT ke production"*.
Prosedurnya mengikuti bagian **Checklist rilis** di dokumen modul.

| Modul | Judul | Status | Epic | Migration | Catatan |
|-------|-------|--------|------|-----------|---------|
| `MODULE-BRANDING` | Merek instance multi-perusahaan | `dev` | [EPIC-045](../epics/EPIC-045-resort-akomodasi.md#module-branding) | — | Aman ke production kapan saja (default tetap Sulu in Wounderland) |
| `MODULE-RESORT` | Resort & Akomodasi (booking kamar, front office, folio) | `dev` | [EPIC-045](../epics/EPIC-045-resort-akomodasi.md) | `20260906130000_resort_booking.sql` | Menu baru **Resort**; tidak mengubah modul lain |
| `MODULE-DUSUN-BAMBU` | Tenant Dusun Bambu (data demo lokal: bisnis, resort penuh, F&B, ticketing) | `dev-only` | [EPIC-046](../epics/EPIC-046-tenant-dusun-bambu.md) | — | **Tidak pernah** ke production: seeder menolak database non-lokal |

## Arti status

| Status | Arti |
|--------|------|
| `dev` | Sudah di branch `development`, terverifikasi lokal, menunggu perintah owner untuk dipromosikan ke `production` |
| `dev-only` | Sengaja tidak untuk production (data demo / alat bantu lokal) |
| `production` | Sudah live; tanggal rilis dicatat di dokumen modul |

## Urutan promosi bila dinaikkan bersamaan

1. `MODULE-BRANDING` — tidak ada migration, tidak mengubah perilaku bila
   `NEXT_PUBLIC_APP_NAME` tidak diisi.
2. `MODULE-RESORT` — apply migration lebih dulu, baru deploy kode.

`MODULE-DUSUN-BAMBU` tidak ikut promosi apa pun.
