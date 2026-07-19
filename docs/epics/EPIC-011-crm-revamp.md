# EPIC-011: CRM Revamp — Member Global, XP Lifetime, ARK Coin & Portal Member

status: on-progress
environment: dev
retries: 0

## Goal

Merombak total modul CRM menjadi sistem loyalty berbasis **identitas member
global lintas tenant**: XP sebagai skor seumur hidup (append-only, penentu
tier), ARK Coin sebagai satu-satunya jalur perolehan XP, dua tipe member
(terdaftar vs kartu), dan portal member self-service
(`member.suluindwounderland.com`) dengan login OTP WhatsApp. Menjadi fondasi
untuk Omnichannel CRM (broadcast, inbox WA) yang menyusul di epic berikutnya.

## Keputusan Owner (2026-07-19)

Hasil diskusi desain — SEMUA sudah diputuskan owner:

1. **Identitas member GLOBAL lintas tenant** — member, saldo ARK, XP hidup di
   level platform (bukan per venue). `pos_customers` tanpa `company_id` adalah
   by design. Konsekuensi: setiap transaksi wallet/XP/order wajib mencatat
   venue/tenant kejadian untuk laporan rekonsiliasi antar-venue.
2. **XP = skor seumur hidup**: hanya bertambah, TIDAK PERNAH berkurang.
   Konsep `current_xp`/`spent_xp` dihapus; ledger jadi append-only earn.
3. **XP hanya dari belanja dengan metode ARK Coin.** Metode pembayaran TIDAK
   boleh campur — 1 pembayaran = 1 metode. (Split bill antar orang tetap boleh;
   tiap split dibayar 1 metode; XP keluar untuk split yang dibayar ARK.)
4. **"Redeem" berubah jadi privilege**: produk khusus bersyarat `min_xp`
   (dan/atau min tier). Member yang memenuhi boleh membeli (bayar normal), XP
   tidak dipotong. Alur `crm_rewards` + `crm_redemptions` lama PENSIUN.
5. **4 tier default: Regular, Bronze, Silver, Gold** — nama & ambang XP
   (`min_lifetime_xp`) konfigurable Super Admin (tabel `crm_membership_tiers`
   existing sudah mendukung). Regular mulai dari 0 XP (tier awal semua member).
6. **Diskon per tier TETAP ADA**, konfigurable admin — kasir wajib baca
   `discount_percent` dari konfigurasi tier, bukan hardcode (fix bug audit).
7. **Dua tipe member**: (a) member terdaftar saja (nama + HP dari POS, tanpa
   kartu, tanpa topup → tidak pernah dapat XP transaksi); (b) member kartu
   (punya kartu NFC tertaut + akses topup ARK Coin).
8. **Topup ARK Coin hanya untuk member kartu.** Bonus topup default 10%
   (topup 1jt → saldo 1,1jt), persentase konfigurable Super Admin. Bonus
   dicatat sebagai transaksi wallet terpisah (`topup_bonus`) untuk akuntansi.
   ARK Coin **non-refundable**.
9. **Portal member** `member.suluindwounderland.com`, login **OTP WhatsApp**
   (via Fonnte existing). Member melengkapi profil → 100% komplit dapat
   **Free XP** (nominal konfigurable Super Admin, sekali seumur hidup,
   idempotent). Free XP berlaku untuk SEMUA member (satu-satunya pengecualian
   aturan tanpa-kartu-tanpa-XP).
10. **Field profil member**: nama, HP (verified via OTP), email, tanggal
    lahir, jenis kelamin, kota/domisili, foto profil, consent promo WA.
11. **Top spender = nilai belanja/order** (ARK maupun tunai/QRIS). Topup TIDAK
    dihitung spend (fix bug existing di route topup yang menambah
    `total_spent`). Porsi bonus ikut terhitung saat dibelanjakan. Laporan
    frequent visitor (visit_count/last_visit) dipertahankan.
12. **Collectible artwork per venue** — masih rancangan, TIDAK masuk scope
    epic ini (infra `crm_collectible_avatars` + inventory existing jadi bahan
    nanti).

## Aset Existing yang Dipertahankan vs Pensiun

| Dipertahankan (diperluas) | Pensiun / berubah total |
|---|---|
| `pos_customers` (+ tipe member, profil lengkap) | `crm_rewards` + `crm_redemptions` (ganti: produk khusus ber-syarat XP) |
| Wallet + `pos_wallet_transactions` (+ venue, + `topup_bonus`) | `current_xp`/`spent_xp` di `crm_member_profiles` |
| `crm_membership_tiers` (name/rank/min_lifetime_xp/discount_percent) | Map `TIER_DISCOUNTS` hardcoded di kasir |
| `crm_xp_ledger` (jadi append-only earn) | Alur `awardCrmXpForPosOrder` tanpa cek metode bayar |
| `crm_xp_rules` (basis besaran XP per Rp) | Split payment multi-metode dalam 1 pembayaran |
| RPC `update_ark_coin_balance` (pola atomik) | Topup menambah `total_spent` |
| Topup POS + NFC (`nfc_uid`) + struk | |
| Laporan top spender & frequent visitor | |

## Fase

### Fase A — Fondasi data & fix kritikal
- Migrasi skema: tipe member (terdaftar/kartu), kolom venue di wallet/XP/order,
  field profil + consent, hapus konsep current/spent XP, tabel konfigurasi CRM
  (bonus topup %, free XP, dst).
