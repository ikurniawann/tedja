# EPIC-013: Omnichannel — Google Review & Instagram DM

status: coding
environment: dev
retries: 0

## Goal

Memperluas kanal customer service di luar WhatsApp (EPIC-012):

1. **Google Review** — tarik ulasan Google Business Profile ke dashboard,
   **balas langsung dari dashboard**, dan perlakukan ulasan bintang rendah
   sebagai komplain dengan SLA seperti chat.
2. **Instagram DM** — setiap direct message masuk ke inbox yang sama.
   Keputusan owner: **tidak perlu ditautkan ke profil member** — cukup
   tertampung dan bisa dibalas.

## Temuan Kelayakan (20 Jul 2026)

### Google Review — TIDAK perlu scraping

**Google Business Profile API resmi mendukung baca DAN balas ulasan**
(`accounts.locations.reviews` untuk daftar, `reviews.updateReply` untuk
membalas). Jadi permintaan "langsung balas dari dashboard" bisa dipenuhi
lewat jalur resmi.

**Scraping ditolak sebagai pendekatan**, bukan karena sulit:
- melanggar ToS Google dan berisiko pada profil bisnis itu sendiri;
- rapuh — markup Google berubah sewaktu-waktu;
- **tidak bisa membalas sama sekali** — membalas wajib terautentikasi sebagai
  pengelola lokasi. Jadi scraping hanya memberi setengah fitur, dengan risiko.

Prasyarat: Google Business Profile terverifikasi, project Google Cloud,
**pengajuan akses Business Profile API** (form persetujuan Google), dan OAuth
dari akun yang punya akses pengelola lokasi. Umumnya lebih ringan daripada
Meta App Review, tapi tetap perlu waktu.

> Perlu diverifikasi saat implementasi: mekanisme notifikasi ulasan baru.
> Baseline yang pasti jalan adalah polling berkala; Google juga menyediakan
> notifikasi (Pub/Sub) yang dipakai bila tersedia.

### Instagram DM — hanya ada jalur resmi

Instagram Messaging API (Meta) butuh akun IG Professional tertaut Halaman
Facebook, aplikasi Meta, izin `instagram_manage_messages`, dan **App Review +
verifikasi bisnis** — proses panjang yang sama seperti WhatsApp Cloud API.

**Pustaka tidak resmi ditolak.** Untuk WhatsApp kita menerima risiko blokir
karena memakai nomor khusus. Akun Instagram Sulu adalah aset marketing
ber-follower; kehilangannya jauh lebih mahal daripada kehilangan satu nomor.
Risikonya tidak sebanding.

Keputusan owner "tidak perlu link member" menghapus satu batasan yang
sebelumnya dikhawatirkan — panel konteks member cukup kosong untuk kanal ini.

## Modal yang Sudah Ada (dari EPIC-012)

Skema percakapan **sudah hampir netral kanal**: hanya `phone` yang khas
WhatsApp. Status, penugasan agent, unread, SLA respons, komplain berkategori,
catatan internal, CSAT, dan laporan **seluruhnya generik dan bisa dipakai
ulang** tanpa ditulis ulang.

## Fase

### Fase A — Google Review: baca & balas *(prioritas — nilai tertinggi, dependensi paling ringan)*
- Tabel `crm.google_reviews`: id ulasan, lokasi, nama & foto pengulas, rating
  1-5, teks, waktu, teks balasan, waktu balas, agent pembalas, status
  (`baru` | `dibalas` | `diabaikan`).
- Sinkronisasi berkala (pola `instrumentation.ts` seperti pengawas SLA):
  tarik ulasan baru, simpan idempoten berdasarkan id ulasan Google.
- Halaman `/dashboard/crm/reviews`: daftar ulasan (filter rating/status),
  balas langsung, template balasan (pakai ulang `wa_reply_templates`).
- **Ulasan ≤3 bintang otomatis ditandai komplain** dengan SLA waktu balas
  sendiri (`cs_sla_review_minutes`), muncul di ringkasan seperti chat.
- Kredensial OAuth disimpan di env; token refresh ditangani server.

