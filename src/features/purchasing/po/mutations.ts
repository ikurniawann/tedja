"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  PurchaseOrderFormData,
  VendorPayment,
} from "@/types/purchasing";
import {
  createPurchaseOrder,
  convertPRToPurchaseOrder,
  approvePurchaseOrder,
  sendPurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrderPaymentTerm,
  deletePurchaseOrderPaymentTerm,
  createVendorPayment,
} from "./api";
import { poQueryKeys } from "./query-keys";
import { vendorPaymentsQueryKeys } from "@/features/purchasing/vendor-payments/query-keys";

export const useCreatePurchaseOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PurchaseOrderFormData) => createPurchaseOrder(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: poQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: poQueryKeys.approvedPRs });
    },
  });
};

export const useConvertPRToPurchaseOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, payload }: { prId: string; payload: PurchaseOrderFormData }) =>
      convertPRToPurchaseOrder(prId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: poQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: poQueryKeys.approvedPRs });
    },
  });
};

export const useApprovePurchaseOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approvePurchaseOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: poQueryKeys.all });
    },
  });
};

export const useSendPurchaseOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      sentVia,
    }: {
      id: string;
      sentVia: "EMAIL" | "WHATSAPP" | "PRINT" | "OTHER";
    }) => sendPurchaseOrder(id, sentVia),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: poQueryKeys.all });
    },
  });
};

export const useCancelPurchaseOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      cancelPurchaseOrder(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: poQueryKeys.all });
    },
  });
};

export const useCreatePOPaymentTerm = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      poId,
      payload,
    }: {
      poId: string;
      payload: {
        term_no?: number;
        description: string;
        due_date: string;
        amount: number;
        notes?: string | null;
      };
    }) => createPurchaseOrderPaymentTerm(poId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: poQueryKeys.payments(variables.poId) });
      queryClient.invalidateQueries({ queryKey: poQueryKeys.detail(variables.poId) });
    },
  });
};

export const useDeletePOPaymentTerm = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, termId }: { poId: string; termId: string }) =>
      deletePurchaseOrderPaymentTerm(poId, termId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: poQueryKeys.payments(variables.poId) });
      queryClient.invalidateQueries({ queryKey: poQueryKeys.detail(variables.poId) });
    },
  });
};

export const useCreateVendorPayment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      poId,
      payload,
    }: {
      poId: string;
      payload: {
        payment_term_id?: string | null;
        payment_date?: string;
        amount: number;
        method: VendorPayment["method"];
        reference_number?: string | null;
        notes?: string | null;
      };
    }) => createVendorPayment(poId, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: poQueryKeys.payments(variables.poId) });
      queryClient.invalidateQueries({ queryKey: poQueryKeys.detail(variables.poId) });
      queryClient.invalidateQueries({ queryKey: poQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: vendorPaymentsQueryKeys.all });
    },
  });
};
