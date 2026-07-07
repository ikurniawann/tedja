"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/badge";
import { Search, Filter, FileText, CheckCircle, Send, XCircle, Trash2, Pencil, Eye, Loader2, Truck } from "lucide-react";
import { toast } from "sonner";
import { PurchaseOrderWithStats, POStatus } from "@/types/purchasing";
import { usePurchaseOrderList } from "../queries";
import {
  useApprovePurchaseOrder,
  useSendPurchaseOrder,
  useCancelPurchaseOrder,
} from "../mutations";
import { formatAmount } from "@/lib/purchasing/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingTablePagination } from "@/modules/purchasing/components/pagination/PurchasingTablePagination";
import { RM_ROUTES } from "@/modules/purchasing/constants/item-routes";

const STATUS_OPTIONS: { value: POStatus | "all"; label: string }[] = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "pending_approval", label: "Pending Approval" },
  { value: "approved", label: "Approved" },
  { value: "sent", label: "Sent" },
  { value: "partial", label: "Partially Received" },
  { value: "partially_received", label: "Partially Received" },
  { value: "received", label: "Fully Received" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function canTrackShipment(status: string) {
  const normalized = status.toLowerCase();
  return ["approved", "sent", "partial", "partially_received"].includes(normalized);
}

function getShipmentHref(po: PurchaseOrderWithStats) {
  if (po.active_delivery_id) {
    return `${RM_ROUTES.purchasingDelivery}/${po.active_delivery_id}`;
  }
  return `${RM_ROUTES.purchasingDelivery}/insert?po_id=${po.id}`;
}

export function PurchaseOrdersPage() {
  const [page, setPage] = useState(1);
  const limit = 20;
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<POStatus | "all">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  
  // Dialog states
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [cancellingPo, setCancellingPo] = useState<PurchaseOrderWithStats | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [sendingPo, setSendingPo] = useState<PurchaseOrderWithStats | null>(null);
  const [sendVia, setSendVia] = useState<"EMAIL" | "WHATSAPP" | "PRINT" | "OTHER">("EMAIL");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkApproveDialogOpen, setIsBulkApproveDialogOpen] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const [processingPoId, setProcessingPoId] = useState<string | null>(null);

  const listQuery = usePurchaseOrderList({
    search: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    page,
    limit,
  });
  const pos = listQuery.data?.data ?? [];
  const loading = listQuery.isLoading;
  const total = listQuery.data?.pagination?.total ?? listQuery.data?.total ?? 0;
  const totalPages =
    listQuery.data?.pagination?.total_pages ??
    listQuery.data?.total_pages ??
    Math.max(1, Math.ceil(total / limit));

  const approveMutation = useApprovePurchaseOrder();
  const sendMutation = useSendPurchaseOrder();
  const cancelMutation = useCancelPurchaseOrder();
  const isSending = sendMutation.isPending;

  useEffect(() => {
    if (listQuery.isError) {
      console.error("Error loading POs:", listQuery.error);
      toast.error("Failed to load purchase orders");
    }
  }, [listQuery.isError, listQuery.error]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  // Checkbox handlers
  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(pos.map(po => po.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleSelectItem = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  // Bulk actions
  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    
    setIsProcessingBulk(true);
    try {
      let successCount = 0;
      let failCount = 0;
      const failedIds: string[] = [];
      
      console.log(`Starting bulk approve for ${selectedIds.size} POs:`, Array.from(selectedIds));
      
      for (const id of selectedIds) {
        try {
          console.log(`Approving PO ${id}...`);
          await approveMutation.mutateAsync(id);
          successCount++;
          console.log(`✓ PO ${id} approved`);
        } catch (error: unknown) {
          console.error(`✗ Failed to approve PO ${id}:`, getErrorMessage(error, "Unknown error"));
          failCount++;
          failedIds.push(id);
        }
      }
      
      console.log(`Bulk approve completed: ${successCount} success, ${failCount} failed`);
      
      if (successCount > 0) {
        toast.success(`Approved ${successCount} purchase order${successCount === 1 ? "" : "s"}`);
      }
      
      if (failCount > 0) {
        toast.error(`${failCount} purchase order${failCount === 1 ? "" : "s"} failed to approve: ${failedIds.slice(0, 3).join(', ')}${failedIds.length > 3 ? '...' : ''}`);
      }

      setSelectedIds(new Set());
      setIsBulkApproveDialogOpen(false);
    } catch (error) {
      console.error("Error bulk approve:", error);
      toast.error("An error occurred during bulk approval");
    } finally {
      setIsProcessingBulk(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    
    setIsProcessingBulk(true);
    try {
      // Note: You'll need to implement deletePurchaseOrder in lib/purchasing
      let successCount = 0;
      let failCount = 0;
      
      // Placeholder - implement actual delete API call
      for (const id of selectedIds) {
        try {
          // await deletePurchaseOrder(id); // TODO: Implement this
          successCount++;
        } catch (error: unknown) {
          console.error(`Failed to delete PO ${id}:`, error);
          failCount++;
        }
      }
      
      toast.success(`Deleted ${successCount} purchase order${successCount === 1 ? "" : "s"}`);
      if (failCount > 0) {
        toast.error(`${failCount} purchase order${failCount === 1 ? "" : "s"} failed to delete`);
      }

      listQuery.refetch();
      setSelectedIds(new Set());
      setIsBulkDeleteDialogOpen(false);
    } catch (error) {
      console.error("Error bulk delete:", error);
      toast.error("Bulk delete failed");
    } finally {
      setIsProcessingBulk(false);
    }
  };

  const handleApprove = async (po: PurchaseOrderWithStats) => {
    try {
      setProcessingPoId(po.id);
      await approveMutation.mutateAsync(po.id);
      toast.success("Purchase order approved");
    } catch (error: unknown) {
      console.error("Error approving PO:", error);
      toast.error(getErrorMessage(error, "Failed to approve purchase order"));
    } finally {
      setProcessingPoId(null);
    }
  };

  const handleOpenSend = (po: PurchaseOrderWithStats) => {
    setSendingPo(po);
    setSendVia("EMAIL");
    setIsSendDialogOpen(true);
  };

  const handleSend = async () => {
    if (!sendingPo) return;
    try {
      setProcessingPoId(sendingPo.id);
      await sendMutation.mutateAsync({ id: sendingPo.id, sentVia: sendVia });
      toast.success(`Purchase order sent via ${sendVia}`);
      setIsSendDialogOpen(false);
    } catch (error: unknown) {
      console.error("Error sending PO:", error);
      toast.error(getErrorMessage(error, "Failed to send purchase order"));
    } finally {
      setProcessingPoId(null);
    }
  };

  const handleOpenCancel = (po: PurchaseOrderWithStats) => {
    setCancellingPo(po);
    setCancelReason("");
    setIsCancelDialogOpen(true);
  };

  const handleCancel = async () => {
    if (!cancellingPo || !cancelReason) return;
    try {
      await cancelMutation.mutateAsync({ id: cancellingPo.id, reason: cancelReason });
      toast.success("Purchase order cancelled");
      setIsCancelDialogOpen(false);
    } catch (error: unknown) {
      console.error("Error cancelling PO:", error);
      toast.error(getErrorMessage(error, "Failed to cancel purchase order"));
    }
  };

  const normalizeStatus = (status: string) => status.toLowerCase() as POStatus;

  const getStatusBadge = (status: POStatus | string) => {
    const normalized = normalizeStatus(status);
    const styles: Record<POStatus, string> = {
      draft: "bg-gray-100 text-gray-800",
      pending_approval: "bg-yellow-100 text-yellow-800",
      approved: "bg-blue-100 text-blue-800",
      sent: "bg-purple-100 text-purple-800",
      partial: "bg-yellow-100 text-yellow-800",
      partially_received: "bg-yellow-100 text-yellow-800",
      received: "bg-green-100 text-green-800",
      rejected: "bg-red-100 text-red-800",
      cancelled: "bg-red-100 text-red-800",
    };
    const labels: Record<POStatus, string> = {
      draft: "Draft",
      pending_approval: "Pending Approval",
      approved: "Approved",
      sent: "Sent",
      partial: "Partially Received",
      partially_received: "Partially Received",
      received: "Fully Received",
      rejected: "Rejected",
      cancelled: "Cancelled",
    };
    return <Badge className={styles[normalized] || "bg-gray-100 text-gray-800"}>{labels[normalized] || status}</Badge>;
  };

  const getLifecycleBadge = (po: PurchaseOrderWithStats) => {
    const lifecycle = po.lifecycle_status || "in_progress";
    const styles: Record<string, string> = {
      draft: "bg-gray-100 text-gray-700",
      in_progress: "bg-blue-100 text-blue-700",
      waiting_payment: "bg-amber-100 text-amber-700",
      waiting_receipt: "bg-purple-100 text-purple-700",
      completed: "bg-emerald-100 text-emerald-700",
      cancelled: "bg-red-100 text-red-700",
    };
    const labels: Record<string, string> = {
      draft: "Draft",
      in_progress: "In Progress",
      waiting_payment: "Waiting for Payment",
      waiting_receipt: "Waiting for Receipt",
      completed: "Completed",
      cancelled: "Cancelled",
    };
    return <Badge className={styles[lifecycle] || "bg-blue-100 text-blue-700"}>{labels[lifecycle] || lifecycle}</Badge>;
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const handleResetFilters = () => {
    setSearchQuery("");
    setSearch("");
    setStatusFilter("all");
    setPage(1);
  };

  const isFilterActive = statusFilter !== "all";

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Purchase Order"
        description={`Manage purchase orders from approved purchase requests through receipt — ${total} total`}
      />

      <PurchasingListSection
        icon={FileText}
        title="Purchase Order List"
        description="Track purchase orders, suppliers, approval status, and receipt progress."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder="Search purchase order number or supplier..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-10 bg-white pl-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
                />
            </label>

            <Button
              type="button"
              variant="outline"
              onClick={() => setFilterOpen((open) => !open)}
              className={
                isFilterActive
                  ? "h-10 gap-2 rounded-lg border-pink-600 bg-pink-600 px-3 text-sm font-semibold !text-white shadow-sm hover:!border-pink-700 hover:!bg-pink-700 hover:!text-white [&_*]:!text-white [&_svg]:!text-white"
                  : "h-10 gap-2 rounded-lg border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:!border-pink-200 hover:!bg-pink-50 hover:!text-pink-700"
              }
            >
              <Filter className={isFilterActive ? "h-4 w-4 text-white" : "h-4 w-4"} />
              Filter
              {isFilterActive && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-xs text-white">
                  1
                </span>
              )}
            </Button>

            {(search || isFilterActive || page > 1) && (
              <Button variant="outline" onClick={handleResetFilters} className="h-10 flex-shrink-0 rounded-lg">
                Reset
              </Button>
            )}
          </div>
        }
      >

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <span className="text-sm font-medium text-blue-800">
            {selectedIds.size} purchase order{selectedIds.size === 1 ? "" : "s"} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsBulkApproveDialogOpen(true)}
            disabled={isProcessingBulk}
          >
            <CheckCircle className="w-4 h-4 mr-1" />
            Approve Selected
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsBulkDeleteDialogOpen(true)}
            disabled={isProcessingBulk}
          >
            <Trash2 className="w-4 h-4 mr-1" />
            Delete Selected
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

        <div>
        {filterOpen && (
          <div className="border-b border-gray-100 bg-gray-50/70 px-5 py-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <Filter className="h-3.5 w-3.5 text-pink-500" />
                  Status
                </div>
                <Combobox
                  options={STATUS_OPTIONS}
                  value={statusFilter}
                  onChange={(value) => {
                    setStatusFilter(value as POStatus | "all");
                    setPage(1);
                  }}
                  placeholder="Filter status..."
                  searchPlaceholder="Search status..."
                  emptyMessage="No status found"
                  className="!w-full h-9 text-sm"
                />
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-[50px] px-4 py-3 text-left font-semibold">
                <input
                  type="checkbox"
                  checked={selectedIds.size === pos.length && pos.length > 0}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                  className="rounded border-gray-300"
                />
              </th>
              <th className="px-4 py-3 text-left font-semibold">Purchase Order</th>
              <th className="px-4 py-3 text-left font-semibold">Purchase Request</th>
              <th className="px-4 py-3 text-left font-semibold">Supplier</th>
              <th className="px-4 py-3 text-left font-semibold">Date</th>
              <th className="px-4 py-3 text-right font-semibold">Total</th>
              <th className="px-4 py-3 text-center font-semibold">Status</th>
              <th className="px-4 py-3 text-left font-semibold">Progress</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-sm text-gray-500">
                  Loading purchase orders...
                </td>
              </tr>
            ) : pos.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-14 text-center text-sm text-gray-500">
                  No purchase orders found
                </td>
              </tr>
            ) : (
              pos.map((po) => (
                <tr key={po.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(po.id)}
                      onChange={() => toggleSelectItem(po.id)}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={RM_ROUTES.purchasingPoDetail(po.id)}
                      className="text-pink-600 hover:underline"
                    >
                      {po.nomor_po}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {po.pr_id && po.pr_number ? (
                      <Link
                        href={RM_ROUTES.purchasingPrDetail(po.pr_id)}
                        className="text-pink-600 hover:underline"
                      >
                        {po.pr_number}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{po.nama_supplier || po.supplier_kode}</td>
                  <td className="px-4 py-3 text-gray-700">{formatDate(po.tanggal_po)}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {formatAmount(po.grand_total || 0)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                      {getStatusBadge(po.status)}
                      {getLifecycleBadge(po)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {normalizeStatus(po.status) !== "draft" && normalizeStatus(po.status) !== "cancelled" && (
                      <div className="grid gap-1">
                        <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${
                              (po.overall_progress_pct || 0) >= 100
                                ? "bg-green-500"
                                : (po.overall_progress_pct || 0) > 0
                                ? "bg-yellow-400"
                                : "bg-gray-300"
                            }`}
                            style={{ width: `${po.overall_progress_pct || 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {po.overall_progress_pct || 0}%
                        </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Goods {po.received_percentage || 0}% · Payment {po.payment_progress_pct || 0}%
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/dashboard/purchasing/po/${po.id}`}>
                        <Button variant="ghost" size="sm" className="cursor-pointer" title="View detail">
                          <Eye className="w-4 h-4" />
                        </Button>
                      </Link>
                      {normalizeStatus(po.status) === "draft" && (
                        <>
                          <Link href={`/dashboard/purchasing/po/edit/${po.id}`}>
                            <Button variant="ghost" size="sm" className="cursor-pointer" title="Edit purchase order">
                              <Pencil className="w-4 h-4" />
                            </Button>
                          </Link>
                          <Button variant="ghost" size="sm" onClick={() => handleApprove(po)} disabled={processingPoId === po.id} title="Approve">
                            {processingPoId === po.id ? (
                              <Loader2 className="w-4 h-4 animate-spin text-green-600" />
                            ) : (
                              <CheckCircle className="w-4 h-4 text-green-600" />
                            )}
                          </Button>
                        </>
                      )}
                      {normalizeStatus(po.status) === "approved" && (
                        <Button variant="ghost" size="sm" onClick={() => handleOpenSend(po)} disabled={processingPoId === po.id} title="Send to supplier">
                          {processingPoId === po.id ? (
                            <Loader2 className="w-4 h-4 animate-spin text-pink-600" />
                          ) : (
                            <Send className="w-4 h-4 text-pink-600" />
                          )}
                        </Button>
                      )}
                      {canTrackShipment(po.status) && (
                        <Link href={getShipmentHref(po)}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="cursor-pointer"
                            title={
                              po.active_delivery_id
                                ? `Track shipment${po.active_delivery_number ? ` (${po.active_delivery_number})` : ""}`
                                : "Track shipment"
                            }
                          >
                            <Truck className="h-4 w-4 text-blue-600" />
                          </Button>
                        </Link>
                      )}
                      {normalizeStatus(po.status) !== "received" && normalizeStatus(po.status) !== "cancelled" && (
                        <Button variant="ghost" size="sm" onClick={() => handleOpenCancel(po)} title="Cancel">
                          <XCircle className="w-4 h-4 text-red-600" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>

        <PurchasingTablePagination
          page={page}
          totalPages={Math.max(1, totalPages)}
          totalItems={total}
          pageSize={limit}
          onPageChange={setPage}
        />
        </div>
      </PurchasingListSection>

      {/* Send Dialog */}
      <Dialog open={isSendDialogOpen} onOpenChange={setIsSendDialogOpen}>
        <DialogContent className="gap-0 overflow-hidden rounded-2xl border border-gray-200/70 p-0 shadow-xl ring-1 ring-gray-200/60 sm:max-w-[460px]">
          <DialogHeader className="border-b border-gray-200/70 px-5 py-4">
            <DialogTitle className="text-base font-semibold text-gray-900">Send Purchase Order to Supplier</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-5 text-gray-500">
              Choose a delivery method for purchase order {sendingPo?.nomor_po}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-5 py-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Delivery Method</Label>
              <Combobox
                options={[
                  { value: "EMAIL", label: "Email" },
                  { value: "WHATSAPP", label: "WhatsApp" },
                  { value: "PRINT", label: "Print / Manual" },
                  { value: "OTHER", label: "Other" },
                ]}
                value={sendVia}
                onChange={(value) => setSendVia(value as "EMAIL" | "WHATSAPP" | "PRINT" | "OTHER")}
                placeholder="Select method..."
                searchPlaceholder="Search method..."
                emptyMessage="No method found"
                className="!w-full h-9 text-sm"
              />
            </div>
          </div>
          <DialogFooter className="mx-0 mb-0 gap-2 border-t border-gray-200/70 bg-gray-50/60 px-5 py-4 sm:justify-end">
            <Button variant="outline" onClick={() => setIsSendDialogOpen(false)} disabled={isSending} className="purchasing-secondary-button">
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={isSending} className="purchasing-main-button">
              {isSending ? "Sending..." : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Purchase Order</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel purchase order {cancellingPo?.nomor_po}?
              Enter a cancellation reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Cancellation Reason *</Label>
              <Input
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Example: Requirement changed"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCancelDialogOpen(false)} className="purchasing-secondary-button">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={!cancelReason}
              className="purchasing-main-button"
            >
              Cancel Purchase Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Approve Dialog */}
      <Dialog open={isBulkApproveDialogOpen} onOpenChange={setIsBulkApproveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Multiple PO</DialogTitle>
            <DialogDescription>
              You are about to approve {selectedIds.size} selected purchase order{selectedIds.size === 1 ? "" : "s"}. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkApproveDialogOpen(false)} disabled={isProcessingBulk} className="purchasing-secondary-button">
              Cancel
            </Button>
            <Button onClick={handleBulkApprove} disabled={isProcessingBulk} className="purchasing-main-button">
              {isProcessingBulk ? "Processing..." : `Approve ${selectedIds.size} PO`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Dialog */}
      <Dialog open={isBulkDeleteDialogOpen} onOpenChange={setIsBulkDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Multiple Purchase Orders</DialogTitle>
            <DialogDescription className="text-red-600">
              Warning: You are about to delete {selectedIds.size} selected purchase order{selectedIds.size === 1 ? "" : "s"}. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBulkDeleteDialogOpen(false)} disabled={isProcessingBulk} className="purchasing-secondary-button">
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={isProcessingBulk} className="purchasing-main-button">
              {isProcessingBulk ? "Processing..." : `Delete ${selectedIds.size} Purchase Order${selectedIds.size === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
