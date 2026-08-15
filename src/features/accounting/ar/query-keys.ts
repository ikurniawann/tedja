export const arKeys = {
  all: ["accounting", "ar"] as const,
  invoices: (f?: Record<string, unknown>) =>
    [...arKeys.all, "invoices", f ?? {}] as const,
  receipts: (f?: Record<string, unknown>) =>
    [...arKeys.all, "receipts", f ?? {}] as const,
  receivable: () => [...arKeys.all, "receivable"] as const,
  aging: (asOf?: string) => [...arKeys.all, "aging", asOf ?? ""] as const,
};
