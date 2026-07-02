"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listPurchaseInvoices } from "./api";
import { vendorPaymentsQueryKeys } from "./query-keys";
import type { PurchaseInvoiceListParams } from "./types";

export const usePurchaseInvoiceList = (params: PurchaseInvoiceListParams) =>
  useQuery({
    queryKey: vendorPaymentsQueryKeys.list(params),
    queryFn: () => listPurchaseInvoices(params),
    placeholderData: keepPreviousData,
  });

/** @deprecated Use usePurchaseInvoiceList */
export const useVendorPaymentList = usePurchaseInvoiceList;
