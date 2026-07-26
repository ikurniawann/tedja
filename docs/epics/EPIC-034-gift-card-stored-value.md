# EPIC-034: Gift Card / Stored Value — Saldo Prepaid Lintas Kanal

status: backlog
environment: local
retries: 0

## Goal

Menutup gap benchmark #8 (lihat
[`BENCHMARK-ticketing-vs-accesso.md`](./BENCHMARK-ticketing-vs-accesso.md)):
**gift card ber-saldo** — dibeli sekali (kasir/online), berisi nominal,
dipakai membayar berkali-kali sampai saldonya habis (partial redeem).
Berbeda dari voucher EPIC-032 (potongan sekali pakai): gift card adalah
UANG TITIPAN — liability yang diakui jadi revenue saat dipakai.

## Fondasi yang sudah ada (audit 2026-07-26)

1. **Pola kode unik bearer + CSPRNG** — `generateVoucherCode` EPIC-032
   (charset anti-ambigu); gift card = kode 10–12 char + PIN? (lihat OQ).
2. **Pola saldo + ledger append-only** — ARK Coin (`update_ark_coin_balance`
   RPC, debit atomik, guard insufficient) dan tab ticketing (ledger dua
   arah, `FOR UPDATE`, settlementPlan) — gift card mengikuti pola yang sama.
3. **Metode bayar kasir**: preseden `ark_coin` — "1 transaksi 1 metode",
   order pending → paid setelah debit sukses, kompensasi delete bila gagal.
   Gift card = metode bayar baru `gift_card` meniru alur ini persis.
4. **Jual online + kirim kode via WA**: pola pass/booking (Xendit invoice
   prefix baru + webhook branch + `sendXxxPaidWa`).
5. **Akuntansi titipan**: owner sudah menetapkan pola ini di EPIC-023
   (booking = titipan sampai redeem) — gift card identik: penjualan =
   liability, pemakaian = revenue.

## Usulan Arsitektur

Schema baru `giftcard` (tenancy penuh):

```
gift_cards      — code UNIQUE (bearer, CSPRNG), pin (opsional, hash),
                  initial_value, balance, status (pending|active|
                  disabled|exhausted|expired), expires_at NULL,
                  sumber jual (kasir order_id | xendit invoice), pembeli
                  (nama/WA utk kirim ulang), audit
gift_card_ledger — append-only: card_id, direction (isi|pakai|koreksi),
                  amount, context (pos_order|ticket_booking|manual),
                  context_id, saldo_setelah (snapshot), created_by
```

Kunci desain (mengikuti preseden yang terbukti):
- **Saldo = SUM ledger, kolom balance hanya cache** yang diverifikasi —
  atau balance + ledger dgn `FOR UPDATE` saat debit (pola tab). Pilih:
  `FOR UPDATE` + balance kolom + asersi vs SUM di smoke test.
- Debit atomik: `UPDATE ... SET balance = balance - $x WHERE id = $1 AND
  balance >= $x RETURNING` — gagal = saldo kurang (pola klaim-dulu).
- **Partial redeem**: dipakai sebagian → sisa tetap di kartu;
  `exhausted` saat 0.
- Kasir: metode bayar `gift_card` — MVP **menutup seluruh total atau
  ditolak**? TIDAK — justru nilai gift card adalah partial; MVP:
  gift card boleh menutup sebagian? Preseden "1 transaksi 1 metode"
  menyulitkan split cash+card → keputusan di OQ #3.

## Fase

| Fase | Scope (PR-sized) |
|---|---|
| **A** | Skema + lib murni (validasi kode/pin, matematika saldo, TDD) + terbit & kelola kartu di admin (menu Promo EPIC-032 diperluas: tab "Gift Card" — terbit manual/batch, lihat saldo & riwayat, disable) |
| **B** | Jual di kasir POS: produk khusus "Gift Card" (nominal preset/bebas) → kartu terbit `active` + struk berisi kode; uang masuk tercatat sebagai penjualan gift card (liability) |
| **C** | **Pakai di kasir POS**: metode bayar `gift_card` (input kode → tampil saldo → debit atomik ikut alur ark_coin: pending → paid, kompensasi bila gagal); void order → saldo kembali (ledger koreksi) |
| **D** | Jual & pakai ONLINE: beli gift card dari halaman publik (Xendit, kode dikirim WA — reuse pola pass) + redeem sebagai pembayaran booking online (mengurangi tagihan Xendit / menutup penuh) |
| **E** (lanjut) | Expiry + laporan liability (saldo mengendap per venue, breakage), top-up ulang kartu, kartu fisik NFC (reuse ticket_bands) |

Dependensi: A → B → C → D. B+C = MVP bermakna (jual & pakai di kasir).

## ⚠ Risiko

- **Jalur uang murni** — setiap fase B–D wajib review + smoke SQL + race
  test (dua kasir memakai kartu yang sama bersamaan → saldo tak boleh
  minus; pola advisory/FOR UPDATE EPIC-031/032).
- Bearer code = uang: kode wajib CSPRNG, tampil sekali di struk/WA,
  lookup di kasir TIDAK menampilkan kode lain (anti-enumerasi), audit
  siapa menerbitkan.
- Akuntansi: penjualan gift card TIDAK boleh dobel-hitung sebagai revenue
  saat dijual DAN saat dipakai — laporan POS perlu membedakan (fase E
  merapikan; MVP minimal tandai order penjualan gift card).

## Non-Goals

- Refund saldo ke uang tunai (kebijakan umum: tidak).
- Transfer saldo antar kartu.
- Integrasi ARK Coin (dua sistem saldo berbeda — jangan dilebur).

## Open Questions (jawab sebelum Fase A)

1. **Media MVP**: kode digital saja (struk + WA) — atau perlu kartu fisik
   NFC sejak awal? (usulan: digital dulu; NFC = fase E reuse ticket_bands.)
2. **PIN**: kode saja (bearer murni, mudah) atau kode + PIN 4 digit
   (lebih aman utk nominal besar)? (usulan: kode saja utk MVP, panjang
   12 char CSPRNG.)
3. **Pembayaran kasir**: gift card harus menutup SELURUH total (ikut
   preseden ark_coin, sederhana) — atau boleh sebagian & sisanya
   cash/QRIS (split 2 metode, menyentuh alur pembayaran lebih dalam)?
4. Nominal: preset (100rb/250rb/500rb) atau bebas? Expiry berapa lama
   (umum 12 bulan) atau tanpa expiry?
5. Penjualan gift card lewat produk POS biasa (muncul di laporan penjualan
   sbg item) atau menu terpisah di kasir? (berpengaruh ke akuntansi
   liability.)

## Automation Log

- 2026-07-26 — Epic dibuat dari gap benchmark #8 (keputusan owner: garap
  Tier 2). Audit fondasi: pola kode CSPRNG (EPIC-032), saldo atomik
  (ARK Coin), ledger dua-arah (tab EPIC-023), jual online + WA (pass
  EPIC-028), akuntansi titipan (EPIC-023). Status **backlog** — menunggu
  jawaban 5 open questions (paling menentukan: #3 full-cover vs split).
