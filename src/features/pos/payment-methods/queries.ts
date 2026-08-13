"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchPaymentMethods, updatePaymentMethod } from "./api";

export const paymentMethodKeys = {
  all: ["pos", "payment-methods"] as const,
  active: ["pos", "payment-methods", "active"] as const,
};

export function usePaymentMethods(activeOnly = false) {
  return useQuery({
    queryKey: activeOnly ? paymentMethodKeys.active : paymentMethodKeys.all,
    queryFn: () => fetchPaymentMethods(activeOnly),
    staleTime: 30_000,
  });
}

export function useUpdatePaymentMethod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatePaymentMethod,
    onSuccess: async () => {
      toast.success("Metode bayar diperbarui");
      await queryClient.invalidateQueries({ queryKey: paymentMethodKeys.all });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
