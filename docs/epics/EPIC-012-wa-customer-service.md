# EPIC-012: WhatsApp Customer Service — Riwayat Pesan, Inbox 2-Arah & Penanganan Komplain

status: ready-for-qa
environment: dev
retries: 0

## Goal

Menjadikan nomor WhatsApp bisnis (+6285880974659, gateway mandiri
`services/wa-gateway`) sebagai kanal customer service yang utuh: setiap pesan
keluar **tercatat dan terlihat di dashboard** (siapa penerimanya, statusnya),
customer bisa **chat dua arah** dengan agent dari dashboard, dan komplain
ditangani dengan alur yang terukur (kategori, SLA respons, catatan internal,
laporan). Ini adalah realisasi epic "Omnichannel CRM ala Qontak" yang
direncanakan setelah EPIC-011, dimulai dari kanal WhatsApp.

## Konteks & Modal yang Sudah Ada

- **Gateway mandiri sudah live** (19 Jul 2026): Baileys, proses PM2 terpisah,
  sesi persisten, kirim serial berjeda. Berbeda dari rencana lama berbasis
  Fonnte, **Baileys menerima pesan masuk secara native** (event
  `messages.upsert`) — tidak butuh webhook pihak ketiga. Inbox 2-arah jadi
  jauh lebih sederhana dari perkiraan awal.
- **Lapisan provider** `src/lib/whatsapp/` — semua kirim WA lewat satu pintu;
  titik pasang pencatatan outbox tinggal satu tempat.
- Identitas member global (`pos_customers` + nomor HP terverifikasi OTP dari
  portal) = kunci auto-link chat → profil member.
- Pola dispatcher periodik `instrumentation.ts` (EPIC-010) untuk SLA reminder;
  pola halaman Settings + guard role (EPIC-011 Fase F) untuk UI-nya.

## Keputusan Arsitektur (dibawa dari analisa omnichannel 19 Jul)

1. Tanpa microservice baru — inbox/outbox hidup di app; gateway hanya
   meneruskan event masuk ke app lewat HTTP lokal ber-token (arah sebaliknya
   dari `/send` yang sudah ada).
2. `sendWhatsApp*` tidak pernah dipanggil inline di jalur transaksi POS;
   pesan otomatis lewat outbox + dispatcher.
3. Isi pesan = PII. Body OTP **tidak pernah disimpan** (cukup jenis+status);
   akses UI dibatasi role; retensi bisa diatur.

## Fase

### Fase A — Riwayat pesan keluar (jawaban "pesan dikirim ke siapa saja")
- Tabel `crm.wa_messages`: direction `out`, nomor tujuan, link `customer_id`
  (bila nomor dikenal), jenis (`otp`|`notification`|`chat`|`broadcast`),
  body (NULL untuk OTP), status `queued|sent|failed`, `message_id`, provider,
  alasan gagal, `sent_by_user_id`, timestamp.
- Pencatatan dipasang di lapisan provider (`sendWhatsAppOtp`/`sendWhatsAppText`)
  — semua pengirim otomatis tercatat tanpa mengubah pemanggil.
- UI: tab **Riwayat Pesan** di Settings → WhatsApp Gateway — filter
  status/jenis/tanggal, cari nomor/nama, tombol kirim ulang untuk yang gagal.
- Guard: `super_admin` (+ `admin` untuk baca — diputuskan di UAT).

### Fase B — Pesan masuk & model percakapan (fondasi chat)
- Gateway: handler `messages.upsert` → POST `http://127.0.0.1:3459/api/wa/inbound`
  ber-token bersama (arah balik dari token yang sudah ada). Retry ringan bila
  app sedang restart (antrean memori + ulang 3x).
- Tabel `crm.wa_conversations`: nomor, `customer_id` (auto-link via phone),
  status `open|in_progress|waiting_customer|resolved`, `assigned_user_id`,
  `last_message_at`, unread counter. Pesan masuk → `crm.wa_messages`
  (direction `in`) terikat conversation; pesan keluar jenis `chat` juga.
