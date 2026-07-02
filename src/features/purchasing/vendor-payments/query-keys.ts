import type { PurchaseInvoiceListParams } from "./types";

export const vendorPaymentsQueryKeys = {
  all: ["purchasing", "purchase-invoices"] as const,
  list: (params: PurchaseInvoiceListParams) =>
    ["purchasing", "purchase-invoices", "list", params] as const,
};
