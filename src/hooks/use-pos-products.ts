"use client";

import { useState, useEffect, useCallback } from "react";
import { getProducts, type Product } from "@/lib/pos-api";
import { cacheProducts, getCachedProducts, setLastSyncTimestamp } from "@/lib/pos-db";

export function usePosProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>(["All"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOfflineFallback, setIsOfflineFallback] = useState(false);

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
      // Cache to IndexedDB
      void cacheProducts(data.map((p: any) => ({
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
      })));
      void setLastSyncTimestamp('products');
    } catch (err: any) {
      // Try fallback from IndexedDB
      try {
        const cached = await getCachedProducts();
        if (cached.length > 0) {
          setProducts(cached as Product[]);
          const cats = Array.from(new Set(cached.map((p: any) => p.category?.name || "Uncategorized")));
          setCategories(["All", ...cats]);
          setIsOfflineFallback(true);
          setError(null);
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

  return { products, categories, loading, error, isOfflineFallback, refetch: fetchProducts };
}
