/** Pure helpers for user stall assignment — safe to import from client components. */

export function requiresStallAssignment(
  role: string | undefined,
  businessScope: string | null | undefined,
  isAccessApp: boolean
): boolean {
  if (!isAccessApp) return false;
  if (!role || role === "super_admin") return false;
  return businessScope === "branch";
}

export function shouldShowStallPicker(input: {
  isAccessApp: boolean;
  role: string | undefined;
  businessScope: string | null | undefined;
  branchId: string | null | undefined;
  isEdit?: boolean;
}): boolean {
  if (!input.isAccessApp) return false;
  if (input.businessScope !== "branch") return false;
  if (!input.branchId) return false;
  if (input.role === "super_admin" && !input.isEdit) return false;
  return true;
}

export function findBranchStallsFromTree(
  tree: { holdings: Array<{ companies: Array<{ branches: Array<{ id: string; warehouses: Array<{ id: string; name: string; code: string; is_active: boolean }> }> }> }> },
  branchId: string
) {
  for (const holding of tree.holdings) {
    for (const company of holding.companies) {
      for (const branch of company.branches) {
        if (branch.id !== branchId) continue;
        return branch.warehouses.filter((warehouse) => warehouse.is_active);
      }
    }
  }
  return [];
}
