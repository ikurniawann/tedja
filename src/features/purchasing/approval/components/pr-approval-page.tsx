"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { purchaseRequestDetailFromApproval, persistNavFrom, NAV_FROM_APPROVAL_PR } from "@/lib/iam/nav-context";
import { CheckCircle, Eye, FileText, Loader2, XCircle } from "lucide-react";
import { formatAmount, formatDate, getPriorityBadge, getPRStatusLabel } from "@/lib/purchasing/utils";
import { usePendingPRApprovals } from "../queries";
import { useApprovePRApproval, useRejectPRApproval } from "../mutations";
import type { ApprovalPR } from "../types";

const PR_STATUS_LABEL_OVERRIDES: Record<string, string> = {
  rejected: "Rejected",
  converted: "Purchase Order Created",
};

const PR_STATUS_STYLES: Record<string, string> = {
  draft: "border-gray-200 bg-gray-50 text-gray-700",
  pending_head: "border-amber-200 bg-amber-50 text-amber-700",
  pending_finance: "border-orange-200 bg-orange-50 text-orange-700",
  pending_direksi: "border-orange-200 bg-orange-50 text-orange-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
  converted: "border-blue-200 bg-blue-50 text-blue-700",
};

const PRIORITY_STYLES: Record<string, string> = {
  low: "border-gray-200 bg-gray-50 text-gray-600",
  medium: "border-blue-200 bg-blue-50 text-blue-700",
  high: "border-orange-200 bg-orange-50 text-orange-700",
  urgent: "border-red-200 bg-red-50 text-red-700",
};

type ProcessingState = {
  id: string;
  action: "approve" | "reject";
};

