export const productPrQueryKeys = {
  all: ["purchasing", "product-pr"] as const,
  list: (params: Record<string, unknown>) => ["purchasing", "product-pr", "list", params] as const,
  formData: () => ["purchasing", "product-pr", "form-data"] as const,
  detail: (id: string) => ["purchasing", "product-pr", "detail", id] as const,
};