### Fase B — Fondasi multi-kanal
- Tambah `channel` ('whatsapp' | 'instagram') pada percakapan & pesan;
  kunci unik pindah dari `phone` ke `(channel, external_id)`.
- Inbox: penanda & filter kanal; ikon per kanal di daftar percakapan.
- Laporan CS dipecah per kanal (volume, respons, CSAT).
- Pengiriman: lapisan provider diperluas jadi sadar-kanal.

### Fase C — Instagram DM
- Webhook penerima pesan Meta (verifikasi signature `X-Hub-Signature-256`).
- Pengirim balasan via Graph API; hormati jendela 24 jam + penandaan agen
  manusia (7 hari) — tampilkan sisa waktu balas di UI agar agent sadar.
- Konteks member sengaja kosong untuk kanal ini (keputusan owner).

## Acceptance Criteria

- Ulasan Google baru muncul di dashboard tanpa intervensi manual.
- Balasan yang dikirim dari dashboard **benar-benar tampil di Google** dan
  tercatat siapa agent yang membalas.
- Ulasan bintang rendah masuk hitungan komplain & SLA.
- DM Instagram masuk ke inbox yang sama dan bisa dibalas dari dashboard.
- Laporan CS memisahkan angka per kanal.
- Tidak ada scraping; seluruh integrasi lewat API resmi.

## Risiko & Catatan

- **Dependensi eksternal adalah jalur kritis**, bukan kodenya. Google
  (pengajuan akses API) dan Meta (App Review) sebaiknya diajukan lebih dulu,
  paralel, sebelum implementasi dimulai.
- Balasan ulasan Google bersifat **satu balasan per ulasan** — mengirim ulang
  berarti mengganti balasan sebelumnya, bukan menambah. UI harus jelas soal
  ini agar agent tidak mengira sedang berbalas-balasan.
- Balasan publik = wajah bisnis. Pertimbangkan alur persetujuan supervisor
  untuk balasan pada ulasan bintang rendah.

## Automation Log

- 2026-07-20 — Epic dibuat atas permintaan owner (IG DM tanpa perlu tautan
  member + Google Review termasuk membalas). Temuan utama: **Google Review
  tidak butuh scraping** — API resmi mendukung baca dan balas, sehingga
  scraping ditolak karena melanggar ToS, rapuh, dan justru tidak bisa
  membalas. Instagram hanya punya jalur resmi; pustaka tidak resmi ditolak
  karena mempertaruhkan akun marketing ber-follower. Status backlog —
  menunggu keputusan owner soal urutan & pengajuan akses.
