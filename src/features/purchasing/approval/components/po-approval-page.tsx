"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { RM_ROUTES } from "@/modules/purchasing/constants/item-routes";
import {
  NAV_FROM_APPROVAL_PO,
  persistNavFrom,
  purchaseOrderDetailFromApproval,
} from "@/lib/iam/nav-context";
import { CheckCircle, Eye, Loader2, ShoppingCart } from "lucide-react";
import { formatAmount, formatDate } from "@/lib/purchasing/utils";
import { usePurchaseOrderList } from "../../po/queries";
import { useApprovePurchaseOrder } from "../../po/mutations";
import type { PurchaseOrder } from "@/types/purchasing";

const DRAFT_STATUS_STYLE = "border-gray-200 bg-gray-50 text-gray-700";

export function POApprovalPage() {
  const router = useRouter();
  const [confirmingPO, setConfirmingPO] = useState<PurchaseOrder | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const listQuery = usePurchaseOrderList({ status: "draft", page: 1, limit: 50 });
  const pos = listQuery.data?.data ?? [];
  const loading = listQuery.isLoading;

  const approveMutation = useApprovePurchaseOrder();
  const isProcessing = Boolean(processingId);

  useEffect(() => {
    if (listQuery.isError) {
      toast.error(
        listQuery.error instanceof Error
          ? listQuery.error.message
          : "Failed to load purchase order approvals"
      );
    }
  }, [listQuery.isError, listQuery.error]);

  function poDetailHref(id: string) {
    persistNavFrom(NAV_FROM_APPROVAL_PO);
    return purchaseOrderDetailFromApproval(RM_ROUTES.purchasingPoDetail(id));
  }

  async function approvePO() {
    if (!confirmingPO) return;
    setProcessingId(confirmingPO.id);
    try {
      await approveMutation.mutateAsync(confirmingPO.id);
      toast.success("Purchase order approved");
      setConfirmingPO(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to approve purchase order");
    } finally {
      setProcessingId(null);
    }
  }

  function closeDialog() {
    if (isProcessing) return;
    setConfirmingPO(null);
  }

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Purchase Order Approval"
        description="Review supplier, pricing, tax, and final totals before the order is sent."
        actions={
          <Link href={RM_ROUTES.purchasingPo}>
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              View All Purchase Orders
            </Button>
          </Link>
        }
      />

      <PurchasingListSection
        icon={ShoppingCart}
        title="Pending Approvals"
        description="Draft purchase orders waiting for approval before supplier dispatch."
      >
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-pink-600" />
            Loading approvals...
          </div>
        ) : pos.length === 0 ? (
          <div className="py-14 text-center">
            <CheckCircle className="mx-auto mb-3 h-12 w-12 text-emerald-300" />
            <p className="text-gray-500">No purchase orders pending approval</p>
            <p className="mt-1 text-sm text-gray-400">You&apos;re all caught up.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Number</th>
                    <th className="px-4 py-3 text-left font-semibold">Date</th>
                    <th className="px-4 py-3 text-left font-semibold">Supplier</th>
                    <th className="px-4 py-3 text-left font-semibold">Purchase Request</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pos.map((po) => {
                    const rowProcessing = processingId === po.id;

                    return (
                      <tr
                        key={po.id}
                        className="cursor-pointer hover:bg-gray-50/80"
                        onClick={() => router.push(poDetailHref(po.id))}
                      >
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">{po.nomor_po}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{formatDate(po.tanggal_po)}</td>
                        <td className="px-4 py-3 text-gray-600">{po.nama_supplier || "-"}</td>
                        <td className="px-4 py-3 text-gray-600">{po.pr_number || "-"}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          {formatAmount(po.grand_total || po.total || po.subtotal || 0)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="outline" className={DRAFT_STATUS_STYLE}>
                            Draft
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(event) => event.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            <Link href={poDetailHref(po.id)}>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="View detail"
                                className="cursor-pointer"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Approve"
                              className="cursor-pointer"
                              onClick={() => setConfirmingPO(po)}
                              disabled={rowProcessing}
                            >
                              {rowProcessing ? (
                                <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                              ) : (
                                <CheckCircle className="h-4 w-4 text-emerald-600" />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-200/70 px-4 py-3 text-sm text-gray-500">
              Showing {pos.length} pending purchase order{pos.length === 1 ? "" : "s"}
            </div>
          </>
        )}
      </PurchasingListSection>

      <Dialog open={confirmingPO !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Approve Purchase Order?</DialogPanelTitle>
            <DialogPanelDescription>
              {confirmingPO
                ? `${confirmingPO.nomor_po} will be approved and can be sent to the supplier.`
                : "This purchase order will be approved and can be sent to the supplier."}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody />
          <DialogFooter className="px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="purchasing-secondary-button"
              onClick={closeDialog}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="purchasing-main-button"
              onClick={approvePO}
              disabled={isProcessing}
            >
              {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isProcessing ? "Approving..." : "Approve"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
