export type PosProductVariant = {
  id: string;
  name: string;
  sku: string;
  priceAdj: number;
  active: boolean;
};

export type PosProductModifier = {
  id: string;
  name: string;
  priceAdj: number;
  active: boolean;
};

export type PosProductModifierGroup = {
  id: string;
  name: string;
  required: boolean;
  maxSelect: number;
  active: boolean;
  modifiers: PosProductModifier[];
};

export type PosCatalogProduct = {
  id: string;
  sku?: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  margin: number;
  status: "active" | "inactive";
  station: string;
  hasVariants: boolean;
  hasModifiers: boolean;
  variants: PosProductVariant[];
  modifierGroups: PosProductModifierGroup[];
  /** Syarat privilege member: minimal lifetime XP; null = produk umum */
  minXp: number | null;
};

export type ApiPosProduct = {
  id: string;
  sku?: string | null;
  name?: string | null;
  category?: { name?: string | null } | { name?: string | null }[] | string | null;
  base_price?: number | string | null;
  cost_price?: number | string | null;
  estimated_cogs?: number | string | null;
  hpp_estimasi?: number | string | null;
  station?: string | null;
  is_active?: boolean | null;
  min_xp?: number | string | null;
  variants?: Array<{
    id?: string;
    name?: string | null;
    sku?: string | null;
    price_adjustment?: number | string | null;
    is_active?: boolean | null;
  }> | null;
  modifiers?: Array<{
    modifier_group?: {
      name?: string | null;
      min_selection?: number | string | null;
      max_selection?: number | string | null;
      modifiers?: Array<{
        id?: string;
        name?: string | null;
        price_adjustment?: number | string | null;
        is_active?: boolean | null;
      }> | null;
    } | null;
  }> | null;
};

export interface PatchPosProductPayload {
  is_active?: boolean;
  station?: string;
  /** null = hapus syarat (produk umum) */
  min_xp?: number | null;
}
