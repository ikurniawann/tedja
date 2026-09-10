import { describe, expect, it } from "vitest";
import {
  blockedDeactivations,
  buildSkuCode,
  buildSkuName,
  diffMatrix,
  expandMatrix,
  type ExistingSku,
  type VariantAxis,
} from "./merchandise-variants";

describe("expandMatrix", () => {
  it("cartesian product mempertahankan urutan sumbu & nilai", () => {
    const axes: VariantAxis[] = [
      { key: "ukuran", values: ["S", "M"] },
      { key: "warna", values: ["Hitam", "Putih"] },
    ];
    expect(expandMatrix(axes)).toEqual([
      { ukuran: "S", warna: "Hitam" },
      { ukuran: "S", warna: "Putih" },
      { ukuran: "M", warna: "Hitam" },
      { ukuran: "M", warna: "Putih" },
    ]);
  });

  it("4 ukuran x 2 warna = 8 kombinasi", () => {
    const axes: VariantAxis[] = [
      { key: "ukuran", values: ["S", "M", "L", "XL"] },
      { key: "warna", values: ["Hitam", "Putih"] },
    ];
    expect(expandMatrix(axes)).toHaveLength(8);
  });

  it("trim, buang nilai kosong & duplikat (case-insensitive)", () => {
    const axes: VariantAxis[] = [{ key: "ukuran", values: [" S ", "S", "s", "", "  ", "M"] }];
    expect(expandMatrix(axes)).toEqual([{ ukuran: "S" }, { ukuran: "M" }]);
  });

  it("sumbu tanpa key diabaikan", () => {
    const axes: VariantAxis[] = [{ key: "  ", values: ["X"] }, { key: "warna", values: ["Hitam"] }];
    expect(expandMatrix(axes)).toEqual([{ warna: "Hitam" }]);
  });

  it("sumbu manapun tanpa nilai valid → hasil kosong", () => {
    const axes: VariantAxis[] = [
      { key: "ukuran", values: ["S", "M"] },
      { key: "warna", values: ["  ", ""] },
    ];
    expect(expandMatrix(axes)).toEqual([]);
  });

  it("axes kosong → hasil kosong", () => {
    expect(expandMatrix([])).toEqual([]);
  });

  it("sumbu ketiga custom didukung", () => {
    const axes: VariantAxis[] = [
      { key: "ukuran", values: ["M"] },
      { key: "warna", values: ["Hitam"] },
      { key: "bahan", values: ["Katun", "Polyester"] },
    ];
    expect(expandMatrix(axes)).toEqual([
      { ukuran: "M", warna: "Hitam", bahan: "Katun" },
      { ukuran: "M", warna: "Hitam", bahan: "Polyester" },
    ]);
  });
});

describe("buildSkuCode", () => {
  it("deterministik: base + values uppercase, non-alnum dibuang", () => {
    expect(buildSkuCode("KAOS-001", { ukuran: "M", warna: "Hitam" })).toBe("KAOS-001-M-HITAM");
  });

  it("urutan token ikut urutan key di options", () => {
    expect(buildSkuCode("KAOS-001", { warna: "Hitam", ukuran: "M" })).toBe("KAOS-001-HITAM-M");
  });

  it("selalu sama untuk options yang sama", () => {
    const a = buildSkuCode("APL-KAOS-001", { ukuran: "XL", warna: "Navy" });
    const b = buildSkuCode("APL-KAOS-001", { ukuran: "XL", warna: "Navy" });
    expect(a).toBe(b);
  });

  it("base kosong fallback ke SKU", () => {
    expect(buildSkuCode("", { ukuran: "M" })).toBe("SKU-M");
  });

  it("≤60 karakter — memendekkan token nilai, base tidak pernah dipotong", () => {
    const base = "KAOS-001";
    const options = {
      ukuran: "EXTRAEXTRAEXTRALARGEUKURANPANJANGSEKALI",
      warna: "HITAMKEABUABUANGELAPBANGETSEKALI",
    };
    const code = buildSkuCode(base, options);
    expect(code.length).toBeLessThanOrEqual(60);
    expect(code.startsWith(base)).toBe(true);
  });
});