- Pesan dari perangkat lain (HP admin membalas manual) ikut tertangkap
  (event `fromMe`) supaya riwayat percakapan tidak bolong.
- Teks dulu; media (gambar) masuk sebagai penanda "[media]" — unduhan media
  menyusul fase berikutnya.

### Fase C — UI Inbox CS di dashboard
- `/dashboard/crm/inbox`: daftar percakapan (badge unread, filter status/
  assigned), panel chat, dan **panel konteks member** di samping chat — profil,
  tier, XP, riwayat order & redemption. Ini pembeda utama vs tool generik:
  agent langsung tahu siapa yang komplain dan riwayat belanjanya.
- Balas dari dashboard → lewat gateway → tercatat sebagai `chat/out`.
- Ambil-alih percakapan (assign ke saya), tandai selesai.
- Template balasan cepat (canned responses) yang bisa dikelola admin.
- Refresh polling 5 dtk dulu (pola yang sudah dipakai halaman gateway);
  SSE/socket kalau terasa kurang.
- Badge jumlah unread di menu sidebar CRM.
- Usulan role: `super_admin`, `admin`, `pos_supervisor` (CS venue) — final di
  UAT Fase C.

### Fase D — Penanganan komplain yang terukur
- Percakapan bisa dijadikan **komplain**: kategori (produk/layanan/pembayaran/
  lainnya), prioritas, catatan internal antar-agent (tidak terkirim ke
  customer), riwayat perubahan status.
- **SLA**: target waktu respons pertama & waktu penyelesaian (configurable di
  crm_settings). Dispatcher `instrumentation.ts` menandai yang lewat SLA +
  eskalasi (notifikasi ke supervisor).
- Auto-reply di luar jam operasional (teks & jam configurable), sekali per
  percakapan per hari agar tidak spam.
- Penutupan: konfirmasi ke customer + permintaan rating 1–5 via balasan WA
  (CSAT sederhana, opsional dibalas).

### Fase E — Laporan CS
- Volume chat & komplain per hari/venue, rata-rata waktu respons pertama,
  rata-rata waktu penyelesaian, komplain per kategori, CSAT — halaman baru di
  bawah `/dashboard/crm/reports` (extend laporan Fase E EPIC-011).

## Di Luar Scope (sesuai keputusan lama)

- Channel Instagram/marketplace, Click-to-WhatsApp Ads, status BSP Meta.
- Broadcast/campaign massal — fondasinya (outbox) dibangun di sini, tapi
  broadcast jadi lanjutan setelah CS stabil (risiko blokir nomor lebih tinggi;
  perlu pacing & opt-out matang).
- Chatbot AI (infra `ai_assistant_*` ada) — menyusul setelah alur manusia rapi.

## Acceptance Criteria

- Setiap pengiriman WA dari sistem (OTP, notifikasi, chat) muncul di Riwayat
  Pesan berikut penerima & statusnya; body OTP tidak pernah tersimpan.
- Pesan WhatsApp masuk dari customer muncul di inbox dashboard ≤10 detik,
  otomatis tertaut ke member bila nomornya dikenal.
- Agent membalas dari dashboard dan pesan sampai ke WhatsApp customer;
  percakapan yang sama tidak bisa dikerjakan dua agent tanpa terlihat.
- Balasan manual dari HP nomor bisnis tetap tercatat di riwayat percakapan.
- Komplain melewati siklus open → in_progress → resolved dengan kategori,
  catatan internal, dan stempel waktu; pelanggaran SLA respons pertama
  terlihat/tereskalasi.
- Role di luar daftar CS tidak bisa membuka inbox maupun riwayat pesan.

## Risiko & Mitigasi

- **Satu nomor untuk OTP + CS**: volume chat menaikkan aktivitas nomor;
  pacing gateway dipertahankan, broadcast ditunda. Bila nomor kena blokir,
  OTP ikut mati — pertimbangkan nomor kedua khusus CS bila volume membesar.
- **HP nomor bisnis tetap menerima chat**: agent bisa tergoda membalas dari
  HP. Event `fromMe` menjaga riwayat tetap utuh, tapi SOP-nya balasan resmi
  lewat dashboard.
