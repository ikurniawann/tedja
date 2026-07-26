import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import {
  GENERAL_ROUTES,
  PRODUCT_ROUTES,
  RM_ROUTES,
} from "@/modules/purchasing/constants/item-routes";
import {
  NAV_FROM_APPROVAL_PO,
  NAV_FROM_APPROVAL_PR,
  purchaseOrderDetailFromApproval,
  purchaseRequestDetailFromApproval,
} from "@/lib/iam/nav-context";

export function getApprovalModuleConfig(moduleType: PurchasingModuleType = "raw_material") {
  const isProduct = moduleType === "product";
  const isGeneral = moduleType === "general";
  // Product & general REUSE tabel vendors (label "Vendor", nama dari vendor_name);
  // raw_material memakai supplier (nama_supplier).
  const usesVendor = isProduct || isGeneral;
  const routes = isGeneral ? GENERAL_ROUTES : isProduct ? PRODUCT_ROUTES : RM_ROUTES;

  return {
    isProduct,
    isGeneral,
    routes,
    partyLabel: usesVendor ? "Vendor" : "Supplier",
    approvalPrRoute: routes.approvalPr,
    approvalPoRoute: routes.approvalPo,
    purchasingPrRoute: routes.purchasingPr,
    purchasingPoRoute: routes.purchasingPo,
    prDetailFromApproval: (id: string) =>
      purchaseRequestDetailFromApproval(routes.purchasingPrDetail(id), NAV_FROM_APPROVAL_PR),
    poDetailFromApproval: (id: string) =>
      purchaseOrderDetailFromApproval(routes.purchasingPoDetail(id), NAV_FROM_APPROVAL_PO),
    poPartyName: (po: { vendor_name?: string | null; nama_supplier?: string | null }) =>
      (usesVendor ? po.vendor_name : po.nama_supplier) || "-",
    approvePoDescription: (nomorPo: string) =>
      usesVendor
        ? `${nomorPo} will be approved and can be sent to the vendor.`
        : `${nomorPo} will be approved and can be sent to the supplier.`,
    emptyPoDescription: usesVendor
      ? "This purchase order will be approved and can be sent to the vendor."
      : "This purchase order will be approved and can be sent to the supplier.",
  };
}
