"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  deleteGrn,
  updateGrn,
  createGrn,
  createQCInspection,
  approveVendorCredit,
  type SubmitGrnQcPayload,
} from "./api";
import { grnQueryKeys } from "./query-keys";

export const useDeleteGrn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteGrn(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: grnQueryKeys.all });
    },
  });
};

export const useUpdateGrn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: unknown }) =>
      updateGrn(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: grnQueryKeys.all });
    },
  });
};

export const useCreateGrn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: unknown) => createGrn(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: grnQueryKeys.all });
    },
  });
};

export const useCreateQCInspection = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ grnId, payload }: { grnId: string; payload: SubmitGrnQcPayload }) =>
      createQCInspection(grnId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: grnQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: grnQueryKeys.detail(variables.grnId) });
      queryClient.invalidateQueries({ queryKey: grnQueryKeys.qc(variables.grnId) });
      queryClient.invalidateQueries({ queryKey: grnQueryKeys.vendorCredits(variables.grnId) });
    },
  });
};

export const useApproveVendorCredit = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ creditId }: { creditId: string; grnId: string }) =>
      approveVendorCredit(creditId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: grnQueryKeys.vendorCredits(variables.grnId) });
      queryClient.invalidateQueries({ queryKey: grnQueryKeys.detail(variables.grnId) });
      queryClient.invalidateQueries({ queryKey: ["purchasing", "vendor-payments"] });
      queryClient.invalidateQueries({ queryKey: ["purchasing", "po"] });
    },
  });
};
