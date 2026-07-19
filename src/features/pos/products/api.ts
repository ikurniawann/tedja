import { computeMarginPercentage } from "@/lib/pos/purchasing-sync";
import type { ApiPosProduct, PatchPosProductPayload, PosCatalogProduct } from "./types";

export type * from "./types";

const toNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

function resolveProductCost(product: ApiPosProduct) {
  const bomCost = toNumber(product.hpp_estimasi ?? product.estimated_cogs);
  const storedCost = toNumber(product.cost_price);
  return bomCost > 0 ? bomCost : storedCost;
}

const generateId = () => Math.random().toString(36).slice(2, 11);

function normalizeCategory(category: ApiPosProduct["category"]) {
  if (typeof category === "string") return category || "Uncategorized";
  const row = Array.isArray(category) ? category[0] : category;
  return row?.name || "Uncategorized";
}

export function mapApiPosProduct(product: ApiPosProduct): PosCatalogProduct {
  const price = toNumber(product.base_price);
  const cost = resolveProductCost(product);
  const margin = computeMarginPercentage(price, cost);
  const variants = (product.variants ?? []).map((variant) => ({
    id: variant.id || generateId(),
    name: variant.name || "Regular",
    sku: variant.sku || "",
    priceAdj: toNumber(variant.price_adjustment),
    active: variant.is_active !== false,
  }));
  const modifierGroups = (product.modifiers ?? [])
    .map((link, index) => {
      const group = link.modifier_group;
      if (!group) return null;
      return {
        id: `${product.id}-mg-${index}`,
        name: group.name || `Modifier ${index + 1}`,
        required: toNumber(group.min_selection) > 0,
        maxSelect: Math.max(1, toNumber(group.max_selection) || 1),
        active: true,
        modifiers: (group.modifiers ?? []).map((modifier) => ({
          id: modifier.id || generateId(),
          name: modifier.name || "Modifier",
          priceAdj: toNumber(modifier.price_adjustment),
          active: modifier.is_active !== false,
        })),
      };
    })
    .filter((group): group is PosCatalogProduct["modifierGroups"][number] => Boolean(group));

  return {
    id: product.id,
    sku: product.sku || undefined,
    name: product.name || "Untitled Product",
    category: normalizeCategory(product.category),
    price,
    cost,
    margin,
    status: product.is_active === false ? "inactive" : "active",
    station: product.station || "kitchen",
    hasVariants: variants.length > 0,
    hasModifiers: modifierGroups.length > 0,
    variants,
    modifierGroups,
    minXp:
      product.min_xp === null || product.min_xp === undefined
        ? null
        : toNumber(product.min_xp) || null,
  };
}

async function parsePosResponse<T>(response: Response, fallbackError: string): Promise<T> {
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || fallbackError);
  }
  return json as T;
}

export async function listPosCatalogProducts(): Promise<PosCatalogProduct[]> {
  const response = await fetch("/api/pos/products?include_inactive=true", { cache: "no-store" });
  const json = await parsePosResponse<{ data: ApiPosProduct[] }>(response, "Gagal memuat produk");
  return (json.data ?? []).map(mapApiPosProduct);
}

export async function patchPosProduct(
  id: string,
  payload: PatchPosProductPayload
): Promise<PosCatalogProduct | null> {
  const response = await fetch(`/api/pos/products/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parsePosResponse<{ data?: ApiPosProduct }>(response, "Gagal menyimpan produk");
  return json.data ? mapApiPosProduct(json.data) : null;
}
