export const approvalQueryKeys = {
  all: ["purchasing", "approval"] as const,
  pendingPRs: (moduleType?: "raw_material" | "product") =>
    ["purchasing", "approval", "pending-prs", moduleType ?? "raw_material"] as const,
};
