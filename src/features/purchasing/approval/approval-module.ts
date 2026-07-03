import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { PRODUCT_ROUTES, RM_ROUTES } from "@/modules/purchasing/constants/item-routes";
import {
  NAV_FROM_APPROVAL_PO,
  NAV_FROM_APPROVAL_PR,
  purchaseOrderDetailFromApproval,
  purchaseRequestDetailFromApproval,
} from "@/lib/iam/nav-context";

export function getApprovalModuleConfig(moduleType: PurchasingModuleType = "raw_material") {
  const isProduct = moduleType === "product";
  const routes = isProduct ? PRODUCT_ROUTES : RM_ROUTES;

  return {
    isProduct,
    routes,
    partyLabel: isProduct ? "Vendor" : "Supplier",
    approvalPrRoute: routes.approvalPr,
    approvalPoRoute: routes.approvalPo,
    purchasingPrRoute: routes.purchasingPr,
    purchasingPoRoute: routes.purchasingPo,
    prDetailFromApproval: (id: string) =>
      purchaseRequestDetailFromApproval(routes.purchasingPrDetail(id), NAV_FROM_APPROVAL_PR),
    poDetailFromApproval: (id: string) =>
      purchaseOrderDetailFromApproval(routes.purchasingPoDetail(id), NAV_FROM_APPROVAL_PO),
    poPartyName: (po: { vendor_name?: string | null; nama_supplier?: string | null }) =>
      (isProduct ? po.vendor_name : po.nama_supplier) || "-",
    approvePoDescription: (nomorPo: string) =>
      isProduct
        ? `${nomorPo} will be approved and can be sent to the vendor.`
        : `${nomorPo} will be approved and can be sent to the supplier.`,
    emptyPoDescription: isProduct
      ? "This purchase order will be approved and can be sent to the vendor."
      : "This purchase order will be approved and can be sent to the supplier.",
  };
}
