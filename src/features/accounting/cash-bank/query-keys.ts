export const cashBankQueryKeys = {
  all: ["accounting", "cash-bank"] as const,
  list: () => [...cashBankQueryKeys.all, "list"] as const,
  ledger: (accountId: string, filters?: Record<string, string | undefined>) =>
    [...cashBankQueryKeys.all, "ledger", accountId, filters ?? {}] as const,
};
