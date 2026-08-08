# Lessons

## HPP produk resep vs PO
- Tidak semua HPP lewat PO. Trading → `harga_modal`/GRN; resep → BOM × avg cost.
- Jangan auto-timpa HPP POS. Suggest: HPP saat ini vs HPP seharusnya, user pilih update.
- `hpp_estimasi` di `v_products_cogs` live; `harga_modal` snapshot yang di-accept user.



## i18n Product master + inventory pages
- Sidebar + page title harus bareng: Satuan/Kategori/Produk, Stok/Opname/Penyesuaian/Transfer.
- Satuan & Transfer Stok sudah id-ID; fokus sisa: products CRUD, kategori, stok produk, opname produk, adjustment produk.

## Product purchasing align RM
- Price list produk dipensiun (soft-delete IAM) seperti RM; PR/PO estimasi pakai `harga_modal`, bukan vendor-price-list.
- Label sidebar + page GRN/pengiriman produk: Penerimaan (GRN), Lacak Pengiriman. Invoice produk belum dipindah ke AP.

## i18n menu + page harus bareng
- Ganti label sidebar IAM saja tidak cukup; page title/toast/empty state di feature page sering masih English.
- Scope Approval + Produksi: hub, list, editor BOM, detail order, laporan terkait.

## Master harga_beli vs avg stok
- GRN post stok: update `raw_materials.harga_beli` = **last purchase** (konversi ke satuan besar); jangan set ke weighted avg.
- `inventory.unit_cost` = avg; movement GRN `unit_cost` = harga transaksi (bukan avg) supaya riwayat/harga terakhir akurat.
- Hook di `addInventoryFromGrn` agar semua jalur QC/inline GRN ikut.

## Menu Invoice RM → Account Payable
- Sidebar IAM: pindah ke `accounting.accounts-payable` (`/dashboard/accounting/accounts-payable`); soft-delete `items.raw-material.purchasing.invoice`.
- Update `iam-menus.sql` + whitelist soft-delete; `RM_ROUTES.purchasingInvoice` + redirect next.config ke path Accounting.
- Detail PO dari AP: deteksi `/accounts-payable/po/` selain `/invoice/po/`.

## Purchasing → Accounting journal mapping
- Hook setelah stok GRN / payment posted / return approved; jangan di PO create.
- Idempotensi: `(company_id, source_event_code, source_document_id)` — GRN memicu 2 event berbeda dengan `document_id` sama.
- Hybrid failure: mapping hilang/incomplete → skip/draft warning; mapping lengkap tapi fiscal/DB gagal → throw `AccountingPostError` (block request).
- Amount GRN = qty lolos QC × harga PO (+ PPN bila ada), bukan qty pintu ditolak.

## Kirim ulang setelah GRN partial
- `active_delivery_id` di detail PO harus = delivery **open** saja (`pending`/`shipped`/`in_transit`), bukan latest delivery.
- Setelah delivery `delivered` + GRN sisa, tombol harus **Kirim Ulang** → `/delivery/insert?po_id=...`, bukan "Lihat Pengiriman".
- Label "kirim ulang" tidak ada di menu terpisah — entry point = detail PO atau Lacak Pengiriman → Tambah Pengiriman.
- **Bug klasik:** `updateDeliveryStatusAfterGrn(partially_received)` jangan set `in_transit` — itu mengunci PO (tidak bisa delivery baru). Satu SJ = satu GRN; setelah GRN, delivery wajib `delivered` (atau `cancelled` jika ditolak total).
- GRN status `partially_received` ≠ “lanjutkan penerimaan di GRN yang sama”. UI “Lanjutkan Penerimaan” hanya untuk `pending` (belum QC). Sisa qty → **Kirim Ulang** + GRN baru.

## Sidebar labels vs items-nav
- Label sidebar IAM diambil dari tabel `iam.menus` (DB), bukan hanya dari `items-nav.ts`.
- Saat ganti bahasa/label menu yang terlihat di screenshot sidebar: update seeder + buat migration `UPDATE iam.menus SET menu_name=... WHERE code=...`.
- `items-nav.ts` / landing cards tetap perlu diselaraskan untuk konsistensi breadcrumb & hub Items.

## Satuan stok bahan baku
- `inventory.qty_available` / `unit_cost` adalah satuan dasar: satuan kecil bila material punya satuan kecil, selain itu satuan besar.
- Field di master (`harga_beli`, `stok_minimum`, `stok_maximum`) tetap per satuan besar. Jangan bandingkan langsung dengan qty inventory tanpa konversi.
- Semua jalur posting stok (GRN, impor, PO on-order) wajib lewat `resolveBaseUnitFactor` sebelum menulis ke inventory.
- Sebelum mengubah tampilan qty/harga, cek dulu jalur penulisan datanya; label UI di project ini sempat memakai satuan besar padahal datanya satuan kecil.

## i18n Purchasing
- Terjemahkan label bersama dulu (`PR_STATUS_LABELS`, `RETURN_*_LABELS`, `getPRStatusLabel`), baru hapus override lokal. Jangan biarkan halaman approval/list masih override Inggris.
- `CsvImporter` template header memakai `col.key`, bukan `col.label` — aman menerjemahkan `import-config` label tanpa merusak format file.
- Jangan terjemahkan free-text yang ditulis server ke DB tanpa memikirkan display lama: contoh deskripsi termin PO (`Paid in Full` / `Installment N`). Lebih aman localize saat render.
- Bahasa Indonesia tidak memakai plural `s`; hapus pola `${n === 1 ? "" : "s"}` saat menerjemahkan toast/dialog.
- Locale tanggal/angka UI id-ID: `toLocaleDateString("id-ID")`, `Intl.NumberFormat("id-ID")`.
