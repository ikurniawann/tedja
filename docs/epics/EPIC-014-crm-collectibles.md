# EPIC-014: CRM Collectibles — Artwork, Wallpaper & Badge

status: backlog
environment: dev
retries: 0

## Goal

Mengubah koleksi artwork CRM dari fitur yang tidak terlihat menjadi sistem
gamifikasi yang dipakai member:

1. **Etalase member** — member bisa melihat, membuka, dan memasang artwork
   koleksinya dari portal.
2. **Jatah tukar per milestone** — menembus ambang XP memberi member satu hak
   tukar; member memilih satu artwork dari tingkat itu. Tidak ada yang dibeli.
3. **Wallpaper** — artwork yang ditukar dengan jatah, bisa diunduh resolusi
   penuh.
4. **Badge by XP** — otomatis diberikan ketika `lifetime_xp` melewati ambang.
   Badge tidak memakai jatah karena bukan pilihan, melainkan bukti pencapaian.
5. **Upload artwork** — admin mengunggah karya langsung, bukan menempel URL.

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

### Model perolehan — diputuskan

Sistem punya dua mata uang: `ark_coin_balance` (dibelanjakan, dipakai
`crm_rewards`) dan `lifetime_xp` (akumulatif, penentu tier).

**Keputusan owner (20 Jul 2026): tidak ada collectible yang dibeli.** ARK Coin
tidak dipakai sama sekali di epic ini. Seluruh collectible diperoleh lewat
pencapaian XP, dan **member yang memilih** mana yang ditukar.

Model final: **jatah tukar berulang tiap kelipatan XP, berlaku ke bawah.**

| Aturan | Perilaku |
|--------|----------|
| Jatah diperoleh | satu jatah tiap kelipatan `interval_xp`, tanpa batas atas |
| Jumlah jatah | `floor(lifetime_xp / interval_xp)` |
| Arah pemakaian | jatah boleh dipakai untuk artwork mana pun yang ambangnya sudah dilewati |
| `lifetime_xp` | **tidak pernah berkurang** — tier selalu aman |

Contoh dengan `interval_xp = 5.000`: member ber-XP 50.000 memperoleh 10 jatah,
dan bebas memakainya untuk artwork apa pun yang ambang XP-nya ≤ 50.000 —
termasuk artwork lama yang dirilis sebelum ia bergabung.

Dua keputusan ini dipilih karena: jatah berulang membuat member veteran tetap
punya alasan mengumpulkan XP, dan pemakaian ke bawah membuat member yang telat
bergabung tidak merasa dihukum atas artwork yang terlewat.

**Konsekuensi yang harus diantisipasi:** jatah tidak pernah berhenti bertambah,
jadi katalog artwork harus terus diisi. Bila produksi artwork berhenti, member
veteran akan menumpuk jatah tanpa bisa memakainya. Perlu laporan sederhana
"jatah menganggur" agar kebutuhan artwork baru terlihat sebelum jadi keluhan.

**Badge dikecualikan.** Badge diberikan otomatis saat ambang tercapai dan tidak
memakai jatah — badge adalah bukti pencapaian, bukan hadiah yang dipilih.

### Penyederhanaan yang muncul dari kedua keputusan

Karena jatah kini **dihitung**, bukan diberikan satu per satu, rancangan
sebelumnya menyusut:

- Tabel `crm_collectible_milestones` **tidak diperlukan**. Cukup satu nilai
  konfigurasi `interval_xp`, plus kolom ambang `min_lifetime_xp` pada tiap
  artwork sebagai syarat kelayakan.
- `crm_member_entitlements` menjadi **ledger penukaran** semata:
  `member_id`, `asset_type`, `asset_id`, `redeemed_at`.
  Sisa jatah = `floor(lifetime_xp / interval_xp) − COUNT(ledger)`.
- **Backfill hilang.** Member lama otomatis memiliki jatah sesuai XP-nya tanpa
  proses migrasi apa pun.
- **Rekonsiliasi hilang.** Menurunkan `interval_xp` langsung menambah jatah
  semua member karena angkanya dihitung ulang saat dibaca.

Yang tersisa untuk ditangani dengan hati-hati:

- **Balapan penukaran** — dua permintaan bersamaan bisa memakai jatah yang sama.
  Wajib dikunci di level baris member (`SELECT … FOR UPDATE`) di dalam satu
  transaksi bersama penulisan ledger dan pengurangan stok.
- **Koreksi XP turun oleh admin** — `floor(lifetime_xp / interval_xp)` bisa
  jatuh di bawah jumlah yang sudah terpakai. Sisa jatah wajib dijepit ke
  `max(0, …)`, dan artwork yang sudah dimiliki **tidak** ditarik kembali.
- **`xp_cost`** — kolom lama menjadi tidak terpakai; jangan dipakai ulang untuk
  arti baru agar tidak menyesatkan.

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

### 2. Mesin jatah tukar

- Konfigurasi `interval_xp` + kolom `min_lifetime_xp` pada artwork.
- Tabel ledger `crm_member_entitlements` (`member_id`, `asset_type`,
  `asset_id`, `redeemed_at`).
- Perhitungan sisa jatah `max(0, floor(lifetime_xp / interval_xp) − terpakai)`.
- Tegakkan `required_tier_id` pada semua jalur perolehan.
- Laporan "jatah menganggur" agar kebutuhan artwork baru terlihat lebih dini.

