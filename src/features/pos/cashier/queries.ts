"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getCashierCheckout,
  getCashierOrder,
  listCashierTables,
  listCustomerFavoriteProducts,
} from "./api";
import { cashierQueryKeys } from "./query-keys";
import type { Product } from "./api";

export const useCashierTables = () =>
  useQuery({
    queryKey: cashierQueryKeys.tables(),
    queryFn: listCashierTables,
    // Restaurant board must refresh after cashier handoff returns.
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

export const useCashierOrder = (orderId: string | null) =>
  useQuery({
    queryKey: cashierQueryKeys.order(orderId ?? ""),
    queryFn: () => getCashierOrder(orderId!),
    enabled: !!orderId,
  });

export const useCashierCheckout = (checkoutId: string | null) =>
  useQuery({
    queryKey: cashierQueryKeys.checkout(checkoutId ?? ""),
    queryFn: () => getCashierCheckout(checkoutId!),
    enabled: !!checkoutId,
  });

export const useCustomerFavoriteProducts = (
  customerId: string | null | undefined,
  products: Product[]
) =>
  useQuery({
    queryKey: cashierQueryKeys.favorites(customerId ?? ""),
    queryFn: () => listCustomerFavoriteProducts(customerId!, products),
    enabled: !!customerId && products.length > 0,
  });
