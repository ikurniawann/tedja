# Task: Sync master harga_beli dari last GRN purchase price

## Goal
Saat stok bahan baku masuk dari GRN, update `raw_materials.harga_beli` ke **harga beli terakhir** (bukan avg). Avg stok tetap weighted average di `inventory.unit_cost`.

## Rules
- `harga_beli` master = per satuan besar
- Cost di inventory/movement GRN = per satuan dasar → konversi: `harga_beli = baseUnitCost × bigUnitFactor`
- Skip jika cost ≤ 0
- Hook di `addInventoryFromGrn` (semua jalur QC/GRN lewat sini)
- Bonus: movement line simpan **harga transaksi** (bukan avg) agar riwayat harga akurat

## Plan
- [x] Helper `masterHargaBeliFromBaseUnitCost` + `updateRawMaterialLastPurchasePrice`
- [x] Panggil dari `addInventoryFromGrn`
- [x] Unit test helper konversi (3 passed)
- [x] Movement GRN simpan harga transaksi (bukan avg)

## Review
- Setelah stok GRN post: `harga_beli` master = last purchase (per satuan besar)
- `inventory.unit_cost` tetap weighted average
- Riwayat harga memakai `unit_cost` movement = harga transaksi PO
