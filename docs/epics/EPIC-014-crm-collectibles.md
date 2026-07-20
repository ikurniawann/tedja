# EPIC-014: CRM Collectibles — Artwork, Wallpaper & Badge

status: backlog
environment: dev
retries: 0

## Goal

Mengubah koleksi artwork CRM dari fitur yang tidak terlihat menjadi sistem
gamifikasi yang dipakai member:

1. **Etalase member** — member bisa melihat, membuka, dan memasang artwork
   koleksinya dari portal.
2. **Wallpaper gratis** — artwork yang terbuka otomatis saat XP mencapai
   ambang, bisa diunduh resolusi penuh.
3. **Badge by XP** — admin membuat badge yang otomatis diberikan ketika
   `lifetime_xp` member melewati ambang tertentu.
4. **Upload artwork** — admin mengunggah karya langsung, bukan menempel URL.

## Temuan Kelayakan (20 Jul 2026)

### Fondasi sudah ada — celahnya di sisi member

Skema `crm` sudah punya tulang koleksi yang lengkap:

| Tabel | Yang sudah tersedia |
|-------|---------------------|
| `crm_collectible_avatars` | rarity 5 tingkat, `image_url`, `required_tier_id`, `xp_cost`, stok terbatas, jendela `starts_at`/`ends_at` |
| `crm_member_avatar_inventory` | kepemilikan, `acquisition_source`, `is_equipped` |
| `crm_member_profiles.active_avatar_id` | avatar yang sedang dipakai |
| `crm_rewards.linked_avatar_id` | reward dapat memberi avatar |
| `crm_xp_rules` / `crm_xp_ledger` | XP dari POS, photobooth, studio game, campaign |

Jadi rarity, stok terbatas, drop musiman, dan gate per tier **tidak perlu
dibangun ulang**.

### Tiga celah yang membuat fitur terasa tidak ada

1. **Tidak ada satu pun endpoint avatar untuk member.** Pencarian di
   `src/app/api/member*` dan portal member tidak menemukan apa pun. Satu-satunya
   jalan member memperoleh avatar adalah admin menekan "grant" manual di
   `/api/crm/avatar-inventory`. Admin dapat membangun koleksi lengkap yang tidak
   pernah dilihat siapa pun. **Ini celah terbesar** — menambah wallpaper dan
   badge sebelum ini beres hanya menambah stok gudang tanpa etalase.

2. **`xp_cost` dan `required_tier_id` tidak pernah dieksekusi.** Di
   `src/app/api/crm/avatar-inventory/route.ts:190-199` grant hanya memeriksa
   `is_active` dan stok. Tier tidak dicek, XP tidak dipotong. Dua kolom itu
   hari ini dekoratif.

3. **Admin harus menghosting gambar sendiri.** Form di
   `src/features/crm/avatars/components/crm-avatars-page.tsx:247` hanya
   menyediakan field "Image URL". Infra upload sudah ada dan bisa dipakai ulang
   (`/api/candidates/[id]/cv-upload`, `/api/psikotes/.../upload`).

### Cacat desain mata uang — diputuskan

Sistem punya dua mata uang: `ark_coin_balance` (dibelanjakan, dipakai
`crm_rewards`) dan `lifetime_xp` (akumulatif, penentu tier). Bila `xp_cost`
benar-benar dipotong dari `lifetime_xp`, member yang membeli hiasan bisa
**turun tier** dan kehilangan diskon — terasa sebagai hukuman.

**Keputusan owner (20 Jul 2026): XP adalah syarat, ARK Coin adalah harga.**
`lifetime_xp` tidak pernah berkurang.

| Aset | Cara diperoleh |
|------|----------------|
| Wallpaper gratis | capai ambang XP → otomatis masuk koleksi |
| Badge | capai ambang XP → otomatis, tidak bisa dibeli |
| Avatar premium | dibeli dengan ARK Coin, stok terbatas |
| Frame musiman | gate tier + jendela waktu event |

### Bentuk skema — diputuskan

**Keputusan owner (20 Jul 2026): tabel terpisah per jenis aset**, bukan satu
tabel dengan `asset_type`.

Konsekuensi yang diterima: tabel, API, dan halaman admin terduplikasi per jenis;
`crm_rewards.linked_avatar_id` tetap hanya menunjuk avatar.

