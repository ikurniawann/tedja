import type {
  ProfitReportParams,
  ClosingReportParams,
  TransactionReportParams,
  ProductSalesReportParams,
  RushHourReportParams,
} from "./types";

export const reportsQueryKeys = {
  all: ["pos", "reports"] as const,
  profit: (params: ProfitReportParams) => ["pos", "reports", "profit", params] as const,
  closing: (params: ClosingReportParams) => ["pos", "reports", "closing", params] as const,
  transactions: (params: TransactionReportParams) =>
    ["pos", "reports", "transactions", params] as const,
  productSales: (params: ProductSalesReportParams) =>
    ["pos", "reports", "product-sales", params] as const,
  rushHour: (params: RushHourReportParams) =>
    ["pos", "reports", "rush-hour", params] as const,
};
