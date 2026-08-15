# Task: Import SIW Menu Matrix → produk + stall

## Goal
Mapping `docs/SIW - Menu Matrix.xlsx` ke master produk + rename stall
ke nama sheet (kecuali **Operasional**). Apply ke local, dev, sulu-server.

## Plan
- [x] Parse Excel (Summary Menu = produk; sheet stall = nama warehouse)
- [x] Seeder `reset-items-from-menu-matrix.js` (tidak wipe order)
- [x] Rename stall existing → nama sheet; keep Operasional/WH-01
- [x] Hard-delete katalog lama + histori yang mengunci; upsert produk + POS
- [x] Apply local → dev → sulu-server
- [x] Update `STALL_SEEDS` supaya seeder user tidak revert nama

## Review
- 15 stall dari sheet + Operasional (WH-01) dipertahankan
- 84 produk aktif di item.products + pos.pos_products
- Order POS tidak dihapus (local 30, dev 41, sulu-server 1)
- Harga 0 = belum diisi di Summary Menu Excel

## Rules
- Skip sheet: Summary Menu, Market List, WIP FOOD, Operasional
- Skip baris `AVG Product Cost`
- Harga/COGS invalid → 0
- Preserve warehouse id (user assignment tetap)
