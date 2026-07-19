"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { kpiQueryKeys } from "./query-keys";
import {
  createKpiTarget,
  deleteKpiTarget,
  runKpiSnapshotApi,
  saveKpiRubric,
  updateScorecardStatus,
} from "./api";
import type { CreateKpiTargetPayload, SaveRubricPayload } from "./types";

function useInvalidateKpi() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: kpiQueryKeys.all });
}

export function useRunKpiSnapshot() {
  const invalidate = useInvalidateKpi();
  return useMutation({
    mutationFn: (payload: { period_month: number; period_year: number }) =>
      runKpiSnapshotApi(payload),
    onSuccess: invalidate,
  });
}

export function useSaveKpiRubric() {
  const invalidate = useInvalidateKpi();
  return useMutation({
    mutationFn: (payload: SaveRubricPayload) => saveKpiRubric(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateScorecardStatus() {
  const invalidate = useInvalidateKpi();
  return useMutation({
    mutationFn: (payload: { action: "finalize" | "reopen"; scorecard_id: string }) =>
      updateScorecardStatus(payload),
    onSuccess: invalidate,
  });
}

export function useCreateKpiTarget() {
  const invalidate = useInvalidateKpi();
  return useMutation({
    mutationFn: (payload: CreateKpiTargetPayload) => createKpiTarget(payload),
    onSuccess: invalidate,
  });
}

export function useDeleteKpiTarget() {
  const invalidate = useInvalidateKpi();
  return useMutation({
    mutationFn: (id: string) => deleteKpiTarget(id),
    onSuccess: invalidate,
  });
}
