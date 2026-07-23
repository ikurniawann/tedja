"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { approvePRApproval, rejectPRApproval } from "./api";
import { approvalQueryKeys } from "./query-keys";
import { poQueryKeys } from "@/features/purchasing/po/query-keys";
import { prQueryKeys } from "@/features/purchasing/pr/query-keys";

import { productPrQueryKeys } from "@/features/purchasing/product-pr/query-keys";
import { productPoQueryKeys } from "@/features/purchasing/product-po/query-keys";

export const useApprovePRApproval = (moduleType: "raw_material" | "product" | "general" = "raw_material") => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approvePRApproval(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalQueryKeys.pendingPRs(moduleType) });
      queryClient.invalidateQueries({ queryKey: prQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: poQueryKeys.approvedPRs });
      if (moduleType === "product") {
        queryClient.invalidateQueries({ queryKey: productPrQueryKeys.all });
        queryClient.invalidateQueries({ queryKey: productPoQueryKeys.approvedPRs() });
      }
    },
  });
};

export const useRejectPRApproval = (moduleType: "raw_material" | "product" | "general" = "raw_material") => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectPRApproval(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalQueryKeys.pendingPRs(moduleType) });
      queryClient.invalidateQueries({ queryKey: prQueryKeys.all });
      if (moduleType === "product") {
        queryClient.invalidateQueries({ queryKey: productPrQueryKeys.all });
      }
    },
  });
};