- **Gateway putus** = inbox berhenti diam-diam → prasyarat Fase B: penanda
  status gateway di UI inbox (sudah ada datanya via `/health`).

## Automation Log

- 2026-07-19 — Epic dibuat atas permintaan owner (riwayat penerima pesan di
  web UI + fitur chat untuk komplain customer). Disusun menyatukan rencana
  omnichannel 19 Jul (memory `omnichannel-crm-plan`) dengan kenyataan baru:
  provider = gateway mandiri Baileys (bukan Fonnte), sehingga inbox tidak
  butuh webhook pihak ketiga. Status backlog — menunggu persetujuan owner
  atas fase & usulan role CS untuk mulai Fase A.
- 2026-07-19 — **Fase A+B SELESAI (coding + verifikasi live).** Migrasi
  `20260720040000_wa_cs_fase_ab.sql` (applied ke dev): `crm.wa_conversations`
  (phone unique, auto-link customer, status open/in_progress/waiting_customer/
  resolved, unread_count, preview) + `crm.wa_messages` (in/out, jenis
  otp|notification|chat|broadcast|system, constraint `wa_messages_otp_no_body`
  menjaga body OTP selalu NULL di level DB, index unik parsial
  `provider_message_id` untuk dedup echo).
  - **Fase A**: pencatatan dipasang di lapisan provider (`sendWhatsAppOtp`/
    `sendWhatsAppText` + param meta jenis/pengirim) — semua jalur kirim
    otomatis tercatat. UI tab **Riwayat Pesan** di Settings → WhatsApp
    Gateway (super_admin): summary keluar/masuk/gagal, filter arah+jenis+
    status+cari nomor/nama member, kirim ulang untuk yang gagal (OTP
    dikecualikan — kode basi; member diminta request ulang).
  - **Fase B**: gateway memasang handler `messages.upsert` (hanya `notify`,
    hanya JID personal, ekstrak teks/caption + jenis media, bungkus
    ephemeral/viewOnce dibuka) → antrean memori + retry 2s/10s/30s → POST
    `/api/wa/inbound` (public-route di middleware, auth = token bersama
    `WA_GATEWAY_TOKEN` dua arah). `recordGatewayMessage` transaksional:
    upsert percakapan per nomor, auto-link `pos_customers` via digit phone,
    unread++ hanya utk pesan masuk, percakapan `resolved` otomatis re-open,
    pesan `fromMe` dari HP tercatat berlabel "dari HP".
  - Normalisasi payload = fungsi murni `src/lib/whatsapp/inbound.ts` dengan
    11 unit test (grup/status ditolak, suffix device JID, media tanpa teks,
    reaksi diabaikan, body dipotong 4000).
  - **Verifikasi live dev**: inbound tanpa token 401; simulasi pesan masuk →
    stored, percakapan terbentuk & tertaut member Budi, unread 1, preview
    benar; kirim payload sama 2x → skipped (idempoten); OTP nyata ke nomor
    sender → `wa_delivered:true`, baris `otp/out` dengan **body NULL**, echo
    `fromMe` dari gateway ter-dedup (tetap 1 baris); API riwayat sebagai
    super_admin menampilkan semua + filter cari nama member jalan.
  - **BUG DITEMUKAN & FIX saat verifikasi**: pola `Number(params.get("limit"))`
    menghasilkan 0 utk param absen (Number(null)=0) → `Math.max(1,0)` =
    LIMIT 1 — daftar hanya menampilkan 1 baris. Diperbaiki di
    `wa-gateway/messages` DAN `crm/redemptions` (bug yang sama tertanam saat
    hardening Fase F). Pelajaran: `Number(null)` adalah 0, bukan NaN.
  - Gate: 559 unit test hijau (+11), build sukses, kedua proses PM2
    di-restart, sesi gateway bertahan tanpa pairing ulang.
  - Sisa: review gate (security+kualitas) atas diff Fase A+B; UAT owner —
    kirim WA sungguhan ke +6285880974659 dari HP lain lalu lihat tab
    Riwayat Pesan; Fase C (UI inbox chat) menyusul setelah A+B disetujui.
