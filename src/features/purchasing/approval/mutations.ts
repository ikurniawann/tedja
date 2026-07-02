"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { approvePRApproval, rejectPRApproval } from "./api";
import { approvalQueryKeys } from "./query-keys";
import { poQueryKeys } from "@/features/purchasing/po/query-keys";
import { prQueryKeys } from "@/features/purchasing/pr/query-keys";

export const useApprovePRApproval = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approvePRApproval(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalQueryKeys.pendingPRs });
      queryClient.invalidateQueries({ queryKey: prQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: poQueryKeys.approvedPRs });
    },
  });
};

export const useRejectPRApproval = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectPRApproval(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalQueryKeys.pendingPRs });
      queryClient.invalidateQueries({ queryKey: prQueryKeys.all });
    },
  });
};
