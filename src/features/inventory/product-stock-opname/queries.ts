"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { ProductStockOpnameListParams } from "./types";
import {
  getProductStockOpname,
  listProductStockOpnamePreview,
  listProductStockOpnames,
} from "./api";
import { productStockOpnameQueryKeys } from "./query-keys";

export const useProductStockOpnameList = (params: ProductStockOpnameListParams) =>
  useQuery({
    queryKey: productStockOpnameQueryKeys.list(params),
    queryFn: () => listProductStockOpnames(params),
    placeholderData: keepPreviousData,
  });

export const useProductStockOpname = (id: string) =>
  useQuery({
    queryKey: productStockOpnameQueryKeys.detail(id),
    queryFn: () => getProductStockOpname(id),
    enabled: !!id,
  });

export const useProductStockOpnamePreview = (enabled = true) =>
  useQuery({
    queryKey: productStockOpnameQueryKeys.preview(),
    queryFn: listProductStockOpnamePreview,
    enabled,
  });
