/**
 * EPIC-047 Fase 1A — matriks varian (ukuran × warna × …) di master produk
 * merchandise → auto-generate SKU. Murni (tanpa I/O); dipakai oleh
 * POST /api/pos/products/[id]/skus/matrix.
 */

export type VariantAxis = {
  key: "ukuran" | "warna" | string;
  values: string[];
};

/** Kombinasi satu baris matriks: { ukuran: "M", warna: "Hitam", ... }. */
export type VariantOptions = Record<string, string>;

const MAX_SKU_LENGTH = 60;

function cleanValues(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    const dedupeKey = value.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(value);
  }
  return out;
}

/**
 * Cartesian product antar sumbu, urutan sumbu & nilai dipertahankan. Sumbu
 * tanpa nilai (setelah trim/dedupe) membuat hasil kosong (tidak ada baris
 * yang bisa dibentuk tanpa nilai untuk sumbu itu).
 */
export function expandMatrix(axes: VariantAxis[]): VariantOptions[] {
  const cleanAxes = (axes ?? [])
    .map((axis) => ({ key: String(axis?.key ?? "").trim(), values: cleanValues(axis?.values ?? []) }))
    .filter((axis) => axis.key.length > 0);

  if (cleanAxes.length === 0) return [];
  if (cleanAxes.some((axis) => axis.values.length === 0)) return [];

  let combos: VariantOptions[] = [{}];
  for (const axis of cleanAxes) {
    const next: VariantOptions[] = [];
    for (const combo of combos) {
      for (const value of axis.values) {
        next.push({ ...combo, [axis.key]: value });
      }
    }
    combos = next;
  }
  return combos;
}

function slugToken(value: string): string {
  return value
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // lepas diakritik
    .replace(/[^A-Z0-9]+/g, "");
}

/**
 * Kode SKU deterministik: BASE-VALUE1-VALUE2-... (urutan sesuai kunci
 * `options`, non-alnum dibuang, huruf besar). Dipotong ≤60 karakter dengan
 * memendekkan token nilai (bukan base) secara merata dari yang terakhir.
 */
export function buildSkuCode(baseSku: string, options: VariantOptions): string {
  // Base dipertahankan apa adanya (termasuk tanda hubungnya sendiri, mis.
  // "KAOS-001") — hanya di-trim & uppercase. Non-alnum → nothing HANYA
  // berlaku untuk token nilai yang ditambahkan (lihat slugToken di bawah).
  const base = String(baseSku ?? "").trim().toUpperCase() || "SKU";
  const tokens = Object.keys(options)
    .map((key) => slugToken(options[key]))
    .filter((token) => token.length > 0);

  let code = [base, ...tokens].join("-");
  if (code.length <= MAX_SKU_LENGTH) return code;

  // Terlalu panjang — pendekkan token nilai dari yang paling belakang dulu,
  // base TIDAK PERNAH dipotong.
  const parts = [...tokens];
  while (parts.length > 0 && [base, ...parts].join("-").length > MAX_SKU_LENGTH) {
    const lastIndex = parts.length - 1;
    const current = parts[lastIndex];
    if (current.length <= 1) {
      parts.pop();
    } else {
      parts[lastIndex] = current.slice(0, current.length - 1);
    }
  }
  code = [base, ...parts].join("-");
  // Fallback ekstrem: base sendiri sudah > 60 — potong bagian akhir base
  // hanya sebagai upaya terakhir (tidak diharapkan terjadi di praktik).
  if (code.length > MAX_SKU_LENGTH) {
    code = code.slice(0, MAX_SKU_LENGTH);
  }
  return code;
}

/** Nama SKU: "Nama Produk — Value1 / Value2". */
export function buildSkuName(productName: string, options: VariantOptions): string {
  const name = String(productName ?? "").trim();
  const values = Object.keys(options)
    .map((key) => String(options[key] ?? "").trim())
    .filter((value) => value.length > 0);
  if (values.length === 0) return name;
  return `${name} — ${values.join(" / ")}`;
}

/** Bandingkan dua objek options tanpa peduli urutan kunci. */
function optionsKey(options: VariantOptions): string {
  return Object.keys(options)
    .sort()
    .map((key) => `${key.toLowerCase()}=${String(options[key] ?? "").trim().toLowerCase()}`)
    .join("&");
}

export type ExistingSku = {
  id: string;
  sku: string;
  name: string;
  options: VariantOptions | null;
  stock_quantity: number;
  is_active: boolean;
};

export type DiffMatrixResult = {
  create: VariantOptions[];
  deactivate: ExistingSku[];
  keep: ExistingSku[];
};

/**
 * Bandingkan SKU aktif yang ada dengan matriks yang diinginkan, dicocokkan
 * lewat objek `options` (order-insensitive). `deactivate` = SKU aktif yang
 * ada tapi tidak lagi diinginkan; `create` = kombinasi diinginkan yang belum
 * ada; `keep` = SKU aktif yang tetap dipakai.
 */
export function diffMatrix(existing: ExistingSku[], wanted: VariantOptions[]): DiffMatrixResult {
  const activeExisting = (existing ?? []).filter((row) => row.is_active !== false);
  const existingByKey = new Map<string, ExistingSku>();
  for (const row of activeExisting) {
    existingByKey.set(optionsKey(row.options ?? {}), row);
  }

  const wantedKeys = new Set(wanted.map((options) => optionsKey(options)));

  const create: VariantOptions[] = [];
  const keep: ExistingSku[] = [];
  for (const options of wanted) {
    const key = optionsKey(options);
    const match = existingByKey.get(key);
    if (match) {
      keep.push(match);
    } else {
      create.push(options);
    }
  }

  const deactivate = activeExisting.filter((row) => !wantedKeys.has(optionsKey(row.options ?? {})));

  return { create, deactivate, keep };
}

/** Aturan 409: SKU ber-stok tidak boleh hilang tanpa sengaja. */
export function blockedDeactivations(
  existing: ExistingSku[],
  deactivateIds: string[]
): ExistingSku[] {
  const ids = new Set(deactivateIds);
  return (existing ?? []).filter((row) => ids.has(row.id) && Number(row.stock_quantity) > 0);
}