**Mitigasi wajib:** aturan unlock, pengecekan ambang XP, pencatatan kepemilikan,
dan penegakan stok ditaruh di satu modul bersama `src/lib/crm/collectibles.ts`.
Yang boleh terduplikasi hanya tabel dan CRUD-nya — **bukan aturannya**. Tanpa
ini, tiga salinan logika unlock akan menyimpang satu sama lain.

## Tasks

### 1. Etalase koleksi di portal member

Buka jalur member sebelum menambah jenis aset baru.

- `GET /api/member/collectibles` — daftar aset dimiliki vs terkunci beserta
  syarat dan progress XP.
- `POST /api/member/collectibles/equip` — pasang avatar sebagai foto profil.
- Halaman "Koleksi" di portal member: galeri dimiliki/terkunci, progress
  "kurang N XP lagi", aksi pasang.
- Tanpa perubahan skema — memakai tabel yang sudah ada.

**Exit:** member dapat melihat dan memasang avatar yang dimilikinya.

### 2. Penegakan aturan + upload artwork

- Tegakkan `required_tier_id` pada semua jalur perolehan.
- Ubah arti kolom harga: `xp_cost` → `ark_coin_cost`, potong dari
  `ark_coin_balance`, catat di ledger. `lifetime_xp` tidak pernah dikurangi.
- Ganti field "Image URL" jadi upload berkas + generate thumbnail.

**Exit:** avatar premium hanya bisa diperoleh bila tier dan saldo mencukupi;
admin dapat mengunggah artwork tanpa hosting eksternal.

### 3. Modul bersama `collectibles.ts`

- Pindahkan evaluasi syarat unlock, ambang XP, stok, dan pencatatan kepemilikan
  ke satu modul yang dipanggil ketiga jenis aset.

**Exit:** menambah jenis aset baru tidak menyalin logika unlock.

### 4. Wallpaper

- Tabel `crm_collectible_wallpapers` + inventory-nya.
- Unlock otomatis pada ambang XP.
- Aksi unduh resolusi penuh dari portal member.

**Exit:** member mencapai ambang XP → wallpaper muncul di koleksi dan bisa
diunduh.

### 5. Badge by XP

- Tabel `crm_member_badges` (tanpa stok, tanpa equip, tidak bisa dibeli).
- Admin badge builder: nama, artwork, ambang `lifetime_xp`.
- Pemberian otomatis saat XP melewati ambang + notifikasi lewat WA gateway
  yang sudah berjalan.
- Badge tampil di profil member; maksimal 3 dipamerkan.

**Exit:** admin membuat badge dengan ambang XP → member yang memenuhi menerima
otomatis beserta notifikasi.

## Acceptance Criteria

- Member melihat koleksinya di portal tanpa bantuan admin.
- `lifetime_xp` tidak pernah berkurang oleh pembelian apa pun.
- Tier dan stok ditegakkan di server, bukan hanya di UI.
- Aturan unlock ketiga jenis aset berasal dari satu modul.
- Admin mengunggah artwork tanpa layanan hosting pihak ketiga.

## Test Plan

- Unit: evaluasi syarat unlock (ambang XP, tier, stok habis, jendela waktu).
- Integrasi: pembelian ARK Coin memotong saldo dan tidak menyentuh
  `lifetime_xp`; grant ganda ditolak.
- Integrasi: melewati ambang XP memberi badge tepat satu kali.
- E2E: member membuka portal, melihat wallpaper terkunci, XP bertambah dari
  transaksi POS, wallpaper terbuka dan dapat diunduh.
- Dark mode: halaman koleksi diperiksa di tema gelap.

## Automation Log

- **20 Jul 2026** — Epic dibuat. Audit menemukan fondasi koleksi sudah ada di
  skema `crm`, tetapi tanpa jalur member sama sekali; `xp_cost` dan
  `required_tier_id` tidak pernah dieksekusi di
  `avatar-inventory/route.ts:190-199`.
- **20 Jul 2026** — Keputusan owner: XP sebagai syarat, ARK Coin sebagai harga;
  `lifetime_xp` tidak pernah berkurang.
- **20 Jul 2026** — Keputusan owner: tabel terpisah per jenis aset. Mitigasi
  duplikasi lewat modul bersama `src/lib/crm/collectibles.ts` ditetapkan wajib.
