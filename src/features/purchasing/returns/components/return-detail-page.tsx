"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useReturn } from "../queries";
import { useApproveReturn, useRejectReturn } from "../mutations";
import { getReturnsModuleConfig } from "../returns-module";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import {
  ReturnStatus,
  ReturnReasonType,
} from "@/types/purchasing";
import {
  ArrowLeftIcon,
  CheckCircle2,
  FileText,
  Loader2,
  Package,
  Pencil,
  Printer,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { formatAmount, formatDate } from "@/lib/purchasing/utils";
import { toast } from "sonner";

const STATUS_LABELS: Record<ReturnStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_STYLES: Record<ReturnStatus, string> = {
  draft: "border-gray-200 bg-gray-50 text-gray-700",
  pending_approval: "border-amber-200 bg-amber-50 text-amber-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
  completed: "border-blue-200 bg-blue-50 text-blue-700",
  cancelled: "border-gray-200 bg-gray-100 text-gray-600",
};

const REASON_LABELS: Record<ReturnReasonType, string> = {
  damaged: "Damaged Goods",
  wrong_item: "Wrong Item",
  expired: "Expired",
  overstock: "Overstock",
  specification_mismatch: "Specification Mismatch",
  other: "Other",
};

function formatQty(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

function getGrnNumber(ret: {
  grn_number?: string | null;
  grn?: { grn_number?: string | null; nomor_grn?: string | null } | null;
  grn_id?: string | null;
}) {
  return ret.grn_number || ret.grn?.grn_number || ret.grn?.nomor_grn || "-";
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function DetailField({
  label,
  value,
  href,
  className,
}: {
  label: string;
  value: string;
  href?: string;
  className?: string;
}) {
  const content = (
    <div className={className}>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd
        className={`mt-0.5 text-sm font-medium text-gray-900 ${href ? "text-pink-700 hover:underline" : ""}`}
      >
        {value}
      </dd>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}

export function ReturnDetailPage({
  moduleType = "raw_material",
}: {
  moduleType?: PurchasingModuleType;
}) {
  const config = getReturnsModuleConfig(moduleType);
  const params = useParams();
  const returnId = params.id as string;

  const detailQuery = useReturn(returnId);
  const ret = detailQuery.data ?? null;
  const loading = detailQuery.isLoading;

  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const approveMutation = useApproveReturn();
  const rejectMutation = useRejectReturn();
  const isProcessing = approveMutation.isPending || rejectMutation.isPending;

  useEffect(() => {
    if (detailQuery.isError) {
      toast.error(getErrorMessage(detailQuery.error, "Failed to load purchase return"));
    }
  }, [detailQuery.isError, detailQuery.error]);

  const handleApprove = async () => {
    try {
      await approveMutation.mutateAsync(returnId);
      toast.success("Purchase return approved");
      setApproveDialogOpen(false);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to approve purchase return"));
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      toast.error("Rejection reason is required");
      return;
    }

    try {
      await rejectMutation.mutateAsync({ id: returnId, reason: rejectionReason.trim() });
      toast.success("Purchase return rejected");
      setRejectDialogOpen(false);
      setRejectionReason("");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to reject purchase return"));
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-56 items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-pink-600" />
        Loading purchase return...
      </div>
    );
  }

  if (detailQuery.isError || !ret) {
    return (
      <div className="space-y-4">
        <Link href={config.listRoute}>
          <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
            <ArrowLeftIcon className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="py-12 text-center text-sm text-gray-500">
            Purchase return not found or could not be loaded.
          </CardContent>
        </Card>
      </div>
    );
  }

  const status = ret.status as ReturnStatus;
  const reason = ret.reason_type as ReturnReasonType;
  const canApprove = status === "pending_approval";
  const canEdit = status === "draft" || status === "pending_approval";
  const isApproved = status === "approved" || status === "completed";
  const totalQty =
    ret.items?.reduce((sum, item) => sum + Number(item.qty_returned || 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Link href={config.listRoute}>
            <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
              <ArrowLeftIcon className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{ret.return_number}</h1>
              <Badge variant="outline" className={STATUS_STYLES[status]}>
                {STATUS_LABELS[status]}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {formatDate(ret.return_date)} · {config.partyNameFromReturn(ret)} ·{" "}
              {REASON_LABELS[reason]}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            variant="outline"
            onClick={() => window.print()}
            className="purchasing-secondary-button w-full sm:w-auto"
          >
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          {canEdit && (
            <Link href={config.editRoute(returnId)}>
              <Button
                variant="outline"
                className="purchasing-secondary-button w-full sm:w-auto"
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
            </Link>
          )}
          {canApprove && (
            <>
              <Button
                variant="outline"
                className="h-10 w-full rounded-lg border-emerald-200 bg-white px-3 text-sm font-medium text-emerald-700 shadow-sm hover:!border-emerald-200 hover:!bg-emerald-50 sm:w-auto"
                onClick={() => setApproveDialogOpen(true)}
                disabled={isProcessing}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Approve
              </Button>
              <Button
                variant="outline"
                className="h-10 w-full rounded-lg border-red-200 bg-white px-3 text-sm font-medium text-red-600 shadow-sm hover:!border-red-200 hover:!bg-red-50 sm:w-auto"
                onClick={() => setRejectDialogOpen(true)}
                disabled={isProcessing}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Reject
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-pink-600" />
                Return Information
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 p-4 md:grid-cols-2">
              <DetailField label={config.partyLabel} value={config.partyNameFromReturn(ret)} />
              <DetailField label="Return Date" value={formatDate(ret.return_date)} />
              <DetailField label="Reason" value={REASON_LABELS[reason]} />
              <DetailField
                label="Goods Receipt"
                value={getGrnNumber(ret)}
                href={ret.grn_id ? config.receiveDetailRoute(ret.grn_id) : undefined}
              />
              {(ret.reason_notes || ret.notes) && (
                <div className="md:col-span-2 space-y-3 border-t border-gray-200/70 pt-4">
                  {ret.reason_notes && (
                    <div>
                      <p className="text-xs font-medium text-gray-500">Reason Notes</p>
                      <p className="mt-1 text-sm text-gray-700">{ret.reason_notes}</p>
                    </div>
                  )}
                  {ret.notes && (
                    <div>
                      <p className="text-xs font-medium text-gray-500">Internal Notes</p>
                      <p className="mt-1 text-sm text-gray-700">{ret.notes}</p>
                    </div>
                  )}
                </div>
              )}
              {ret.rejection_reason && (
                <div className="md:col-span-2 rounded-xl border border-red-200/80 bg-red-50/60 p-4 text-sm text-red-800">
                  <p className="font-medium">Rejection Reason</p>
                  <p className="mt-1">{ret.rejection_reason}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4 text-pink-600" />
                Returned Items
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!ret.items?.length ? (
                <div className="py-12 text-center text-sm text-gray-500">No items found.</div>
              ) : (
                <div className="overflow-x-auto p-4">
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold">
                          {config.isProduct ? "Product" : "Raw Material"}
                        </th>
                        <th className="px-4 py-3 text-left font-semibold">Stall</th>
                        <th className="px-4 py-3 text-right font-semibold">Batch</th>
                        <th className="px-4 py-3 text-right font-semibold">Expiry</th>
                        <th className="px-4 py-3 text-right font-semibold">Qty</th>
                        <th className="px-4 py-3 text-right font-semibold">Unit Cost</th>
                        <th className="px-4 py-3 text-right font-semibold">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {ret.items.map((item) => {
                        const itemDisplay = config.itemName({
                          product_nama: (item as { product?: { nama?: string } }).product?.nama,
                          product_kode: (item as { product?: { kode?: string } }).product?.kode,
                          raw_material_nama: item.raw_material?.nama,
                          raw_material_kode: item.raw_material?.kode,
                        });
                        return (
                        <tr key={item.id} className="hover:bg-gray-50/80">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">
                              {itemDisplay.nama}
                            </div>
                            <div className="text-xs text-gray-500">
                              {itemDisplay.kode}
                            </div>
                            {item.condition_notes && (
                              <div className="mt-1 text-xs text-gray-500">{item.condition_notes}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {item.grn_item?.warehouse?.name || "-"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">
                            {item.batch_number || "-"}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">
                            {item.expiry_date ? formatDate(item.expiry_date) : "-"}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {formatQty(Number(item.qty_returned))}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {formatAmount(item.unit_cost)}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-gray-900">
                            {formatAmount(item.subtotal)}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200/70 bg-gray-50/60">
                        <td colSpan={6} className="px-4 py-3 text-right text-sm font-medium text-gray-700">
                          Total
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-pink-700">
                          {formatAmount(ret.total_amount)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 xl:col-span-4">
          <Card className="border-gray-200/70 shadow-xs xl:sticky xl:top-6">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <RotateCcw className="h-4 w-4 text-pink-600" />
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <dl className="space-y-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-gray-500">Items</dt>
                  <dd className="font-medium text-gray-900">{ret.items?.length || 0}</dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-gray-500">Total Quantity</dt>
                  <dd className="font-medium text-gray-900">{formatQty(totalQty)}</dd>
                </div>
                <div className="flex items-start justify-between gap-3 border-t border-gray-200/70 pt-3">
                  <dt className="font-medium text-gray-900">Total Amount</dt>
                  <dd className="font-semibold text-pink-700">{formatAmount(ret.total_amount)}</dd>
                </div>
              </dl>

              <div className="border-t border-gray-200/70 pt-4">
                <p className="mb-3 text-sm font-medium text-gray-900">Timeline</p>
                <ul className="space-y-3 text-sm">
                  <li className="flex gap-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gray-300" />
                    <div>
                      <p className="font-medium text-gray-900">Created</p>
                      <p className="text-xs text-gray-500">{formatDate(ret.created_at)}</p>
                    </div>
                  </li>
                  {ret.approved_at && (
                    <li className="flex gap-3">
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          status === "rejected" ? "bg-red-500" : "bg-emerald-500"
                        }`}
                      />
                      <div>
                        <p className="font-medium text-gray-900">
                          {status === "rejected" ? "Rejected" : "Approved"}
                        </p>
                        <p className="text-xs text-gray-500">{formatDate(ret.approved_at)}</p>
                      </div>
                    </li>
                  )}
                  {ret.shipping_date && (
                    <li className="flex gap-3">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                      <div>
                        <p className="font-medium text-gray-900">Shipped to Supplier</p>
                        <p className="text-xs text-gray-500">{formatDate(ret.shipping_date)}</p>
                        {ret.tracking_number && (
                          <p className="text-xs text-gray-500">Tracking: {ret.tracking_number}</p>
                        )}
                      </div>
                    </li>
                  )}
                </ul>
              </div>

              {isApproved && (
                <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-4 text-sm text-emerald-800">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-medium">Return approved</p>
                      <p className="mt-1 text-emerald-700/90">
                        Stock has been reduced from the receipt stall. Goods receipt return
                        quantities have been updated.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Approve Purchase Return?</DialogPanelTitle>
            <DialogPanelDescription>
              Stock will be reduced from each item&apos;s receipt stall. Goods receipt return
              quantities will be updated.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody />
          <DialogFooter className="px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="purchasing-secondary-button"
              onClick={() => setApproveDialogOpen(false)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="purchasing-main-button"
              onClick={handleApprove}
              disabled={isProcessing}
            >
              {isProcessing ? "Approving..." : "Approve"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogPanel size="sm">
          <DialogPanelHeader>
            <DialogPanelTitle>Reject Purchase Return</DialogPanelTitle>
            <DialogPanelDescription>
              Provide a reason for rejecting this return request.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody>
            <div className="space-y-1.5">
              <Label htmlFor="rejection_reason" className="text-xs">
                Rejection Reason <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="rejection_reason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Explain why this return is rejected..."
                rows={4}
                className="resize-none text-sm"
              />
            </div>
          </DialogPanelBody>
          <DialogFooter className="px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="purchasing-secondary-button"
              onClick={() => {
                setRejectDialogOpen(false);
                setRejectionReason("");
              }}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-lg border-red-200 bg-white px-3 text-sm font-medium text-red-600 hover:!border-red-200 hover:!bg-red-50"
              onClick={handleReject}
              disabled={isProcessing || !rejectionReason.trim()}
            >
              {isProcessing ? "Rejecting..." : "Reject"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
