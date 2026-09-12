import { describe, expect, it } from "vitest";
import {
  buildCategories,
  filterProducts,
  groupBySection,
  normalizeTableOrderProduct,
  resolveVariant,
  unitPriceFor,
  UNCATEGORIZED_ID,
  UNCATEGORIZED_LABEL,
  formatMenuPrice,
} from "./menu";

const baseRow = {
  id: "p1",
  sku: "KOPI-01",
  name: "Kopi Susu Gula Aren",
  description: "  Espresso, susu, gula aren.  ",
  base_price: "28000.00",
  image_url: "",
  xp_points: "28",
  station: "BAR",
  prep_time_minutes: 5,
  min_xp: null,
  category_id: "c-drink",
  category_name: "Minuman",
  variants: [
    { id: "v-ice", name: "Ice", price_adjustment: "0" },
    { id: "v-hot", name: "Hot", price_adjustment: 0 },
    { id: "v-off", name: "Nonaktif", price_adjustment: 5000, is_active: false },
  ],
};

describe("normalizeTableOrderProduct", () => {
  it("memetakan kolom pos_products ke bentuk menu (harga numerik, station lowercase, varian aktif saja)", () => {
    const product = normalizeTableOrderProduct(baseRow);
    expect(product.price).toBe(28000);
    expect(product.xp).toBe(28);
    expect(product.station).toBe("bar");
    expect(product.stationLabel).toBe("Bar");
    expect(product.image).toBeNull();
    expect(product.description).toBe("Espresso, susu, gula aren.");
    expect(product.variants.map((v) => v.id)).toEqual(["v-ice", "v-hot"]);
    expect(product.customizable).toBe(true);
    expect(product.minXp).toBe(0);
  });

  it("menerima varian dalam bentuk string JSON (hasil json_agg) dan default kategori 'Lainnya'", () => {
    const product = normalizeTableOrderProduct({
      ...baseRow,
      category_id: null,
      category_name: null,
      variants: JSON.stringify([{ id: "v1", name: "Regular", price_adjustment: 0 }]),
    });
    expect(product.categoryName).toBe(UNCATEGORIZED_LABEL);
    expect(product.variants).toHaveLength(1);
    expect(product.customizable).toBe(false);
  });

  it("varian JSON rusak → tanpa varian (tidak melempar)", () => {
    const product = normalizeTableOrderProduct({ ...baseRow, variants: "{bukan json" });
    expect(product.variants).toEqual([]);
  });

  it("harga negatif/aneh dinormalkan ke 0", () => {
    const product = normalizeTableOrderProduct({ ...baseRow, base_price: "abc", xp_points: -3 });
    expect(product.price).toBe(0);
    expect(product.xp).toBe(0);
  });
});

describe("resolveVariant / unitPriceFor", () => {
  const product = normalizeTableOrderProduct({
    ...baseRow,
    variants: [
      { id: "reg", name: "Regular", price_adjustment: 0 },
      { id: "lg", name: "Large", price_adjustment: 6000 },
    ],
  });

  it("tanpa pilihan → varian pertama; id tidak dikenal → null (server harus menolak)", () => {
    expect(resolveVariant(product, null)?.id).toBe("reg");
    expect(resolveVariant(product, "lg")?.id).toBe("lg");
    expect(resolveVariant(product, "palsu")).toBeNull();
  });

  it("produk tanpa varian → null dan harga = harga dasar", () => {
    const plain = normalizeTableOrderProduct({ ...baseRow, variants: [] });
    expect(resolveVariant(plain, "apa-saja")).toBeNull();
    expect(unitPriceFor(plain, null)).toBe(28000);
  });

  it("harga satuan = dasar + penyesuaian varian, dibulatkan", () => {
    expect(unitPriceFor(product, resolveVariant(product, "lg"))).toBe(34000);
    expect(unitPriceFor({ price: 10000.4 }, { id: "x", name: "x", priceAdjustment: 0.4 })).toBe(10001);
  });
});

describe("buildCategories / filterProducts / groupBySection", () => {
  const products = [
    normalizeTableOrderProduct({ ...baseRow, id: "a", category_id: "c-drink", category_name: "Minuman" }),
    normalizeTableOrderProduct({ ...baseRow, id: "b", name: "Nasi Goreng", category_id: "c-food", category_name: "Makanan" }),
    normalizeTableOrderProduct({ ...baseRow, id: "c", name: "Roti", category_id: null, category_name: null }),
    normalizeTableOrderProduct({ ...baseRow, id: "d", name: "Teh", category_id: "c-drink", category_name: "Minuman" }),
  ];

  it("kategori mengikuti urutan kemunculan produk dengan hitungan", () => {
    expect(buildCategories(products)).toEqual([
      { id: "c-drink", name: "Minuman", count: 2 },
      { id: "c-food", name: "Makanan", count: 1 },
      { id: UNCATEGORIZED_ID, name: UNCATEGORIZED_LABEL, count: 1 },
    ]);
  });

  it("filter kategori + pencarian bebas huruf besar/kecil", () => {
    expect(filterProducts(products, { categoryId: "c-drink" }).map((p) => p.id)).toEqual(["a", "d"]);
    expect(filterProducts(products, { query: "  NASI " }).map((p) => p.id)).toEqual(["b"]);
    expect(filterProducts(products, { query: "minuman", categoryId: "c-food" })).toEqual([]);
    expect(filterProducts(products, { categoryId: UNCATEGORIZED_ID }).map((p) => p.id)).toEqual(["c"]);
  });

  it("seksi kosong (setelah filter) tidak ikut ditampilkan", () => {
    const categories = buildCategories(products);
    const sections = groupBySection(filterProducts(products, { query: "teh" }), categories);
    expect(sections).toHaveLength(1);
    expect(sections[0].category.id).toBe("c-drink");
    expect(sections[0].products.map((p) => p.id)).toEqual(["d"]);
  });
});

describe("formatMenuPrice", () => {
  it("format id-ID tanpa simbol mata uang seperti referensi daftar menu", () => {
    expect(formatMenuPrice(32500)).toBe("32.500");
    expect(formatMenuPrice(1234567.6)).toBe("1.234.568");
  });
});
