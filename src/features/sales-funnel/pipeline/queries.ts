"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createDeal,
  createDealPayment,
  deleteDeal,
  deleteDealPayment,
  fetchDealPayments,
  fetchDeals,
  fetchLostReasons,
  fetchStages,
  updateDeal,
  updateStage,
  type CreatePaymentValues,
} from "./api";
import type {
  DealFilters,
  DealFormValues,
  DealUpdatePayload,
  SalesDeal,
  SalesStage,
  StageUpdatePayload,
} from "./types";

export const pipelineQueryKeys = {
  all: ["sales-funnel", "pipeline"] as const,
  stages: (all: boolean) => ["sales-funnel", "pipeline", "stages", all] as const,
  lostReasons: ["sales-funnel", "pipeline", "lost-reasons"] as const,
  deals: (filters: DealFilters) =>
    ["sales-funnel", "pipeline", "deals", filters] as const,
  payments: (dealId: string) =>
    ["sales-funnel", "pipeline", "payments", dealId] as const,
};

export const useDealPayments = (dealId: string, enabled: boolean) =>
  useQuery({
    queryKey: pipelineQueryKeys.payments(dealId),
    queryFn: () => fetchDealPayments(dealId),
    enabled: enabled && dealId !== "",
  });

export const useCreateDealPayment = (dealId: string, onSuccess?: () => void) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CreatePaymentValues) => createDealPayment(dealId, values),
    onSuccess: () => {
      toast.success("Pembayaran tercatat");
      queryClient.invalidateQueries({
        queryKey: pipelineQueryKeys.payments(dealId),
      });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
};

export const useDeleteDealPayment = (dealId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: string) => deleteDealPayment(dealId, paymentId),
    onSuccess: () => {
      toast.success("Catatan pembayaran dihapus");
      queryClient.invalidateQueries({
        queryKey: pipelineQueryKeys.payments(dealId),
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });
};

export const useStages = (all = false) =>
  useQuery({
    queryKey: pipelineQueryKeys.stages(all),
    queryFn: () => fetchStages(all),
    staleTime: 5 * 60 * 1000,
  });

export const useLostReasons = () =>
  useQuery({
    queryKey: pipelineQueryKeys.lostReasons,
    queryFn: fetchLostReasons,
    staleTime: 5 * 60 * 1000,
  });

export const useDeals = (filters: DealFilters) =>
  useQuery({
    queryKey: pipelineQueryKeys.deals(filters),
    queryFn: () => fetchDeals(filters),
  });

export function useCreateDeal(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: DealFormValues) => createDeal(values),
    onSuccess: () => {
      toast.success("Deal berhasil dibuat");
      queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.all });
      // status lead bisa ikut berubah (baru/dihubungi → qualified)
      queryClient.invalidateQueries({ queryKey: ["sales-funnel", "leads"] });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

/**
 * Update deal dengan optimistic update pada cache kanban aktif — kartu
 * langsung pindah kolom saat drag, rollback bila API menolak (pola
 * useUpdateCandidateStage pipeline HRIS).
 */
export function useUpdateDeal(filters: DealFilters, onSuccess?: () => void) {
  const queryClient = useQueryClient();
  const dealsKey = pipelineQueryKeys.deals(filters);
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: DealUpdatePayload }) =>
      updateDeal(id, values),
    onMutate: async ({ id, values }) => {
      await queryClient.cancelQueries({ queryKey: dealsKey });
      const previous = queryClient.getQueryData<SalesDeal[]>(dealsKey);
      if (values.stage_id) {
        // Sinkronkan juga atribut tahap tujuan dari cache stages agar
        // statistik header (deal berjalan/nilai pipeline) tidak sempat basi
        const stages = queryClient.getQueryData<SalesStage[]>(
          pipelineQueryKeys.stages(false)
        );
        const target = stages?.find((s) => s.id === values.stage_id);
        const isClosing = Boolean(target?.is_won || target?.is_lost);
        queryClient.setQueryData<SalesDeal[]>(dealsKey, (old) =>
          (old ?? []).map((deal) =>
            deal.id === id
              ? {
                  ...deal,
                  stage_id: values.stage_id as string,
                  entered_stage_at: new Date().toISOString(),
                  ...(target
                    ? {
                        stage_code: target.code,
                        is_won: target.is_won,
                        is_lost: target.is_lost,
                        stuck_threshold_days: target.stuck_threshold_days,
                        closed_at: isClosing ? new Date().toISOString() : null,
                      }
                    : {}),
                }
              : deal
          )
        );
      }
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(dealsKey, context.previous);
      toast.error(error.message);
    },
    onSuccess: () => {
      onSuccess?.();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.all });
    },
  });
}

export function useDeleteDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDeal(id),
    onSuccess: () => {
      toast.success("Deal dihapus");
      queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.all });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateStage(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: StageUpdatePayload }) =>
      updateStage(id, values),
    onSuccess: () => {
      toast.success("Tahap diperbarui");
      queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
