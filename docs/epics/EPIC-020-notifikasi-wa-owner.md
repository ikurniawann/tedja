# EPIC-020: Notifikasi WhatsApp untuk Owner

status: coding
environment: dev
retries: 0

## Goal

Kabar penting bisnis mengejar owner lewat WhatsApp — tanpa perlu membuka
desktop. Prinsip utamanya anti-spam: desktop boleh cerewet, WA harus pelit.
Ujian setiap notifikasi: *layakkah ini menyela makan malam owner?*

## Keputusan Owner (2026-07-21)

Owner menyetujui seluruh usulan tiga tingkat, plus konfigurasi on/off per jenis
dan daftar nomor penerima, ditempatkan di Settings desktop Arkiv OS.

| Tingkat | Jenis | Kapan dikirim |
|---|---|---|
| **Kritis** | Void bernilai besar (ambang default Rp 500 rb) · stok bahan benar-benar habis · komplain pelanggan masuk (EPIC-012) · review Google ≤2 bintang (EPIC-013) | Seketika |
| **Harian** | Ringkasan jam tutup: omzet vs kemarin, kehadiran, antrean keputusan, stok menipis | 1×/hari |
| **Ambang** | Omzet hari berjalan anjlok · approval menginap >2 hari · kontrak PKWT habis ≤30 hari | Saat melewati batas |

Sengaja TIDAK dikirim: pesanan baru satu-per-satu, member baru, clock-in —
berita di desktop, sampah di WA.

## Scope

**Fase A — Konfigurasi (selesai)**
- `src/lib/wa/notifications-config.ts`: katalog 8 jenis (per tingkat), bentuk
  config, normalisasi nomor (08…/+62…/62… → 62…), parser toleran (JSON rusak/
  parsial jatuh ke default, bukan meledak). 9 unit test.
- `GET/PUT /api/settings/wa-notifications` + `POST …/test` (kirim pesan uji ke
  semua nomor tersimpan via `sendGatewayText`) — gate super_admin + direksi.
- Panel di desktop: Settings → **Notifikasi WA** (`wa-notif-settings.tsx`):
  saklar utama, toggle per jenis dikelompokkan per tingkat, ambang void bisa
  diubah, kelola nomor (tambah/hapus, maks 5), tombol Kirim Tes.
- Master switch default **mati** — notifikasi hidup hanya setelah owner sadar
  menyalakannya.

**Fase B — Mesin pengirim (belum)**
- Ringkasan harian: penjadwal (cron PM2 / node-cron) jam tutup, format dari
  `buildDesktopOverview`.
- Void besar: kait di jalur void POS (event, bukan polling).
- Stok habis: cek saat pergerakan stok menyentuh nol.
- Dedup & cooldown: kejadian sama tidak dikirim dua kali; stok habis maks
  1×/bahan/hari. Jam tenang: non-kritis ditahan sampai pagi.

**Fase C — Sambungan omnichannel (belum)**
- Komplain (EPIC-012) & review rendah (EPIC-013) memanggil pengirim yang sama.

**Fase D — Ambang lanjutan (belum)**
- Omzet anjlok (perbandingan dengan rata-rata hari sejenis), approval menginap,
  kontrak habis (reuse logika `ContractExpiryBanner`).

## Non-Goals

- Notifikasi "sistem mati" — sistem yang mati tidak bisa mengirim; butuh
  watchdog eksternal, di luar epic ini.
- Balasan dua arah (owner membalas WA untuk approve) — menarik, tapi permukaan
  keamanannya besar; epic terpisah bila diminta.

## Acceptance Criteria

- [x] Fase A: konfigurasi tersimpan; nomor dinormalkan & divalidasi; endpoint
      menolak tanpa login; Kirim Tes membuktikan sambungan gateway.
- [ ] Fase B: ringkasan harian terkirim terjadwal; void besar & stok habis
      terkirim seketika dengan dedup.
- [ ] Fase C: komplain & review rendah terkirim.
- [ ] Fase D: tiga notifikasi ambang berjalan.
- [ ] Semua: jenis yang dimatikan TIDAK PERNAH terkirim; master mati = senyap total.

## Test Plan

- Unit: normalisasi nomor, parser config, (Fase B) formatter pesan & aturan dedup.
- Manual: simpan nomor → Kirim Tes → pesan masuk WA; matikan jenis → tidak terkirim.

## Catatan Teknis

- Pengirim memakai `lib/whatsapp/gateway.ts` (`sendGatewayText`) — jalur yang
  sama dengan OTP portal member; sender +6285880974659 (services/wa-gateway).
- Config satu JSON di `app_settings.wa_notif_config`, bukan kolom-kolom
  terpisah — bentuknya masih akan berkembang di Fase B–D.

## Automation Log

- 2026-07-21 — **Fase A selesai.** Lib config + 9 unit test, API GET/PUT/test
  ber-gate super_admin+direksi (401 tanpa login terverifikasi), panel Settings →
  Notifikasi WA di desktop (saklar utama default mati, toggle per jenis per
  tingkat, ambang void, maks 5 nomor ternormalisasi, Kirim Tes per-nomor dengan
  hasil per baris). 700 test hijau, build sukses. Sisa QA: buka panel dari
  Settings desktop, simpan nomor sungguhan, tekan Kirim Tes — pesan harus masuk
  WA (butuh wa-gateway hidup di server dev).
