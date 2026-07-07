"use client";

import { useQuery } from "@tanstack/react-query";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import {
  getProductionDashboard,
  getProductionCogs,
  listRecipeItems,
  getProductionOrder,
  getRawMaterialBomEditorData,
} from "./api";
import { productionQueryKeys } from "./query-keys";

function contextKey(moduleType: PurchasingModuleType) {
  return moduleType === "product" ? "product" : "raw_material";
}

export const useProductionDashboard = (moduleType: PurchasingModuleType = "raw_material") =>
  useQuery({
    queryKey: productionQueryKeys.dashboard(contextKey(moduleType)),
    queryFn: () => getProductionDashboard(moduleType),
    staleTime: 0,
  });

export const useProductionCogs = (
  moduleType: PurchasingModuleType,
  itemId: string,
  enabled = true
) =>
  useQuery({
    queryKey: productionQueryKeys.cogs(contextKey(moduleType), itemId),
    queryFn: () => getProductionCogs(moduleType, itemId),
    enabled: enabled && !!itemId,
  });

/** @deprecated Use useProductionCogs */
export const useProductCogs = (productId: string, enabled = true) =>
  useProductionCogs("product", productId, enabled);

export const useRecipeItems = (moduleType: PurchasingModuleType = "raw_material") =>
  useQuery({
    queryKey: productionQueryKeys.recipeItems(contextKey(moduleType)),
    queryFn: () => listRecipeItems(moduleType),
  });

export const useRawMaterialBomEditorData = (materialId: string) =>
  useQuery({
    queryKey: productionQueryKeys.rmBomEditorData(materialId),
    queryFn: () => getRawMaterialBomEditorData(materialId),
    enabled: !!materialId,
  });

/** @deprecated Use useRecipeItems */
export const useRecipeProducts = () => useRecipeItems("product");

export const useProductionOrder = <T = unknown>(id: string) =>
  useQuery({
    queryKey: productionQueryKeys.order(id),
    queryFn: () => getProductionOrder<T>(id),
    enabled: !!id,
  });
