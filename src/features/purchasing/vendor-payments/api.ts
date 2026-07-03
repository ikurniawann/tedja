import type { PurchaseInvoiceListParams, PurchaseInvoiceRow } from "./types";

export type * from "./types";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      response.ok
        ? "Invalid response from server"
        : `Request failed (${response.status})`
    );
  }
}

export async function listPurchaseInvoices(
  params: PurchaseInvoiceListParams = {},
  moduleType: PurchaseInvoiceListParams["module_type"] = "raw_material"
): Promise<PurchaseInvoiceRow[]> {
  const sp = new URLSearchParams();
  if (params.search) sp.set("search", params.search);
  if (params.status && params.status !== "all") sp.set("status", params.status);
  if (moduleType === "product") sp.set("module_type", "product");

  const response = await fetch(`/api/purchasing/vendor-payments?${sp.toString()}`);
  const result = await parseJsonResponse<{ success?: boolean; message?: string; data?: PurchaseInvoiceRow[] }>(
    response
  );

  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to load purchase invoices");
  }

  return result.data || [];
}

/** @deprecated Use listPurchaseInvoices */
export const listVendorPayments = listPurchaseInvoices;
