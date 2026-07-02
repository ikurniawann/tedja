import type { GrnListParams } from "./types";

export const grnQueryKeys = {
  all: ["purchasing", "grn"] as const,
  list: (params: GrnListParams) =>
    ["purchasing", "grn", "list", params] as const,
  detail: (id: string) => ["purchasing", "grn", "detail", id] as const,
  qc: (id: string) => ["purchasing", "grn", "qc", id] as const,
  vendorCredits: (id: string) => ["purchasing", "grn", "vendor-credits", id] as const,
  receivingWorkspace: ["purchasing", "grn", "receiving-workspace"] as const,
};
