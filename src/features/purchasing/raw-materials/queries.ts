"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { RawMaterialListParams } from "@/types/purchasing";
import {
  listRawMaterials,
  getRawMaterial,
  getRawMaterialPriceHistory,
  listUnits,
} from "@/lib/purchasing";
import { listActiveItemsLookup } from "@/features/purchasing/items/api";
import { rawMaterialsQueryKeys } from "./query-keys";

export const useRawMaterialList = (params: RawMaterialListParams) =>
  useQuery({
    queryKey: rawMaterialsQueryKeys.list(params),
    queryFn: () => listRawMaterials(params),
    placeholderData: keepPreviousData,
  });

export const useRawMaterial = (id: string) =>
  useQuery({
    queryKey: rawMaterialsQueryKeys.detail(id),
    queryFn: () => getRawMaterial(id),
    enabled: !!id,
  });

export const useRawMaterialPriceHistory = (id: string, months = 12) =>
  useQuery({
    queryKey: rawMaterialsQueryKeys.priceHistory(id, months),
    queryFn: () => getRawMaterialPriceHistory(id, { months }),
    enabled: !!id,
  });

export const useRawMaterialUnits = () =>
  useQuery({
    queryKey: rawMaterialsQueryKeys.units(),
    queryFn: async () => (await listUnits()).data || [],
  });

export const useRawMaterialCategoryOptions = () =>
  useQuery({
    queryKey: rawMaterialsQueryKeys.categories(),
    queryFn: () => listActiveItemsLookup("raw-material-categories"),
  });
