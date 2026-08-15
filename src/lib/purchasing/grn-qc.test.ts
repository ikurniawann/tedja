import { describe, expect, it } from "vitest";
import { buildInlineQcItemsFromCreatedGrn } from "@/lib/purchasing/grn-qc";
import { resolveOverallQcStatus } from "@/lib/purchasing/grn-qc-utils";
import { resolveBaseUnitFactor } from "@/lib/purchasing/raw-material-units";

describe("resolveBaseUnitFactor", () => {
  const material = {
    satuan_besar_id: "unit-box",
    satuan_kecil_id: "unit-pcs",
    konversi_factor: 12,
  };

  it("scales satuan besar into the base unit", () => {
    expect(resolveBaseUnitFactor(material, [], "unit-box")).toBe(12);
  });

  it("keeps satuan kecil as-is because it is the base unit", () => {
    expect(resolveBaseUnitFactor(material, [], "unit-pcs")).toBe(1);
  });

  it("prefers an explicit unit conversion row over the material conversion factor", () => {
    expect(
      resolveBaseUnitFactor(material, [{ satuan_id: "unit-pallet", qty_in_base_unit: 144 }], "unit-pallet")
    ).toBe(144);
  });

  it("falls back to satuan besar when the document has no unit", () => {
    expect(resolveBaseUnitFactor(material, [], null)).toBe(12);
  });

  it("returns 1 when the material has no small unit", () => {
    expect(
      resolveBaseUnitFactor(
        { satuan_besar_id: "unit-kg", satuan_kecil_id: null, konversi_factor: 25 },
        [],
        "unit-kg"
      )
    ).toBe(1);
  });
});

describe("buildInlineQcItemsFromCreatedGrn", () => {
  it("maps created GRN lines to QC payload using request QC quantities", () => {
    const items = buildInlineQcItemsFromCreatedGrn({
      createdItems: [
        {
          id: "gi-1",
          purchase_order_item_id: "poi-1",
          raw_material_id: "rm-1",
          qty_diterima: 10,
        },
        {
          id: "gi-2",
          purchase_order_item_id: "poi-2",
          product_id: "p-1",
          qty_diterima: 5,
        },
        {
          id: "gi-3",
          purchase_order_item_id: "poi-3",
          raw_material_id: "rm-2",
          qty_diterima: 0,
        },
      ],
      requestItems: [
        {
          purchase_order_item_id: "poi-1",
          raw_material_id: "rm-1",
          qty_diterima: 10,
          qty_accepted: 8,
          qty_rejected: 2,
        },
        {
          purchase_order_item_id: "poi-2",
          product_id: "p-1",
          qty_diterima: 5,
          qty_accepted: 5,
          qty_rejected: 0,
        },
        {
          purchase_order_item_id: "poi-3",
          raw_material_id: "rm-2",
          qty_diterima: 0,
          qty_accepted: 0,
          qty_rejected: 0,
        },
      ],
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      grn_item_id: "gi-1",
      raw_material_id: "rm-1",
      qty_inspected: 10,
      qty_accepted: 8,
      qty_rejected: 2,
    });
    expect(items[1]).toMatchObject({
      grn_item_id: "gi-2",
      product_id: "p-1",
      qty_inspected: 5,
      qty_accepted: 5,
      qty_rejected: 0,
    });
    expect(resolveOverallQcStatus(items)).toBe("partial");
  });

  it("defaults accepted to received when QC fields omitted", () => {
    const items = buildInlineQcItemsFromCreatedGrn({
      createdItems: [
        {
          id: "gi-1",
          purchase_order_item_id: "poi-1",
          raw_material_id: "rm-1",
          qty_diterima: 3,
        },
      ],
      requestItems: [
        {
          purchase_order_item_id: "poi-1",
          raw_material_id: "rm-1",
          qty_diterima: 3,
        },
      ],
    });

    expect(items[0]).toMatchObject({
      qty_accepted: 3,
      qty_rejected: 0,
    });
    expect(resolveOverallQcStatus(items)).toBe("approved");
  });
});
