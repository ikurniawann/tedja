"use client";

import { useQuery } from "@tanstack/react-query";
import { listPaymentGateways } from "./api";
import { paymentGatewaysQueryKeys } from "./query-keys";

export function usePaymentGateways() {
  return useQuery({
    queryKey: paymentGatewaysQueryKeys.list(),
    queryFn: listPaymentGateways,
  });
}