- 2026-07-19 — **Review gate Fase A+B selesai — 2 HIGH + 3 MEDIUM ditutup
  (`48d18b9`).** Temuan kunci reviewer: `/api/wa/inbound` terjangkau internet
  via cloudflared, bukan lokal-saja. Fix: batas body/batch + backoff token
  gagal (H1), index ekspresi digit nomor `idx_pos_customers_phone_digits`
  (H2 — lookup per pesan tadinya seq scan), forwarder gateway kini backoff
  menetap 60 dtk tanpa menyerah + fetch timeout + single-flight + antrean
  maks 2000 (M1 — jendela deploy tidak menghilangkan pesan), resend menandai
  baris asal agar tidak bisa spam berulang + scoped direction out (M2/L3),
  perbandingan token constant-time dua sisi (M3). Diterima sebagai catatan:
  OTP yang DIKETIK customer di chat tersimpan sebagai teks chat biasa (akses
  super_admin; OTP outbound tetap tidak pernah disimpan). Reviewer
  mengonfirmasi benar: no-body OTP 3 lapis, ON CONFLICT partial index,
  upsert race-safe, parameterized query, fail-closed token kosong.
- 2026-07-19 — **Fase C SELESAI: UI Inbox CS.** Migrasi
  `20260720050000_wa_cs_fase_c.sql` (applied): tabel `crm.wa_reply_templates`
  (+3 seed) + menu sidebar CRM → Members → **Inbox WhatsApp**
  (`/dashboard/crm/inbox`, grant super_admin/admin/pos_supervisor — kasir
  `pos` sengaja tidak, isi chat = PII paling sensitif; guard baru
  `requireCrmInboxAgent`/`CRM_INBOX_ROLES`).
  - API: `GET /api/crm/inbox/conversations` (filter status/assigned/cari +
    total unread), `GET/POST /api/crm/inbox/conversations/[id]` (detail =
    pesan + konteks member: tier/XP/saldo/5 order/5 redemption; aksi
    discriminated union: reply/assign_me/unassign/set_status/mark_read),
    `GET/POST/DELETE /api/crm/inbox/templates` (kelola = super_admin).
  - Balasan dashboard → `sendWhatsAppText` meta chat+conversationId →
    tercatat otomatis (Fase A) → percakapan auto `in_progress` + auto-assign
    ke pembalas bila belum ada yang menangani.
  - UI 3 kolom: daftar percakapan (badge unread, waktu relatif, filter),
    thread chat (bubble in/out, penanda "dari HP", template balasan cepat,
    Enter kirim), panel konteks member. Responsif: mobile 1 kolom
    bertingkat. Polling 5 dtk + banner peringatan bila gateway putus
    (prasyarat risiko di epic). Badge unread sidebar DITUNDA (perlu sentuh
    AppSidebar generik — masuk Fase D bila masih diinginkan).
  - **Verifikasi live**: simulasi chat masuk → tampil di daftar dgn total
    unread; balas dari API dashboard → WhatsApp SUNGGUHAN terkirim
    (messageId `3EB0B87ECD5F816E01B3B6`, diterima di HP owner), status auto
    in_progress + ditangani "Super Admin", echo ter-dedup (tetap 2 pesan);
    resolve sukses; template ter-load; tanpa sesi ditolak 401. Percakapan
    uji-diri dibersihkan; percakapan komplain Budi disisakan sbg demo UAT.
  - Gate: 559 test hijau, build sukses (4 route baru terdaftar), migrasi
    applied, kedua proses restart, sesi gateway bertahan.
  - UAT owner: (1) kirim WA dari HP pribadi ke +6285880974659 → muncul di
    `/dashboard/crm/inbox` ≤10 dtk; (2) balas dari dashboard → sampai di HP;
    (3) klik Tangani/Status → Selesai; (4) kirim lagi dari HP → percakapan
    re-open otomatis; (5) tab Riwayat Pesan mencatat semua. Fase D (komplain
    berkategori + SLA) menunggu keputusan lanjut.
