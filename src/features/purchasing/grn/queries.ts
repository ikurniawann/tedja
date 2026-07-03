"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { GrnListParams } from "./types";
import { listGrns, getGrn, getGrnQC, getReceivingWorkspace, getGrnVendorCredits } from "./api";
import { grnQueryKeys } from "./query-keys";

export const useGrnList = (params: GrnListParams) =>
  useQuery({
    queryKey: grnQueryKeys.list(params),
    queryFn: () => listGrns(params),
    placeholderData: keepPreviousData,
  });

export const useGrn = <T = unknown>(id: string) =>
  useQuery({
    queryKey: grnQueryKeys.detail(id),
    queryFn: () => getGrn<T>(id),
    enabled: !!id,
  });

export const useGrnQC = <T = unknown>(id: string) =>
  useQuery({
    queryKey: grnQueryKeys.qc(id),
    queryFn: () => getGrnQC<T>(id),
    enabled: !!id,
  });

export const useGrnVendorCredits = (id: string) =>
  useQuery({
    queryKey: grnQueryKeys.vendorCredits(id),
    queryFn: () => getGrnVendorCredits(id),
    enabled: !!id,
  });

export const useReceivingWorkspace = (moduleType?: "raw_material" | "product") =>
  useQuery({
    queryKey: grnQueryKeys.receivingWorkspace(moduleType),
    queryFn: () => getReceivingWorkspace(moduleType),
  });