- 2026-07-20 — **Fase A SELESAI (siap-kredensial).** Owner memilih mulai dari
  Google Review. Seluruh bagian yang tidak bergantung persetujuan Google sudah
  dibangun & diverifikasi; begitu akses turun tinggal mengisi env.
  - Migrasi `20260720090000_google_reviews_fase_a.sql` + menu
    `20260720100000_google_reviews_menu.sql` (applied). Tabel
    `crm.google_reviews` berdiri sendiri — ulasan BUKAN percakapan (satu
    ulasan hanya boleh punya satu balasan), jadi tidak dipaksa masuk
    `wa_conversations`. Menu CRM → Google Review (super_admin/admin/
    pos_supervisor) **sekaligus didaftarkan ke daftar putih seeder** agar
    tidak tersapu seperti insiden 16 menu.
  - Aturan murni `google-reviews.ts` + 17 unit test: pemetaan enum rating
    Google (ONE..FIVE), normalisasi resource (ulasan anonim, rating tanpa
    teks, balasan existing), penandaan komplain, SLA balas, validasi balasan.
  - Klien `google-business-client.ts`: tukar refresh token → access token
    (di-cache sampai mendekati kedaluwarsa), tarik ulasan berhalaman (batas
    aman 5 halaman), kirim balasan via `PUT .../reply`. Tanpa kredensial
    seluruh fungsi mengembalikan status "belum dikonfigurasi" secara rapi.
  - `google-reviews-server.ts`: upsert idempoten berdasarkan `review_name`
    (ulasan yang diedit pengulas ikut diperbarui, status `diabaikan` tidak
    tertimpa, balasan dari aplikasi Google ikut terbaca). **Urutan balas
    disengaja: kirim ke Google DULU, catat di DB setelah diterima** — supaya
    dashboard tidak pernah menampilkan balasan yang gagal terkirim.
  - Sinkronisasi tiap 15 menit via `instrumentation.ts` (interval lebih
    longgar dari SLA chat karena ulasan tidak deras & kuota API terbatas);
    peringatan "belum dikonfigurasi" hanya sekali per proses, bukan tiap tik.
  - UI `/dashboard/crm/reviews`: ringkasan (total, belum dibalas, komplain
    terbuka, rata-rata rating), filter status & rating, kartu ulasan dengan
    bintang, badge komplain/lewat SLA, tombol Balas/Ubah balasan/Abaikan, dan
    **penegasan bahwa satu ulasan hanya punya satu balasan**.
  - **Verifikasi live**: halaman 200; tanpa kredensial → banner peringatan,
    sync menjawab 409 "belum dikonfigurasi" (bukan crash); dengan 4 ulasan
    contoh → komplain otomatis untuk 1-2★, SLA tepat (ulasan 3 hari melanggar,
    yang pas 24 jam belum), filter rating jalan, aksi Abaikan jalan; **balas
    tanpa kredensial ditolak dan TIDAK meninggalkan catatan balasan di DB**.
  - Gate: 592 unit test hijau (+17), build sukses, migrasi applied, restart.
  - Runbook `docs/crm/RUNBOOK-GOOGLE-REVIEW.md` — termasuk alasan menolak
    scraping, langkah pengajuan akses Google, dan SQL pembersih data contoh.
  - Sisa: kredensial Google (jalur kritis, ajukan lebih awal); Fase B fondasi
    multi-kanal; Fase C Instagram DM. Batas Fase A: belum ada persetujuan
    supervisor untuk balasan bintang rendah, metrik ulasan belum masuk
    laporan CS, dan baru mendukung satu lokasi.
- 2026-07-20 — **Kunci ulasan dibuat tahan ganti akun Google** (pertanyaan
  owner: boleh pakai akun yang ada dulu lalu diganti?). Jawaban: boleh —
  penggantian hanya mengubah 5 env, tanpa kode/migrasi. TAPI pemeriksaan
  menemukan cacat desain Fase A: ulasan dikunci pada `review_name`
  (`accounts/{A}/locations/{L}/reviews/{R}`) yang **memuat id akun**, sehingga
  ganti akun akan memasukkan ulasan yang sama sebagai baris baru — daftar
  tampak dobel dan riwayat balasan terputus.
  Fix (migrasi `20260720110000_google_reviews_stable_key.sql`, applied):
  kolom `review_id` (segmen terakhir, stabil lintas akun) jadi kunci unik &
  target ON CONFLICT; `review_name` tetap disimpan untuk memanggil API balasan
  dan **disegarkan tiap sinkronisasi** agar balasan tetap terkirim ke path
  yang benar setelah akun berganti. Backfill + dedup baris lama sudah jalan.
  4 unit test baru (id sama walau akun/lokasi berbeda). Gate: 596 test hijau,
  build sukses, halaman tetap normal.
  Catatan untuk owner: akun yang dipakai WAJIB punya akses pengelola pada
  Business Profile lokasi Sulu — akun pribadi tanpa akses tidak bisa menarik
  ulasan sama sekali, jadi bukan sekadar "sementara pakai apa saja".
