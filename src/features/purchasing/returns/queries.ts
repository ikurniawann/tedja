"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { ReturnListParams } from "@/types/purchasing";
import { listReturnsPaged, getReturn, getReturnFormData, listReturnGrnOptions } from "./api";
import { returnsQueryKeys } from "./query-keys";

export const useReturnList = (params: ReturnListParams) =>
  useQuery({
    queryKey: returnsQueryKeys.list(params),
    queryFn: () => listReturnsPaged(params),
    placeholderData: keepPreviousData,
  });

export const useReturn = (id: string) =>
  useQuery({
    queryKey: returnsQueryKeys.detail(id),
    queryFn: () => getReturn(id),
    enabled: !!id,
  });

export const useReturnFormData = (
  grnId?: string | null,
  excludeReturnId?: string | null
) =>
  useQuery({
    queryKey: returnsQueryKeys.formData(grnId, excludeReturnId),
    queryFn: () => getReturnFormData(grnId, excludeReturnId),
    enabled: Boolean(grnId),
  });

export const useReturnGrnOptions = () =>
  useQuery({
    queryKey: returnsQueryKeys.grnOptions(),
    queryFn: () => listReturnGrnOptions(),
  });
