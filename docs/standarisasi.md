# Standarisasi Pengembangan — Talentpool / Arkiv OS

Dokumen ini adalah **acuan utama** saat membuat fitur baru, enhancement, atau refactor UI/API di modul Items (Raw Material & Product) dan Purchasing.

**Status:** Active  
**Terakhir diperbarui:** 2026-07-07

---

## Cara Pakai Dokumen Ini

1. Baca bagian yang relevan **sebelum** mulai coding.
2. Gunakan **halaman referensi** di bawah sebagai template visual & struktural.
3. Saat standarisasi atau enhancement modul, **selalu cek seluruh flow halaman** — bukan hanya list (lihat [§3.0](#30-cakupan-standarisasi-per-modul)).
4. Centang **checklist** di akhir sebelum PR / handover.
5. Detail form field & ukuran komponen: lihat juga [`docs/purchasing/PROJECT_STANDARDS.md`](./purchasing/PROJECT_STANDARDS.md).

Aturan Cursor yang selalu aktif: [`.cursor/rules/ui-interaction-standards.mdc`](../.cursor/rules/ui-interaction-standards.mdc)

---

## 1. Git & Branch Workflow

Sebelum mulai pengerjaan:

```bash
git checkout development
git pull origin development
git checkout -b feature/<deskripsi-singkat>
# atau
git checkout -b fix/<deskripsi-singkat>
```

| Konteks | Prefix branch | Contoh |
|--------|----------------|--------|
| Fitur baru / improvement | `feature/` | `feature/tambah-kolom-grn-list` |
| Perbaikan bug | `fix/` | `fix/delivery-po-dropdown` |

**Jangan** commit langsung ke `development` atau `main`.  
**Jangan** membuat branch dari branch lain (selain `development`).

---

## 2. Arsitektur & Struktur Folder

### 2.1 Pola feature module

```
src/features/purchasing/<modul>/
  api.ts              # fetch ke /api/purchasing/*
  queries.ts          # useQuery hooks
  mutations.ts        # useMutation hooks
  query-keys.ts       # react-query keys
  types.ts            # tipe khusus modul (opsional)
  index.ts            # export public
  components/
    *-list-page.tsx
    *-detail-page.tsx
    new-*-page.tsx
    edit-*-page.tsx

src/app/dashboard/(dashboard)/purchasing/<modul>/page.tsx   # thin route → import feature
src/app/api/purchasing/<modul>/route.ts                     # REST API
```

**Prinsip:**

- Route Next.js tipis — logika UI di `src/features/`.
- API route: validasi input (Zod), scope bisnis, toast-friendly error message.
- Client: React Query (`queries` / `mutations`), bukan fetch manual di banyak tempat.

### 2.2 Backend (API)

```
Controller (route.ts) → Service/lib → DB (createServerPgClient)
```

- Gunakan `getApiUserScope()`, `companyScopeOr`, `branchScopeOr`, `isRowInBusinessScope` / `isOperationalRowInBusinessScope` untuk data operasional.
- Response konsisten: `{ success, data, pagination?, message? }`.
- Pesan error API untuk user-facing module purchasing: **English**.

### 2.3 Hierarki bisnis & Stall

Struktur data operasional mengikuti hierarki:

```
Holding → Company → Branch → Stall (configuration.warehouses)
```

| Level | Tabel DB | Label UI | Catatan |
|-------|----------|----------|---------|
| Holding | `configuration.holdings` | Holding | Scope user holding-level |
| Company | `configuration.companies` | Company | Scope user company-level |
| Branch | `configuration.branches` | Branch | Scope user branch-level |
| Stall | `configuration.warehouses` | **Stall** | Lokasi operasional per branch |

**Konvensi label UI:**

- Di database & API internal: gunakan `warehouse` / `warehouse_id`.
- Di UI user-facing: gunakan label **Stall** via `STALL_LABELS` dari `@/lib/configuration/stall-labels`.
- Jangan tampilkan "Warehouse" / "Gudang" di UI purchasing atau master item kecuali konteks teknis.

**Product master:**

- Setiap product **wajib** punya `warehouse_id` (stall) selain `company_id` + `branch_id`.
- Unique kode product per `(company, branch, warehouse_id, kode)`.
- Export/import spreadsheet wajib kolom `stall_code`.

**User / karyawan dengan akses app:**

- Scope **branch** wajib assign minimal **1 stall** (`configuration.user_warehouses`).
- Stall yang dipilih harus berada di branch yang sama dengan scope user.
- Tampilkan stall aktif di list `/dashboard/employees` (kolom **Stall**) dan form akses app.
- Super Admin / scope holding atau company tidak wajib stall assignment.

**Inventory & stock:**

- Stock, stock opname, dan adjustment product difilter per stall (`warehouse_id`).
- Stock opname create wajib pilih stall; preview scoped ke stall tersebut.

### 2.4 Routing & URL

**Selalu** gunakan konstanta route — jangan hardcode path dashboard.

```ts
import { RM_ROUTES, PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
```

| Namespace | Base | Dipakai untuk |
|-----------|------|----------------|
| Raw Material | `RM_ROUTES` | `/dashboard/raw-material/*` |
| Product | `PRODUCT_ROUTES` | `/dashboard/product/*` |

Legacy path `/dashboard/purchasing/*` di-rewrite ke raw-material via `next.config.ts`. Untuk link baru, pakai `RM_ROUTES`.

### 2.5 Navigasi dari Approval

Saat buka detail dari list approval, pertahankan menu aktif:

```ts
import { purchaseRequestDetailFromApproval, NAV_FROM_APPROVAL_PR } from "@/lib/iam/nav-context";
// atau PO: purchaseOrderDetailFromApproval, NAV_FROM_APPROVAL_PO
```

Detail page: tombol Back mengarah ke list approval jika `?from=approval-pr` / `approval-po`.

---

## 3. Standar UI — Halaman List

### 3.0 Cakupan standarisasi per modul

Saat memperbarui atau membuat modul baru, **jangan hanya** menyelaraskan halaman list. Periksa dan samakan juga halaman terkait berikut jika ada:

| Tipe halaman | Route contoh | Komponen wajib |
|--------------|--------------|----------------|
| **List** | `/products`, `/delivery` | `PurchasingPageHeader`, `PurchasingListSection`, pagination |
| **Insert** | `/products/insert` | `PurchasingFormHeader`, `PurchasingFormFooter`, card form |
| **Import** | `/materials/import` | `PurchasingFormHeader`, `PurchasingFormFooter`, `CsvImporter` embedded |
| **Edit** | `/products/edit/[id]` | Sama seperti insert + `backHref` ke detail |
| **Detail** | `/products/[id]` | `PurchasingPageHeader`, card `border-gray-200/70`, aksi kanan |
| **Sub-form / editor** | `/products/bom/[id]` | `PurchasingFormHeader`, tabel/form standar, loading + toast |

**Aturan:** Jika user meminta standarisasi list, **cek otomatis** apakah insert, detail, edit, dan sub-page (BOM, QC, dll.) masih memakai pola lama (header manual, bahasa Indonesia, path hardcoded, `Rp` prefix, border tebal).

**Referensi modul lengkap (Product):**

| Halaman | File |
|---------|------|
| List | `src/features/purchasing/products/components/products-page.tsx` |
| Insert | `src/features/purchasing/products/components/new-product-page.tsx` |
| Edit | `src/features/purchasing/products/components/edit-product-page.tsx` |
| Detail | `src/features/purchasing/products/components/product-detail-page.tsx` |
| BOM editor | `src/features/purchasing/products/components/bom-editor-page.tsx` |

### 3.1 Layout list

```tsx
<div className="space-y-6">
  <PurchasingPageHeader title="..." description={<>... {total} total</>} actions={...} />

  {/* Opsional: summary cards */}
  <div className="grid grid-cols-1 gap-3 md:grid-cols-N">...</div>

  <PurchasingListSection
    icon={SomeIcon}
    title="..."
    description="..."
    toolbar={/* search + filter + reset */}
  >
    {/* filter panel (border-b bg-gray-50/70) */}
    {/* table overflow-x-auto */}
    <PurchasingTablePagination ... />
  </PurchasingListSection>
</div>
```

**Import:**

```ts
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingTablePagination } from "@/modules/purchasing/components/pagination/PurchasingTablePagination";
```

### 3.2 Tabel

| Aspek | Standar |
|-------|---------|
| Wrapper | Di dalam `PurchasingListSection`, `overflow-x-auto` |
| Header | `border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500` |
| Cell padding | `px-4 py-3` |
| Row divider | `divide-y divide-gray-100` |
| Hover | `hover:bg-gray-50` |
| Border | Soft only: `border-gray-200/70`, **bukan** border hitam tebal |
| Kolom aksi | `text-right`, ghost icon buttons |
| Link nomor dokumen | `text-pink-700 hover:underline font-medium` |

### 3.3 Toolbar list

- Search: `Input` + ikon `Search`, debounce 300ms, tombol clear `X`.
- Filter: tombol `Filter` — aktif = pink filled; panel filter di `border-b border-gray-100 bg-gray-50/70 px-5 py-4`.
- Dropdown filter: **`Combobox`**, bukan `Select`.
- Reset: tampil jika ada search/filter/page > 1.

### 3.4 Aksi baris

```tsx
<Button variant="ghost" size="sm" title="View detail" className="cursor-pointer">
  <Eye className="h-4 w-4" />
</Button>
```

- Approve / Reject / aksi destruktif: gunakan **`DialogPanel`** (bukan `DialogContent` ad-hoc).
- Setiap tombol yang memanggil API: **loading + disabled** saat proses.

### 3.5 Pagination

- Default page size list: **10**.
- Gunakan `PurchasingTablePagination` dengan `totalItems`, `totalPages`, `pageSize`, `onPageChange`.

---

## 4. Standar UI — Halaman Detail

**Referensi:** PR detail, PO detail, Returns detail, Delivery detail.

### 4.1 Layout detail

```tsx
<div className="space-y-6">
  {/* Header: back + title + status badge + actions */}
  <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row ...">

  {/* Grid konten */}
  <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
    <div className="space-y-6 xl:col-span-8">{/* info + tables */}</div>
    <div className="space-y-6 xl:col-span-4">{/* summary / timeline */}</div>
  </div>
</div>
```

### 4.2 Card detail

```tsx
<Card className="border-gray-200/70 shadow-xs">
  <CardHeader className="border-b border-gray-200/70 pb-3">
    <CardTitle className="flex items-center gap-2 text-base">
      <Icon className="h-4 w-4 text-pink-600" />
      Section Title
    </CardTitle>
  </CardHeader>
  <CardContent className="p-4">...</CardContent>
</Card>
```

---

## 5. Standar UI — Halaman Form (Insert / Edit)

**Referensi:** Create Delivery, New PO, New Return, Create Product.

Gunakan:

```ts
import { PurchasingFormHeader, PurchasingFormFooter } from "@/modules/purchasing/components/page/purchasing-page-header";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
```

| Elemen | Standar |
|--------|---------|
| Header | `PurchasingFormHeader` dengan `backHref` dari `RM_ROUTES` / `PRODUCT_ROUTES` |
| Layout | Full column, stacked cards (`space-y-6`) |
| Card | `border-gray-200/70 shadow-xs`, header `border-b border-gray-200/70 pb-3` |
| Input / Combobox | `h-9 text-sm` (toolbar search boleh `h-10`) |
| Label | `text-xs`, required = `<span className="text-red-500">*</span>` |
| Spacing field | `space-y-1.5` dalam field, `space-y-4` dalam card |
| Tombol utama | `purchasing-main-button` (pink) via `PurchasingFormFooter` |
| Tombol sekunder | `purchasing-secondary-button` (outline) — Cancel di footer |
| Submit label | **Submit** / **Submitting...** atau label spesifik (mis. `Save Product`) |
| Loading awal | `Loader2` + teks English, bukan teks statis saja |
| Redirect setelah sukses | `PRODUCT_ROUTES.products` / `productsDetail(id)` — jangan path legacy |

**Halaman import (bulk CSV):**

- Route dedicated, contoh `RM_ROUTES.materialsImport`
- `PurchasingFormHeader` + tombol **Download Template** di `actions`
- Card upload: `border-gray-200/70 shadow-xs`, header section dengan ikon pink
- `CsvImporter` mode `embedded` + `hideActions` + `PurchasingFormFooter` untuk submit
- Copy English, toast sukses/error, redirect ke list jika tidak ada row skipped

Detail ukuran & Combobox: [`PROJECT_STANDARDS.md`](./purchasing/PROJECT_STANDARDS.md).

---

## 6. Dialog & Modal

Wajib pakai design system `DialogPanel`:

```
DialogPanel
  → DialogPanelHeader (DialogPanelTitle, DialogPanelDescription)
  → DialogPanelToolbar (opsional)
  → DialogPanelBody
  → DialogFooter (px-6 py-4, gap-3, right-aligned)
```

Form di dalam modal: `DialogPanelForm`.

| Size | Lebar | Pemakaian |
|------|-------|-----------|
| `xs` | 420px | Konfirmasi sederhana |
| `sm`–`xl` | ... | Form / detail modal |

---

## 7. Interaksi & Feedback

| Aturan | Detail |
|--------|--------|
| Loading | Semua tombol mutasi: disabled + teks loading |
| Toast sukses/error | Wajib untuk setiap API call / mutasi |
| Toast duplikat | Hindari — guard dengan `ref` atau clear query param setelah redirect toast |
| Focus ring | Subtle: `focus:border-pink-400 focus:ring-2 focus:ring-pink-100` |
| Destructive secondary | Outline + `border-red-200` / `text-red-600`, bukan filled gelap |
| Bahasa UI purchasing | **English** — hindari singkatan (PO → Purchase Order, GRN → Goods Receipt) |

---

## 8. Format Data & Utilitas

```ts
import { formatAmount, formatDate } from "@/lib/purchasing/utils";
```

| Data | Fungsi | Catatan |
|------|--------|---------|
| Mata uang | `formatAmount()` | Tanpa prefix `Rp` di UI list purchasing |
| Tanggal | `formatDate()` | Locale `en-US` untuk modul purchasing |
| Kuantitas | `formatQuantity` / `toLocaleString` | Konsisten 3–4 desimal jika berat |

---

## 9. Data & API Patterns

### 9.1 List dengan enrich

Jika relasi embed gagal (mis. `grn` pada returns), batch-fetch di API:

```ts
// Contoh: enrichPurchaseReturnsWithGrn(db, rows)
```

### 9.2 Dropdown options khusus

Jangan pakai list API generik jika ada aturan bisnis. Buat endpoint dedicated:

| Kebutuhan | Endpoint contoh |
|-----------|-----------------|
| PO untuk delivery | `GET /api/purchasing/delivery/po-options` |
| Delivery untuk GRN | `GET /api/purchasing/delivery/for-grn` |
| GRN untuk return | `GET /api/purchasing/returns/grn-options` |

### 9.3 Delivery vs PO

- PO eligible untuk delivery baru jika status `approved` | `sent` | `partially_received` **dan** tidak ada delivery **terbuka** (`pending`, `shipped`, `in_transit`).
- Delivery `delivered` **tidak** memblokir pengiriman berikutnya pada PO yang sama.

---

## 10. Halaman Referensi (Copy Pattern)

| Tipe | File |
|------|------|
| List + filter + pagination | `src/features/purchasing/returns/components/purchase-returns-page.tsx` |
| List + checkbox + export | `src/features/purchasing/po/components/purchase-orders-page.tsx` |
| List delivery | `src/features/purchasing/delivery/components/delivery-list-page.tsx` |
| Form create | `src/features/purchasing/delivery/components/create-delivery-page.tsx` |
| Detail + progress | `src/features/purchasing/po/components/po-detail-page.tsx` |
| Detail + approval actions | `src/features/purchasing/pr/components/pr-detail-page.tsx` |
| Approval list | `src/features/purchasing/approval/components/pr-approval-page.tsx` |
| Workspace / composite list | `src/features/purchasing/grn/components/receiving-workspace-page.tsx` |
| Master list | `src/features/purchasing/raw-materials/components/raw-materials-page.tsx` |
| Master detail | `src/features/purchasing/raw-materials/components/raw-material-detail-page.tsx` |
| Master insert | `src/features/purchasing/raw-materials/components/new-raw-material-page.tsx` |
| Master import | `src/features/purchasing/raw-materials/components/raw-materials-import-page.tsx` |
| Product list (full module) | `src/features/purchasing/products/components/products-page.tsx` |
| Product insert / edit / detail / BOM | `src/features/purchasing/products/components/*-product-page.tsx`, `bom-editor-page.tsx` |
| Production recipes list | `src/features/purchasing/production/components/production-recipes-page.tsx` |

---

## 11. Checklist Feature / Enhancement

### Persiapan

- [ ] Branch dari `development` terbaru
- [ ] Baca halaman referensi yang paling mirip
- [ ] Route baru ditambahkan ke `RM_ROUTES` / `PRODUCT_ROUTES` jika perlu
- [ ] **Cek insert, detail, edit, sub-page** — bukan hanya list

### UI List

- [ ] `PurchasingPageHeader` + `PurchasingListSection`
- [ ] Tabel mengikuti pola PR/PO (soft border, `px-4`, aksi kanan)
- [ ] Search debounce + filter Combobox + Reset
- [ ] Pagination 10 item
- [ ] Empty state + loading state
- [ ] Link dokumen ke detail (`RM_ROUTES`)
- [ ] Copy English, tanpa singkatan

### UI Detail / Form

- [ ] `PurchasingPageHeader` (detail) atau `PurchasingFormHeader` + `PurchasingFormFooter` (insert/edit)
- [ ] Card `border-gray-200/70 shadow-xs`
- [ ] Dialog pakai `DialogPanel`
- [ ] Tombol mutasi: loading + toast
- [ ] `backHref` / link navigasi pakai `RM_ROUTES` / `PRODUCT_ROUTES`
- [ ] Copy English, `formatAmount` tanpa prefix `Rp`

### API

- [ ] Validasi Zod
- [ ] Business scope diterapkan
- [ ] Error message jelas (English untuk purchasing)
- [ ] Endpoint dedicated untuk dropdown jika ada filter bisnis

### Kualitas

- [ ] Tidak ada path hardcoded `/dashboard/purchasing/...` untuk link baru
- [ ] Tidak ada border hitam / ring kontras tinggi
- [ ] Scope perubahan minimal — tidak refactor tidak terkait
- [ ] Test manual: list, filter, create, error toast

---

## 12. Anti-Pattern (Hindari)

| Jangan | Lakukan |
|--------|---------|
| `Select` untuk dropdown panjang | `Combobox` dengan search |
| `DialogContent` + padding manual | `DialogPanel` |
| Hardcode URL dashboard | `RM_ROUTES` / `PRODUCT_ROUTES` |
| `formatCurrency` lokal duplikat | `formatAmount` dari utils |
| Filter PO delivery dari `GET /api/purchasing/po` saja | `delivery/po-options` |
| Toast ganda setelah redirect | Guard effect / clear query param |
| UI campuran ID + EN di purchasing | English konsisten |
| Commit ke `development` | Branch `feature/` atau `fix/` |

---

## 13. Dokumen Terkait

| Dokumen | Isi |
|---------|-----|
| [`docs/purchasing/PROJECT_STANDARDS.md`](./purchasing/PROJECT_STANDARDS.md) | Form field, Combobox, ukuran komponen, template form |
| [`.cursor/rules/ui-interaction-standards.mdc`](../.cursor/rules/ui-interaction-standards.mdc) | Aturan UI otomatis di Cursor |
| [`src/modules/purchasing/constants/item-routes.ts`](../src/modules/purchasing/constants/item-routes.ts) | Semua route RM & Product |
| [`src/lib/iam/nav-context.ts`](../src/lib/iam/nav-context.ts) | Nav active dari approval |

---

**Ingat:** Sebelum mendesain UI baru, buka halaman referensi yang sudah ada dan samakan struktur, spacing, dan perilaku interaksinya.