- Fix bug audit yang tetap relevan: diskon tier dari konfigurasi (bukan
  hardcode), role check endpoint konfigurasi CRM, topup tidak menambah
  `total_spent`, topup atomik via pola RPC, cache customer kasir refresh
  setelah transaksi, search member, error message leakage.

### Fase B — Engine XP & tier baru
- XP earn hanya dari pembayaran ARK Coin (cek metode; split per-metode).
- Auto-naik-tier saat lifetime XP menembus ambang.
- UI konfigurasi Super Admin: tier (rename, ambang, diskon), XP rules, bonus
  topup %, free XP.
- Enforcement 1 pembayaran = 1 metode di kasir.

### Fase C — Topup & member kartu
- Topup member-only (member kartu), bonus % dari konfigurasi, transaksi
  `topup_bonus` terpisah, penautan kartu NFC = upgrade member kartu.
- Produk khusus ber-syarat min XP/tier di kasir.

### Fase D — Portal member
- `member.suluindwounderland.com`: login OTP WA (Fonnte), lihat saldo/XP/tier,
  lengkapi profil (progress %), Free XP saat 100% (idempotent), riwayat
  transaksi.

### Fase E — Laporan & rekonsiliasi
- Top spender (basis order), frequent visitor, laporan rekonsiliasi
  antar-venue (topup di A dibelanjakan di B), dashboard CRM menyesuaikan
  skema baru.

## Acceptance Criteria

- Member tanpa kartu tidak pernah bertambah XP dari transaksi apa pun; Free XP
  profil 100% tetap masuk untuk semua tipe member, sekali saja.
- Belanja ARK Coin menambah XP sesuai `crm_xp_rules`; metode lain tidak.
- XP tidak pernah berkurang oleh operasi apa pun.
- Ubah `discount_percent` tier di konfigurasi → langsung berlaku di kasir.
- Topup 1jt dengan bonus 10% → saldo bertambah 1,1jt, tercatat 2 baris wallet
  (topup + topup_bonus), `total_spent` TIDAK berubah.
- Dua request redeem/topup/bayar konkuren tidak bisa double-spend saldo
  (atomik + lock).
- Login portal hanya bisa dengan OTP WA yang valid.
- Semua transaksi wallet/XP baru tercatat venue kejadiannya.

## Catatan Keterkaitan

- Prasyarat/lanjutan dari analisa Omnichannel CRM (Qontak) — outbox WA +
  broadcast + inbox 2-arah menyusul sebagai epic terpisah setelah epic ini.
  Nomor WA terverifikasi OTP dari portal member = kunci penghubung inbox.
- Temuan audit CRM 19 Jul 2026 (10 bug): sebagian larut dalam rombakan
  (race XP spend, formula loyalty_score), sisanya masuk Fase A.

## Automation Log

- 2026-07-19 — Epic dibuat dari hasil diskusi desain owner (12 keputusan
  terkunci, lihat bagian Keputusan Owner). Status backlog — menunggu owner
  menandai on-progress.
- 2026-07-19 — **Fase A SELESAI.** Migrasi
  `20260719170000_crm_revamp_fase_a.sql` + `20260719171000_crm_seed_default_tiers.sql`
  diterapkan ke dev:
  - `pos_customers`: `member_type` (registered/card, backfill dari `nfc_uid`),
    `card_issued_at`, profil (`birth_date`, `gender`, `city`, `photo_url`),
    `wa_consent`, `wa_verified_at`, `profile_completed_at`,
    `free_xp_granted_at`; default tier baru = `regular`.
  - Tier `Regular` rank 0 (check rank dilonggarkan ke >=0) + seed default
    Bronze/Silver/Gold (tabel tier dev ternyata kosong sebelumnya).
  - Kolom venue `company_id`+`branch_id` di `pos_wallet_transactions`,
    `crm_xp_ledger`, `pos_orders` (+index) — FK ke `configuration.companies/branches`.
  - `crm.crm_settings` (key-value): `topup_bonus_percent`=10,
    `profile_completion_free_xp`=100, `default_company_id`/`default_branch_id`
    terisi otomatis dari hierarchy (single-venue Sulu).
  - RPC `public.process_ark_topup`: topup atomik (FOR UPDATE), TIDAK menambah
    `total_spent`, stempel venue; route `POST /api/pos/topup` memakainya.
  - Fix audit: diskon tier kasir dibaca dari `crm_membership_tiers` via
    `/api/pos/customers` (`discount_percent`), map `TIER_DISCOUNTS` hardcode
    dihapus; role guard `requireCrmConfigRole` (super_admin) di POST/DELETE
    tiers/rewards/xp-rules/avatars; kasir `refetchCustomers()` di semua jalur
    sukses bayar (incl. split); search members mencakup nama/phone/email;
    `apiErrorResponse` tidak lagi membocorkan pesan error internal (log
    server saja), catch-all route customers/topup dibuat generik.
  - Penautan NFC di POST customers otomatis set `member_type='card'` +
    `card_issued_at`.
  - CATATAN: `current_xp`/`spent_xp` sengaja belum di-drop — engine lama masih
    membacanya; drop di Fase B saat rewrite engine XP.
  - Gate: 489 unit test hijau (68 file), `next build` sukses, tsc error count
    identik baseline (466 noise lama, 0 baru).
