# Task: Suggest update HPP produk dari resep

## Goal
Tampilkan HPP tersimpan vs HPP resep (BOM × avg cost bahan). User pilih update atau tetap. Tidak auto-timpa.

## Plan
- [x] Helper `buildProductHppReview` (threshold Rp 1, hanya produk ber-BOM + HPP resep > 0)
- [x] Enrich GET list/detail produk dengan field review
- [x] Filter list `hpp_review=true`
- [x] POST apply: set `harga_modal` = HPP resep; sync POS bila FINISHED_GOOD
- [x] UI detail: bandingkan + ConfirmDialog update
- [x] UI list: badge, filter, aksi update cepat

## Review
- List: kolom HPP tersimpan / HPP resep, badge "Perlu update", filter, tombol refresh
- Detail: bandingkan + CTA Update HPP / Tetap
- Apply: `harga_modal` = HPP resep; FINISHED_GOOD sync POS `cost_price`
- Trading tanpa BOM tidak masuk review
