"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { getCustomers, type Customer } from "@/lib/pos-api";
import { cacheCustomers, getCachedCustomers, setLastSyncTimestamp } from "@/lib/pos-db";

export interface CustomerWithDiscount extends Customer {
  discount: number;
}

export function usePosCustomers() {
  const [customers, setCustomers] = useState<CustomerWithDiscount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOfflineFallback, setIsOfflineFallback] = useState(false);

  const fetchCustomers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setIsOfflineFallback(false);
      const res = await getCustomers();
      const data = (res.data || []).map((c: any) => ({
        ...c,
        // Diskon dari konfigurasi tier CRM (server), bukan hardcode
        discount: Number(c.discount_percent) || 0,
      })) as CustomerWithDiscount[];
      setCustomers(data);
      // Cache to IndexedDB
      void cacheCustomers(data.map((c: any) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        membership_tier: c.membership_tier,
        ark_coin_balance: c.ark_coin_balance,
        total_xp: c.total_xp,
        total_spent: c.total_spent,
        visit_count: c.visit_count,
        discount: c.discount,
      })));
      void setLastSyncTimestamp('customers');
    } catch (err: any) {
      try {
        const cached = await getCachedCustomers();
        if (cached.length > 0) {
          setCustomers(cached as CustomerWithDiscount[]);
          setIsOfflineFallback(true);
          setError(null);
        } else {
          setError(err.message || "Failed to load customers");
        }
      } catch {
        setError(err.message || "Failed to load customers");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const findCustomer = useCallback(
    (idOrPhone: string) => {
      return customers.find((c) => c.id === idOrPhone || c.phone === idOrPhone);
    },
    [customers]
  );

  return { customers, loading, error, isOfflineFallback, refetch: fetchCustomers, findCustomer };
}