**Exit:** sisa jatah member benar tanpa proses migrasi, dan tetap benar setelah
`interval_xp` diubah.

### 3. Redeem oleh member + upload artwork

- `POST /api/member/collectibles/redeem` — pakai satu jatah untuk artwork mana
  pun yang ambangnya sudah dilewati. Satu transaksi dengan kunci baris member,
  penulisan ledger, dan pengurangan stok; tolak jatah habis dan stok habis.
- Portal member: tampilkan sisa jatah dan artwork yang bisa dipilih.
- Ganti field "Image URL" jadi upload berkas + generate thumbnail.

**Exit:** member memilih sendiri artwork yang ditukar; admin mengunggah artwork
tanpa hosting eksternal.

### 4. Modul bersama `collectibles.ts`

- Pindahkan evaluasi syarat unlock, ambang XP, stok, dan pencatatan kepemilikan
  ke satu modul yang dipanggil ketiga jenis aset.

**Exit:** menambah jenis aset baru tidak menyalin logika unlock.

### 5. Wallpaper

- Tabel `crm_collectible_wallpapers` + inventory-nya, ditautkan ke milestone.
- Ikut alur jatah tukar yang sama seperti avatar.
- Aksi unduh resolusi penuh dari portal member.

**Exit:** member memakai jatah untuk memilih wallpaper, lalu dapat mengunduhnya.

### 6. Badge by XP

- Tabel `crm_member_badges` (tanpa stok, tanpa equip, tidak bisa dibeli).
- Admin badge builder: nama, artwork, ambang `lifetime_xp`.
- Pemberian otomatis saat XP melewati ambang — **tidak memakai jatah tukar** —
  plus notifikasi lewat WA gateway yang sudah berjalan.
- Badge tampil di profil member; maksimal 3 dipamerkan.

**Exit:** admin membuat badge dengan ambang XP → member yang memenuhi menerima
otomatis beserta notifikasi.

## Acceptance Criteria

- Member melihat koleksinya di portal tanpa bantuan admin.
- `lifetime_xp` tidak pernah berkurang oleh sebab apa pun.
- Tidak ada collectible yang dapat dibeli; ARK Coin tidak tersentuh epic ini.
- Sisa jatah selalu `max(0, floor(lifetime_xp / interval_xp) − terpakai)`.
- Jatah dapat dipakai untuk artwork lama yang ambangnya sudah dilewati.
- Jatah dan stok ditegakkan di server secara transaksional, bukan hanya di UI.
- Aturan unlock ketiga jenis aset berasal dari satu modul.
- Admin mengunggah artwork tanpa layanan hosting pihak ketiga.

## Test Plan

- Unit: evaluasi syarat unlock (ambang XP, tier, stok habis, jendela waktu).
- Unit: perhitungan sisa jatah pada XP tepat di kelipatan, di bawah kelipatan
  pertama, dan setelah banyak penukaran.
- Integrasi: dua permintaan redeem bersamaan hanya menghasilkan satu artwork
  (kunci baris member diuji, bukan diasumsikan).
- Integrasi: menurunkan `interval_xp` langsung menambah sisa jatah tanpa migrasi.
- Integrasi: koreksi XP turun menjepit sisa jatah ke nol tanpa menarik artwork
  yang sudah dimiliki.
- Integrasi: jatah dapat menukar artwork lama berambang rendah.
- Integrasi: melewati ambang XP memberi badge tepat satu kali tanpa jatah.
- E2E: member membuka portal, melihat wallpaper terkunci, XP bertambah dari
  transaksi POS, wallpaper terbuka dan dapat diunduh.
- Dark mode: halaman koleksi diperiksa di tema gelap.

## Automation Log

- **20 Jul 2026** — Epic dibuat. Audit menemukan fondasi koleksi sudah ada di
  skema `crm`, tetapi tanpa jalur member sama sekali; `xp_cost` dan
  `required_tier_id` tidak pernah dieksekusi di
  `avatar-inventory/route.ts:190-199`.
- **20 Jul 2026** — Keputusan owner: XP sebagai syarat, ARK Coin sebagai harga.
  **DIGANTIKAN pada hari yang sama** — lihat entri berikutnya.
- **20 Jul 2026** — Keputusan owner (final): tidak ada collectible yang dibeli;
  ARK Coin tidak dipakai di epic ini. Seluruh artwork diperoleh lewat **jatah
  tukar per milestone XP** dan member memilih sendiri. `lifetime_xp` tidak
  pernah berkurang. Badge dikecualikan — otomatis, tanpa jatah.
- **20 Jul 2026** — Keputusan owner: jatah **berulang tiap kelipatan XP** tanpa
  batas atas, dan **boleh dipakai ke bawah** untuk artwork lama. Akibatnya jatah
  cukup dihitung dari `lifetime_xp`, sehingga tabel milestone, proses backfill,
  dan job rekonsiliasi semuanya tidak lagi diperlukan. Risiko baru yang dicatat:
  katalog artwork harus terus diisi agar jatah tidak menganggur.
- **20 Jul 2026** — Keputusan owner: tabel terpisah per jenis aset. Mitigasi
  duplikasi lewat modul bersama `src/lib/crm/collectibles.ts` ditetapkan wajib.
