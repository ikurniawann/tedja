export const paymentGatewaysQueryKeys = {
  all: ["settings", "payment-gateways"] as const,
  list: () => [...paymentGatewaysQueryKeys.all, "list"] as const,
};
