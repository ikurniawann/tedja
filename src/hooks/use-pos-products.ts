"use client";

import { useState, useEffect, useCallback } from "react";
import { getProducts, type Product } from "@/lib/pos-api";
import {
  cacheCatalogMeta,
  cacheProducts,
  getCachedCatalogMeta,
  getCachedProducts,
  setLastSyncTimestamp,
} from "@/lib/pos-db";
import type { ActiveStallMode } from "@/lib/pos/pos-sell-stall";

export function usePosProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>(["All"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOfflineFallback, setIsOfflineFallback] = useState(false);
  const [stallBlockedReason, setStallBlockedReason] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<ActiveStallMode | null>(null);

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setIsOfflineFallback(false);
      const res = await getProducts();
      const data = res.data || [];
      setProducts(data);
      const cats = Array.from(new Set(data.map((p: any) => p.category?.name || "Uncategorized")));
      setCategories(["All", ...cats]);
      setActiveMode(res.meta?.active_mode ?? null);
      const reason = res.meta?.reason;
      const catalogFilled = data.length > 0;
      // Central cashier all-mode catalog is filled — do not treat all_stalls as blocked.
      setStallBlockedReason(
        catalogFilled
          ? null
          : reason === "all_stalls" ||
              reason === "multiple_unselected" ||
              reason === "no_stall" ||
              reason === "no_stall_assignment"
            ? reason
            : null
      );
      void cacheProducts(
        data.map((p: any) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          base_price: p.base_price,
          is_active: p.is_active,
          is_available: p.is_available,
          image_url: p.image_url,
          category: p.category,
          variants: p.variants,
          modifiers: p.modifiers,
          xp: p.xp,
          station: p.station,
          product_kind: p.product_kind,
          warehouse_id: p.warehouse_id ?? null,
          warehouse_name: p.warehouse_name ?? null,
        }))
      );
      void cacheCatalogMeta({ active_mode: res.meta?.active_mode ?? null });
      void setLastSyncTimestamp("products");
    } catch (err: any) {
      try {
        const [cached, cachedMeta] = await Promise.all([
          getCachedProducts(),
          getCachedCatalogMeta(),
        ]);
        if (cached.length > 0) {
          setProducts(cached as Product[]);
          const cats = Array.from(
            new Set(cached.map((p: any) => p.category?.name || "Uncategorized"))
          );
          setCategories(["All", ...cats]);
          setIsOfflineFallback(true);
          setError(null);
          setStallBlockedReason(null);
          setActiveMode(cachedMeta?.active_mode ?? null);
        } else {
          setError(err.message || "Failed to load products");
        }
      } catch {
        setError(err.message || "Failed to load products");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  return {
    products,
    categories,
    loading,
    error,
    isOfflineFallback,
    stallBlockedReason,
    activeMode,
    refetch: fetchProducts,
  };
}
