# EPIC-013: Omnichannel — Google Review & Instagram DM

status: backlog
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
