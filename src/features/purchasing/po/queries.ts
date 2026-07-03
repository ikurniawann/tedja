"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { POListParams } from "@/types/purchasing";
import {
  listPurchaseOrders,
  getPurchaseOrder,
  getPurchaseOrderPaymentTerms,
  getPOFormData,
  listApprovedPRsForPO,
} from "./api";
import { poQueryKeys } from "./query-keys";

export const usePurchaseOrderList = (params: POListParams) =>
  useQuery({
    queryKey: poQueryKeys.list(params),
    queryFn: () => listPurchaseOrders(params),
    placeholderData: keepPreviousData,
  });

export const usePurchaseOrder = (id: string) =>
  useQuery({
    queryKey: poQueryKeys.detail(id),
    queryFn: () => getPurchaseOrder(id),
    enabled: !!id,
  });

export const usePurchaseOrderPayments = (id: string) =>
  useQuery({
    queryKey: poQueryKeys.payments(id),
    queryFn: () => getPurchaseOrderPaymentTerms(id),
    enabled: !!id,
  });

export const usePOFormData = () =>
  useQuery({
    queryKey: poQueryKeys.formData,
    queryFn: getPOFormData,
  });

export const useApprovedPRsForPO = () =>
  useQuery({
    queryKey: poQueryKeys.approvedPRs,
    queryFn: listApprovedPRsForPO,
    staleTime: 0,
    refetchOnMount: "always",
  });
