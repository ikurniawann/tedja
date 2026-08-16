import type { KdsListParams } from "./types";

export const kdsQueryKeys = {
  all: ["pos", "kds"] as const,
  list: (params: KdsListParams) => ["pos", "kds", "list", params] as const,
  stalls: ["pos", "kds", "stalls"] as const,
};
