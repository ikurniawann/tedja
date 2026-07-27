"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  getSupplierPerformance,
  getHppBreakdown,
  getPoSummary,
  getStockCard,
  getInventoryValuation,
  getPoDetailReport,
  getProductionInHouseReport,
} from "./api";
import { reportsQueryKeys } from "./query-keys";
import type {
  InventoryValuationParams,
  PODetailParams,
  POSummaryParams,
  ProductionInHouseParams,
  StockCardParams,
} from "./types";

export const useSupplierPerformance = (params: {
  date_from?: string;
  date_to?: string;
  supplier_id?: string;
}) =>
  useQuery({
    queryKey: reportsQueryKeys.supplierPerformance(params),
    queryFn: () => getSupplierPerformance(params),
    placeholderData: keepPreviousData,
  });

export const useHppBreakdown = () =>
  useQuery({
    queryKey: reportsQueryKeys.hppBreakdown,
    queryFn: getHppBreakdown,
  });

export const usePoSummary = (params: POSummaryParams) =>
  useQuery({
    queryKey: reportsQueryKeys.poSummary(params),
    queryFn: () => getPoSummary(params),
    placeholderData: keepPreviousData,
  });

export const useStockCard = (params: StockCardParams, enabled = true) =>
  useQuery({
    queryKey: reportsQueryKeys.stockCard(params),
    queryFn: () => getStockCard(params),
    enabled,
    placeholderData: keepPreviousData,
  });

export const useInventoryValuation = (params: InventoryValuationParams) =>
  useQuery({
    queryKey: reportsQueryKeys.inventoryValuation(params),
    queryFn: () => getInventoryValuation(params),
    placeholderData: keepPreviousData,
  });

export const usePoDetailReport = (params: PODetailParams) =>
  useQuery({
    queryKey: reportsQueryKeys.poDetail(params),
    queryFn: () => getPoDetailReport(params),
    placeholderData: keepPreviousData,
  });

export const useProductionInHouseReport = (params: ProductionInHouseParams) =>
  useQuery({
    queryKey: reportsQueryKeys.productionInHouse(params),
    queryFn: () => getProductionInHouseReport(params),
    placeholderData: keepPreviousData,
  });