- 2026-07-20 — **Kredensial Google bisa diisi dari halaman, bukan `.env`**
  (pertanyaan owner: "masukannya di halaman mana?"). Sebelumnya hanya lewat
  file di server — butuh akses terminal, tidak sejalan dengan pola halaman
  pairing WhatsApp Gateway.
  - Pola diambil dari `Settings → Integrasi` yang sudah ada: rahasia disimpan
    server-side, browser hanya menerima penanda "tersimpan" + versi tersamar
    (`maskSecret`). 5 kunci baru di `app-settings`.
  - `GET/PUT/DELETE /api/settings/google-business` (super_admin only).
    **Rahasia tidak pernah dikirim balik**; kolom rahasia yang dikosongkan
    berarti "biarkan nilai lama" — supaya mengubah Location ID tidak
    menghapus refresh token. Account/Location menerima angka saja (awalan
    `accounts/`/`locations/` ditambahkan otomatis). Mengganti kredensial
    otomatis membuang cache access token.
  - `readGoogleBusinessConfig()` kini async: baca dari pengaturan dulu, env
    jadi cadangan (nilai UI menang) — deployment lama tetap jalan.
  - UI `GoogleConnectPanel` di halaman Google Review; banner "belum
    terhubung" kini punya tombol **Hubungkan Sekarang**.
  - **Verifikasi live**: simpan kredensial uji → status berubah
    `configured: true` dan sync **benar-benar memanggil Google** (gagal di
    autentikasi Google, bukan lagi "belum dikonfigurasi") = bukti kredensial
    dari UI yang dipakai; rahasia kembali dalam bentuk tersamar saja; simpan
    ulang tanpa mengisi rahasia **tidak menghapusnya**; Putuskan
    mengosongkan semua; tanpa login 401. Kredensial uji sudah dihapus.
  - Gate: 596 test hijau, build sukses.
- 2026-07-20 — **Fase B SELESAI: fondasi multi-kanal.** Owner akan menguji
  Instagram dengan akun testing, jadi fondasinya dikerjakan lebih dulu.
  Migrasi `20260720130000_wa_cs_fase_b_multichannel.sql` (applied):
  - Identitas percakapan pindah dari `phone` ke pasangan
    **(channel, external_id)** — WhatsApp memakai digit nomor, Instagram akan
    memakai IGSID. `phone` jadi nullable (IG tidak punya nomor), plus kolom
    `display_name` untuk nama dari kanal saat percakapan tidak tertaut member.
  - `wa_messages` ikut membawa `channel` + `external_id`.
  - Backfill: seluruh baris lama otomatis jadi `whatsapp` dengan
    `external_id = phone` — tidak ada data yang perlu disentuh manual.
  - **Utang penamaan diterima sadar**: tabel tetap bernama `wa_*` walau kini
    multi-kanal; mengganti nama menyentuh belasan berkas teruji tanpa manfaat
    fungsional. Dicatat di komentar migrasi.
  - `store.ts` sadar-kanal; auto-link member hanya untuk kanal bernomor —
    Instagram sengaja tidak ditautkan (keputusan owner) dan panel konteks
    member tampil kosong.
  - **Balasan dijaga per kanal**: membalas percakapan non-WhatsApp ditolak
    409 dengan pesan jelas, bukan diam-diam terkirim lewat WhatsApp. Aksi
    non-kirim (komplain, catatan, status) tetap berjalan untuk semua kanal.
  - UI inbox: filter kanal, ikon pembeda (WA hijau / IG pink — `Instagram`
    sudah dicabut dari lucide-react, dipakai `Camera` + warna brand), badge
    jumlah IG di header, judul percakapan memakai nama tampilan kanal bila
    bukan member, dan pencarian kini mencakup `display_name`/`external_id`.
  - Laporan CS dapat panel **Per Kanal** (percakapan, komplain, selesai,
    respons pertama, CSAT); judulnya tidak lagi khusus WhatsApp.
  - **Verifikasi live**: percakapan WA baru tetap masuk normal setelah
    perubahan skema; percakapan Instagram simulasi hidup berdampingan —
    tampil di inbox gabungan, terfilter benar (`channel=instagram`),
    ditemukan lewat pencarian username, panel member kosong, balasan ditolak
    dengan pesan yang benar, penandaan komplain tetap bisa, dan laporan
    memecah angka jadi whatsapp 3 / instagram 1. Data uji dibersihkan.
  - Gate: 596 test hijau, build sukses, migrasi applied.
  - Sisa Fase C: webhook penerima Meta + pengirim Graph API. Catatan: untuk
    UJI dengan akun testing, aplikasi Meta dalam mode development umumnya
    bisa berkirim pesan dengan akun yang punya peran di app tersebut tanpa
    App Review penuh — App Review baru wajib untuk penggunaan publik.
    Perlu dipastikan saat implementasi.
