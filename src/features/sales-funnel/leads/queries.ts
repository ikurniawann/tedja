"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createLead, deleteLead, fetchLeads, updateLead } from "./api";
import type { LeadFilters, LeadFormValues } from "./types";

export const leadQueryKeys = {
  all: ["sales-funnel", "leads"] as const,
  list: (filters: LeadFilters) => ["sales-funnel", "leads", filters] as const,
};

export const useLeads = (filters: LeadFilters) =>
  useQuery({
    queryKey: leadQueryKeys.list(filters),
    queryFn: () => fetchLeads(filters),
  });

export function useCreateLead(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: LeadFormValues) => createLead(values),
    onSuccess: () => {
      toast.success("Lead berhasil dibuat");
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateLead(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<LeadFormValues> }) =>
      updateLead(id, values),
    onSuccess: () => {
      toast.success("Lead diperbarui");
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteLead(id),
    onSuccess: () => {
      toast.success("Lead dihapus");
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.all });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