export function PRApprovalPage() {
  const router = useRouter();
  const [confirmingPR, setConfirmingPR] = useState<ApprovalPR | null>(null);
  const [rejectingPR, setRejectingPR] = useState<ApprovalPR | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [processing, setProcessing] = useState<ProcessingState | null>(null);

  const listQuery = usePendingPRApprovals();
  const prs = listQuery.data ?? [];
  const loading = listQuery.isLoading;

  const approveMutation = useApprovePRApproval();
  const rejectMutation = useRejectPRApproval();
  const isProcessing = Boolean(processing);

  useEffect(() => {
    if (listQuery.isError) {
      toast.error(
        listQuery.error instanceof Error
          ? listQuery.error.message
          : "Failed to load purchase request approvals"
      );
    }
  }, [listQuery.isError, listQuery.error]);

  async function approvePR() {
    if (!confirmingPR) return;
    setProcessing({ id: confirmingPR.id, action: "approve" });
    try {
      await approveMutation.mutateAsync(confirmingPR.id);
      toast.success("Purchase request approved");
      setConfirmingPR(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to approve purchase request");
    } finally {
      setProcessing(null);
    }
  }

  async function rejectPR() {
    if (!rejectingPR) return;
    if (!rejectionReason.trim()) {
      toast.error("Rejection reason is required");
      return;
    }

    setProcessing({ id: rejectingPR.id, action: "reject" });
    try {
      await rejectMutation.mutateAsync({ id: rejectingPR.id, reason: rejectionReason.trim() });
      toast.success("Purchase request rejected");
      setRejectingPR(null);
      setRejectionReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reject purchase request");
    } finally {
      setProcessing(null);
    }
  }

  function closeApproveDialog() {
    if (isProcessing) return;
    setConfirmingPR(null);
  }

  function closeRejectDialog() {
    if (isProcessing) return;
    setRejectingPR(null);
    setRejectionReason("");
  }

  function prDetailHref(id: string) {
    persistNavFrom(NAV_FROM_APPROVAL_PR);
    return purchaseRequestDetailFromApproval(RM_ROUTES.purchasingPrDetail(id));
  }

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Purchase Request Approval"
        description="Review and approve item requirements before procurement proceeds."
        actions={
          <Link href={RM_ROUTES.purchasingPr}>
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              View All Purchase Requests
            </Button>
          </Link>
        }
      />

      <PurchasingListSection
        icon={FileText}
        title="Pending Approvals"
        description="Purchase requests waiting for your approval at the current workflow step."
      >
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-pink-600" />
            Loading approvals...
          </div>
        ) : prs.length === 0 ? (
          <div className="py-14 text-center">
            <CheckCircle className="mx-auto mb-3 h-12 w-12 text-emerald-300" />
            <p className="text-gray-500">No purchase requests pending approval</p>
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
                    <th className="px-4 py-3 text-left font-semibold">Department</th>
                    <th className="px-4 py-3 text-left font-semibold">Requester</th>
                    <th className="px-4 py-3 text-right font-semibold">Estimated Total</th>
                    <th className="px-4 py-3 text-center font-semibold">Priority</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {prs.map((pr) => {
                    const priorityBadge = getPriorityBadge(pr.priority);
                    const statusBadge = getPRStatusLabel(pr.status);
                    const statusLabel = PR_STATUS_LABEL_OVERRIDES[pr.status] ?? statusBadge.label;
                    const statusStyle =
                      PR_STATUS_STYLES[pr.status] ?? "border-gray-200 bg-gray-50 text-gray-700";
                    const priorityStyle =
                      PRIORITY_STYLES[pr.priority] ?? "border-gray-200 bg-gray-50 text-gray-700";
                    const rowProcessing = processing?.id === pr.id ? processing.action : null;

                    return (
                      <tr
                        key={pr.id}
                        className="cursor-pointer hover:bg-gray-50/80"
                        onClick={() => router.push(prDetailHref(pr.id))}
                      >
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">{pr.pr_number}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{formatDate(pr.created_at)}</td>
                        <td className="px-4 py-3 text-gray-600">{pr.department_name || "-"}</td>
                        <td className="px-4 py-3 text-gray-600">{pr.requester_name || "-"}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          {formatAmount(pr.total_amount || 0)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="outline" className={priorityStyle}>
                            {priorityBadge.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="outline" className={statusStyle}>
                            {statusLabel}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(event) => event.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            <Link href={prDetailHref(pr.id)}>
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
                              onClick={() => setConfirmingPR(pr)}
                              disabled={Boolean(rowProcessing)}
                            >
                              {rowProcessing === "approve" ? (
                                <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                              ) : (
                                <CheckCircle className="h-4 w-4 text-emerald-600" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Reject"
                              className="cursor-pointer"
                              onClick={() => {
                                setRejectingPR(pr);
                                setRejectionReason("");
                              }}
                              disabled={Boolean(rowProcessing)}
                            >
                              {rowProcessing === "reject" ? (
                                <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-600" />
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
              Showing {prs.length} pending purchase request{prs.length === 1 ? "" : "s"}
            </div>
          </>
        )}
      </PurchasingListSection>

      <Dialog open={confirmingPR !== null} onOpenChange={(open) => !open && closeApproveDialog()}>
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Approve Purchase Request?</DialogPanelTitle>
            <DialogPanelDescription>
              {confirmingPR
                ? `${confirmingPR.pr_number} will be approved as a valid requirement and can proceed to purchase order creation.`
                : "This request will be approved as a valid requirement."}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody />
          <DialogFooter className="px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="purchasing-secondary-button"
              onClick={closeApproveDialog}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="purchasing-main-button"
              onClick={approvePR}
              disabled={isProcessing}
            >
              {processing?.action === "approve" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {processing?.action === "approve" ? "Approving..." : "Approve"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      <Dialog open={rejectingPR !== null} onOpenChange={(open) => !open && closeRejectDialog()}>
        <DialogPanel size="sm">
          <DialogPanelHeader>
            <DialogPanelTitle>Reject Purchase Request</DialogPanelTitle>
            <DialogPanelDescription>
              {rejectingPR
                ? `Provide a reason for rejecting ${rejectingPR.pr_number}. The requester can create a revision if needed.`
                : "Provide a reason for rejecting this request."}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody>
            <div className="space-y-1.5">
              <Label htmlFor="pr-list-rejection-reason" className="text-xs">
                Rejection Reason <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="pr-list-rejection-reason"
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                placeholder="Explain why this request is rejected..."
                rows={4}
                className="resize-none text-sm"
                disabled={isProcessing}
              />
            </div>
          </DialogPanelBody>
          <DialogFooter className="px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="purchasing-secondary-button"
              onClick={closeRejectDialog}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-lg border-red-200 bg-white px-3 text-sm font-medium text-red-600 hover:!border-red-200 hover:!bg-red-50"
              onClick={rejectPR}
              disabled={isProcessing || !rejectionReason.trim()}
            >
              {processing?.action === "reject" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {processing?.action === "reject" ? "Rejecting..." : "Reject"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