describe("buildSkuName", () => {
  it("format Nama — Value1 / Value2", () => {
    expect(buildSkuName("Kaos Polos", { ukuran: "M", warna: "Hitam" })).toBe("Kaos Polos — M / Hitam");
  });

  it("tanpa options → nama saja", () => {
    expect(buildSkuName("Kaos Polos", {})).toBe("Kaos Polos");
  });
});

describe("diffMatrix", () => {
  const row = (over: Partial<ExistingSku>): ExistingSku => ({
    id: "id",
    sku: "SKU",
    name: "Name",
    options: {},
    stock_quantity: 0,
    is_active: true,
    ...over,
  });

  it("create untuk kombinasi baru, keep untuk yang cocok, deactivate untuk yang hilang", () => {
    const existing: ExistingSku[] = [
      row({ id: "1", options: { ukuran: "S", warna: "Hitam" } }),
      row({ id: "2", options: { ukuran: "M", warna: "Hitam" } }),
    ];
    const wanted = [
      { ukuran: "M", warna: "Hitam" },
      { ukuran: "L", warna: "Hitam" },
    ];
    const result = diffMatrix(existing, wanted);
    expect(result.create).toEqual([{ ukuran: "L", warna: "Hitam" }]);
    expect(result.keep.map((r) => r.id)).toEqual(["2"]);
    expect(result.deactivate.map((r) => r.id)).toEqual(["1"]);
  });

  it("matching order-insensitive terhadap urutan key", () => {
    const existing: ExistingSku[] = [row({ id: "1", options: { warna: "Hitam", ukuran: "M" } })];
    const wanted = [{ ukuran: "M", warna: "Hitam" }];
    const result = diffMatrix(existing, wanted);
    expect(result.create).toEqual([]);
    expect(result.keep.map((r) => r.id)).toEqual(["1"]);
    expect(result.deactivate).toEqual([]);
  });

  it("idempoten: matriks sama dua kali = no create/deactivate", () => {
    const existing: ExistingSku[] = [
      row({ id: "1", options: { ukuran: "S" } }),
      row({ id: "2", options: { ukuran: "M" } }),
    ];
    const wanted = [{ ukuran: "S" }, { ukuran: "M" }];
    const result = diffMatrix(existing, wanted);
    expect(result.create).toEqual([]);
    expect(result.deactivate).toEqual([]);
    expect(result.keep).toHaveLength(2);
  });

  it("SKU non-aktif tidak dianggap ada — jadi masuk create bila diinginkan lagi", () => {
    const existing: ExistingSku[] = [row({ id: "1", options: { ukuran: "S" }, is_active: false })];
    const wanted = [{ ukuran: "S" }];
    const result = diffMatrix(existing, wanted);
    expect(result.create).toEqual([{ ukuran: "S" }]);
    expect(result.deactivate).toEqual([]);
  });

  it("diffMatrix tidak pernah mengusulkan deaktivasi SKU yang punya stok — dijaga blockedDeactivations", () => {
    const existing: ExistingSku[] = [
      row({ id: "1", options: { ukuran: "S" }, stock_quantity: 5 }),
      row({ id: "2", options: { ukuran: "M" }, stock_quantity: 0 }),
    ];
    const wanted: Array<Record<string, string>> = [];
    const result = diffMatrix(existing, wanted);
    expect(result.deactivate.map((r) => r.id)).toEqual(["1", "2"]);
    const blocked = blockedDeactivations(existing, result.deactivate.map((r) => r.id));
    expect(blocked.map((r) => r.id)).toEqual(["1"]);
  });
});

describe("blockedDeactivations", () => {
  it("hanya baris dengan stock_quantity > 0 yang diblokir", () => {
    const existing: ExistingSku[] = [
      { id: "1", sku: "A", name: "A", options: {}, stock_quantity: 0, is_active: true },
      { id: "2", sku: "B", name: "B", options: {}, stock_quantity: 5, is_active: true },
    ];
    expect(blockedDeactivations(existing, ["1", "2"]).map((r) => r.id)).toEqual(["2"]);
  });

  it("id yang tidak masuk deactivateIds diabaikan", () => {
    const existing: ExistingSku[] = [{ id: "1", sku: "A", name: "A", options: {}, stock_quantity: 5, is_active: true }];
    expect(blockedDeactivations(existing, [])).toEqual([]);
  });
});
