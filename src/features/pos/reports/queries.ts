"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  getProfitReport,
  getClosingReport,
  getTransactionReport,
  getProductSalesReport,
  getRushHourReport,
  getVoidReport,
} from "./api";
import { reportsQueryKeys } from "./query-keys";
import type {
  ProfitReportParams,
  ClosingReportParams,
  TransactionReportParams,
  ProductSalesReportParams,
  RushHourReportParams,
  VoidReportParams,
} from "./types";

export const useProfitReport = (params: ProfitReportParams) =>
  useQuery({
    queryKey: reportsQueryKeys.profit(params),
    queryFn: () => getProfitReport(params),
    placeholderData: keepPreviousData,
    enabled: Boolean(params.date_from && params.date_to),
  });

export const useClosingReport = (params: ClosingReportParams) =>
  useQuery({
    queryKey: reportsQueryKeys.closing(params),
    queryFn: () => getClosingReport(params),
    placeholderData: keepPreviousData,
    enabled: Boolean(params.date),
  });

export const useTransactionReport = (params: TransactionReportParams) =>
  useQuery({
    queryKey: reportsQueryKeys.transactions(params),
    queryFn: () => getTransactionReport(params),
    placeholderData: keepPreviousData,
    enabled: Boolean(params.date_from && params.date_to),
  });

export const useProductSalesReport = (params: ProductSalesReportParams) =>
  useQuery({
    queryKey: reportsQueryKeys.productSales(params),
    queryFn: () => getProductSalesReport(params),
    placeholderData: keepPreviousData,
    enabled: Boolean(params.date_from && params.date_to),
  });

export const useRushHourReport = (params: RushHourReportParams) =>
  useQuery({
    queryKey: reportsQueryKeys.rushHour(params),
    queryFn: () => getRushHourReport(params),
    placeholderData: keepPreviousData,
    enabled: Boolean(params.date_from && params.date_to),
  });

export const useVoidReport = (params: VoidReportParams) =>
  useQuery({
    queryKey: reportsQueryKeys.voids(params),
    queryFn: () => getVoidReport(params),
    placeholderData: keepPreviousData,
    enabled: Boolean(params.date_from && params.date_to),
  });