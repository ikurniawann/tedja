"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { updatePaymentGateway } from "./api";
import { paymentGatewaysQueryKeys } from "./query-keys";
import type { UpdatePaymentGatewayPayload } from "./types";

export function useUpdatePaymentGateway() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdatePaymentGatewayPayload) => updatePaymentGateway(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: paymentGatewaysQueryKeys.all });
      toast.success("Payment gateway settings saved.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    },
  });
}
