"use client";

import { useQuery } from "@tanstack/react-query";
import { listTopupCustomers, listTopupHistory } from "./api";
import { topupQueryKeys } from "./query-keys";
import type { CustomerListParams } from "./types";

export const useTopupCustomers = (params: CustomerListParams = {}) =>
  useQuery({
    queryKey: topupQueryKeys.customers(params),
    queryFn: () => listTopupCustomers(params),
  });

export const useTopupHistory = (customerId: string | null | undefined) =>
  useQuery({
    queryKey: topupQueryKeys.history(customerId || ""),
    queryFn: () => listTopupHistory(customerId!),
    enabled: Boolean(customerId),
  });
