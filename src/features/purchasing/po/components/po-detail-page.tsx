"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, usePathname } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { DsDateTimePicker } from "@/components/design-system";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  ArrowLeft,
  Printer,
  CheckCircle,
  Send,
  XCircle,
  FileText,
  Package,
  User,
  Calendar,
  MapPin,
  Factory,
  Truck,
  CreditCard,
  WalletCards,
  Banknote,
  Boxes,
  Trash2,
  Lock,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  PurchaseOrderItem,
  POStatus,
  PurchaseOrderPaymentTerm,
  VendorPayment,
} from "@/types/purchasing";
import { usePurchaseOrder, usePurchaseOrderPayments } from "../queries";
import {
  useApprovePurchaseOrder,
  useSendPurchaseOrder,
  useCancelPurchaseOrder,
  useClosePurchaseOrder,
  useCreatePOPaymentTerm,
  useDeletePOPaymentTerm,
  useCreateVendorPayment,
} from "../mutations";
import { formatAmount } from "@/lib/purchasing/utils";
import { RM_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { NAV_FROM_APPROVAL_PO } from "@/lib/iam/nav-context";
import { useNavFrom } from "@/lib/iam/use-nav-from";

// Deskripsi termin disimpan apa adanya di database dan sebagian dibuat oleh server
// dalam bahasa Inggris, jadi label default itu diterjemahkan saat ditampilkan saja.
function localizeTermDescription(description: string) {
  if (/^paid in full$/i.test(description)) return "Lunas";
  if (/^down payment$/i.test(description)) return "Uang Muka";

  const installment = description.match(/^(?:installment|payment term)\s*(\d+)$/i);
  if (installment) return `Cicilan ${installment[1]}`;

  return description;
}

export function PODetailPage() {
  const params = useParams();
  const pathname = usePathname();
  const poId = params.id as string;
  const navFrom = useNavFrom();
  const fromInvoiceContext =
    pathname.includes("/invoice/po/") ||
    pathname.includes("/accounts-payable/po/");
  const fromApprovalContext = navFrom === NAV_FROM_APPROVAL_PO;
  const showPaymentManagement = fromInvoiceContext;
  const backHref = fromInvoiceContext
    ? RM_ROUTES.purchasingInvoice
    : fromApprovalContext
      ? RM_ROUTES.approvalPo
      : RM_ROUTES.purchasingPo;
  const backLabel = fromInvoiceContext
    ? "Kembali ke Account Payable"
    : fromApprovalContext
      ? "Kembali ke Persetujuan"
      : "Kembali";

  const detailQuery = usePurchaseOrder(poId);
  const paymentsQuery = usePurchaseOrderPayments(poId, showPaymentManagement);
  const po = detailQuery.data ?? null;
  const items: PurchaseOrderItem[] = po?.items ?? [];
  const paymentTerms: PurchaseOrderPaymentTerm[] = paymentsQuery.data?.terms ?? [];
  const vendorPayments: VendorPayment[] = paymentsQuery.data?.payments ?? [];
  const loading = detailQuery.isLoading;

  const approveMutation = useApprovePurchaseOrder();
  const sendMutation = useSendPurchaseOrder();
  const cancelMutation = useCancelPurchaseOrder();
  const closeMutation = useClosePurchaseOrder();
  const createTermMutation = useCreatePOPaymentTerm();
  const deleteTermMutation = useDeletePOPaymentTerm();
  const createPaymentMutation = useCreateVendorPayment();
  const isApproving = approveMutation.isPending;
  const isSending = sendMutation.isPending;
  const isDeletingTerm = deleteTermMutation.isPending;

  // Dialog states
  const [isApproveDialogOpen, setIsApproveDialogOpen] = useState(false);
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  const [isTermDialogOpen, setIsTermDialogOpen] = useState(false);
  const [isDeleteTermDialogOpen, setIsDeleteTermDialogOpen] = useState(false);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [sendVia, setSendVia] = useState<"EMAIL" | "WHATSAPP" | "PRINT" | "OTHER">("EMAIL");
  const [cancelReason, setCancelReason] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [deletingTerm, setDeletingTerm] = useState<PurchaseOrderPaymentTerm | null>(null);
  const [termForm, setTermForm] = useState({
    description: "Termin Pembayaran",
    due_date: new Date().toISOString().slice(0, 10),
    amount: undefined as number | undefined,
    notes: "",
  });
  const [paymentForm, setPaymentForm] = useState({
    payment_term_id: "",
    payment_date: new Date().toISOString().slice(0, 10),
    amount: undefined as number | undefined,
    method: "bank_transfer" as VendorPayment["method"],
    reference_number: "",
    notes: "",
  });

  const normalizedStatus = po?.status?.toLowerCase() as POStatus | undefined;
  const receivingProgress = Number(po?.received_percentage ?? po?.receive_percentage ?? po?.progress_pct ?? 0);
  const paymentProgress = Number(po?.payment_progress_pct ?? 0);
  const orderProgress = Number(po?.order_progress_pct ?? 0);
  const receiptProgress = Number(
    po?.receipt_progress_pct ?? receivingProgress
  );
  const qcProgress = Number(po?.qc_progress_pct ?? 0);
  const returnProgress = Number(po?.return_progress_pct ?? 0);
  const fulfillmentProgress = Number(
    po?.fulfillment_progress_pct ??
      (orderProgress + receiptProgress + qcProgress + returnProgress) / 4
  );
  const overallProgress = fulfillmentProgress;
  const payableAmount = Number(
    po?.payable_amount ?? (po as { gross_payable_amount?: number })?.gross_payable_amount ?? po?.grand_total ?? 0
  );
  const returnCreditAmount = Number((po as { return_credit_amount?: number })?.return_credit_amount ?? 0);
  const rejectCreditAmount = Number((po as { reject_credit_amount?: number })?.reject_credit_amount ?? 0);
  const totalCreditAmount = returnCreditAmount + rejectCreditAmount;
  const grossPayableAmount = Number(
    (po as { gross_payable_amount?: number })?.gross_payable_amount ??
      payableAmount + totalCreditAmount
  );
  const poOutstandingAmount = Math.max(
    0,
    Number(po?.outstanding_amount ?? payableAmount - Number(po?.paid_amount || 0))
  );
  const scheduledAmount = paymentTerms.reduce((sum, term) => sum + Number(term.amount || 0), 0);
  const remainingScheduledAmount = Math.max(0, payableAmount - scheduledAmount);
  const isFullyPaid = poOutstandingAmount <= 0;
  const paymentTermById = useMemo(
    () => new Map(paymentTerms.map((term) => [term.id, term])),
    [paymentTerms]
  );
  const paymentPreviewType = useMemo(() => {
    const amount = Number(paymentForm.amount || 0);
    if (amount <= 0) return null;
    return amount >= poOutstandingAmount - 0.01 ? "full" : "installment";
  }, [paymentForm.amount, poOutstandingAmount]);

  const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;

  useEffect(() => {
    if (detailQuery.isError) {
      console.error("Error loading PO:", detailQuery.error);
      toast.error("Gagal memuat purchase order");
    }
  }, [detailQuery.isError, detailQuery.error]);

  const handleApprove = async () => {
    try {
      await approveMutation.mutateAsync(poId);
      toast.success("Purchase order berhasil disetujui");
      setIsApproveDialogOpen(false);
    } catch (error: unknown) {
      console.error("Error approving PO:", error);
      toast.error(getErrorMessage(error, "Gagal menyetujui purchase order"));
    }
  };

  const handleSend = async () => {
    try {
      await sendMutation.mutateAsync({ id: poId, sentVia: sendVia });
      toast.success(`Purchase order berhasil dikirim via ${sendVia}`);
      setIsSendDialogOpen(false);
    } catch (error: unknown) {
      console.error("Error sending PO:", error);
      toast.error(getErrorMessage(error, "Gagal mengirim purchase order"));
    }
  };

  const handleCancel = async () => {
    if (!cancelReason) return;
    try {
      await cancelMutation.mutateAsync({ id: poId, reason: cancelReason });
      toast.success("Purchase order berhasil dibatalkan");
      setIsCancelDialogOpen(false);
    } catch (error: unknown) {
      console.error("Error cancelling PO:", error);
      toast.error(getErrorMessage(error, "Gagal membatalkan purchase order"));
    }
  };

  const handleClose = async () => {
    if (!closeReason.trim()) return;
    try {
      await closeMutation.mutateAsync({ id: poId, reason: closeReason.trim() });
      toast.success("Purchase order ditutup. Kekurangan qty tidak ditagihkan.");
      setIsCloseDialogOpen(false);
      setCloseReason("");
    } catch (error: unknown) {
      console.error("Error closing PO:", error);
      toast.error(getErrorMessage(error, "Gagal menutup purchase order"));
    }
  };

  const openTermDialog = () => {
    if (remainingScheduledAmount <= 0) {
      toast.info("Seluruh nilai purchase order sudah dijadwalkan pada termin pembayaran");
      return;
    }

    setTermForm({
      description:
        paymentTerms.length === 0 && remainingScheduledAmount >= payableAmount - 0.01
          ? "Lunas"
          : paymentTerms.length === 0
            ? "Cicilan 1"
            : `Cicilan ${paymentTerms.length + 1}`,
      due_date: new Date().toISOString().slice(0, 10),
      amount: remainingScheduledAmount > 0 ? remainingScheduledAmount : undefined,
      notes: "",
    });
    setIsTermDialogOpen(true);
  };

  const openPaymentDialog = (term?: PurchaseOrderPaymentTerm) => {
    const targetTerm = term || paymentTerms.find((item) => item.status !== "paid");
    const termRemaining = targetTerm
      ? Math.max(0, Number(targetTerm.amount || 0) - Number(targetTerm.paid_amount || 0))
      : 0;
    const defaultAmount = term ? termRemaining : poOutstandingAmount;

    setPaymentForm({
      payment_term_id: targetTerm?.id || "",
      payment_date: new Date().toISOString().slice(0, 10),
      amount: defaultAmount > 0 ? defaultAmount : undefined,
      method: "bank_transfer",
      reference_number: "",
      notes: "",
    });
    setIsPaymentDialogOpen(true);
  };

  const openDeleteTermDialog = (term: PurchaseOrderPaymentTerm) => {
    if (Number(term.paid_amount || 0) > 0 || ["partial", "paid"].includes(term.status)) {
      toast.error("Termin pembayaran yang sudah memiliki pembayaran tidak dapat dihapus");
      return;
    }

    setDeletingTerm(term);
    setIsDeleteTermDialogOpen(true);
  };

  const handleCreateTerm = async () => {
    const amount = Number(termForm.amount || 0);
    if (!termForm.description.trim() || !termForm.due_date || amount <= 0) {
      toast.error("Lengkapi deskripsi, jatuh tempo, dan nominal termin pembayaran");
      return;
    }

    if (amount > remainingScheduledAmount) {
      toast.error(`Nominal termin pembayaran tidak boleh melebihi sisa ${formatAmount(remainingScheduledAmount)}`);
      return;
    }

    try {
      await createTermMutation.mutateAsync({
        poId,
        payload: {
          description: termForm.description.trim(),
          due_date: termForm.due_date,
          amount,
          notes: termForm.notes.trim() || null,
        },
      });
      toast.success("Termin pembayaran berhasil ditambahkan");
      setIsTermDialogOpen(false);
      setTermForm({
        description: "Termin Pembayaran",
        due_date: new Date().toISOString().slice(0, 10),
        amount: undefined,
        notes: "",
      });
    } catch (error: unknown) {
      console.error("Error creating term:", error);
      toast.error(getErrorMessage(error, "Gagal menambahkan termin pembayaran"));
    }
  };

  const handleDeleteTerm = async () => {
    if (!deletingTerm) return;

    try {
      await deleteTermMutation.mutateAsync({ poId, termId: deletingTerm.id });
      toast.success("Termin pembayaran berhasil dihapus");
      setIsDeleteTermDialogOpen(false);
      setDeletingTerm(null);
    } catch (error: unknown) {
      console.error("Error deleting term:", error);
      toast.error(getErrorMessage(error, "Gagal menghapus termin pembayaran"));
    }
  };

  const handleCreatePayment = async () => {
    const amount = Number(paymentForm.amount || 0);
    if (!paymentForm.payment_date || amount <= 0) {
      toast.error("Masukkan tanggal dan nominal pembayaran");
      return;
    }

    if (amount > poOutstandingAmount + 0.01) {
      toast.error(`Nominal pembayaran tidak boleh melebihi sisa tagihan (${formatAmount(poOutstandingAmount)})`);
      return;
    }

    try {
      await createPaymentMutation.mutateAsync({
        poId,
        payload: {
          payment_term_id: paymentForm.payment_term_id || null,
          payment_date: paymentForm.payment_date,
          amount,
          method: paymentForm.method,
          reference_number: paymentForm.reference_number.trim() || null,
          notes: paymentForm.notes.trim() || null,
        },
      });
      toast.success(
        paymentPreviewType === "full"
          ? "Pelunasan berhasil dicatat"
          : "Pembayaran berhasil dicatat"
      );
      setIsPaymentDialogOpen(false);
    } catch (error: unknown) {
      console.error("Error creating payment:", error);
      toast.error(getErrorMessage(error, "Gagal mencatat pembayaran"));
    }
  };

  const getStatusBadge = (status: POStatus | string) => {
    const normalized = status.toLowerCase() as POStatus;
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
      closed: "bg-slate-100 text-slate-800",
    };
    const labels: Record<POStatus, string> = {
      draft: "Draf",
      pending_approval: "Menunggu Persetujuan",
      approved: "Disetujui",
      sent: "Terkirim",
      partial: "Diterima Sebagian",
      partially_received: "Diterima Sebagian",
      received: "Diterima Penuh",
      rejected: "Ditolak",
      cancelled: "Dibatalkan",
      closed: "Ditutup",
    };
    return <Badge className={styles[normalized] || "bg-gray-100 text-gray-800"}>{labels[normalized] || status}</Badge>;
  };

  const formatQuantity = (value?: number | null) => {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 4,
    }).format(value ?? 0);
  };

  const renderProgressStage = (
    label: string,
    value: number,
    detail: string,
    accentClass = "bg-pink-500"
  ) => (
    <div className="rounded-lg border border-gray-200/70 bg-gray-50/80 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-gray-600">{label}</span>
        <span className="font-semibold text-gray-900">{Math.round(value)}%</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full transition-all duration-500 ${accentClass}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-gray-500">{detail}</p>
    </div>
  );

  const getOrderProgressDetail = () => {
    if (normalizedStatus === "draft") return "Draf — menunggu persetujuan";
    if (normalizedStatus === "approved") return "Disetujui — belum dikirim";
    if (normalizedStatus === "cancelled") return "Dibatalkan";
    return "Pesanan dikonfirmasi dan dikirim";
  };

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString("en-US");
  };

  const getPaymentStatusBadge = (status?: string) => {
    const styles: Record<string, string> = {
      unpaid: "bg-gray-100 text-gray-700",
      partial: "bg-amber-100 text-amber-700",
      paid: "bg-emerald-100 text-emerald-700",
      overdue: "bg-red-100 text-red-700",
    };
    const labels: Record<string, string> = {
      unpaid: "Belum Dibayar",
      partial: "Dibayar Sebagian",
      paid: "Lunas",
      overdue: "Terlambat",
    };
    return <Badge className={styles[status || "unpaid"] || "bg-gray-100 text-gray-700"}>{labels[status || "unpaid"] || status}</Badge>;
  };

  const getTermDisplayLabel = (term: PurchaseOrderPaymentTerm) => {
    const description = term.description?.trim();
    if (description) {
      if (/^down payment$/i.test(description) && Number(term.amount || 0) >= payableAmount - 0.01) {
        return "Lunas";
      }
      return localizeTermDescription(description);
    }
    return `Cicilan ${term.term_no}`;
  };

  const getLifecycleBadge = () => {
    const lifecycle = po?.lifecycle_status || "in_progress";
    const styles: Record<string, string> = {
      draft: "bg-gray-100 text-gray-700",
      in_progress: "bg-blue-100 text-blue-700",
      waiting_payment: "bg-amber-100 text-amber-700",
      waiting_receipt: "bg-purple-100 text-purple-700",
      completed: "bg-emerald-100 text-emerald-700",
      cancelled: "bg-red-100 text-red-700",
    };
    const labels: Record<string, string> = {
      draft: "Draf",
      in_progress: "Sedang Berjalan",
      waiting_payment: "Menunggu Pembayaran",
      waiting_receipt: "Menunggu Penerimaan",
      completed: "Selesai",
      cancelled: "Dibatalkan",
    };
    return <Badge className={styles[lifecycle] || "bg-blue-100 text-blue-700"}>{labels[lifecycle] || lifecycle}</Badge>;
  };

  if (loading) {
    return (
      <div className="container mx-auto py-6">
        <div className="py-12 text-center">Memuat purchase order...</div>
      </div>
    );
  }

  if (!po) {
    return (
      <div className="space-y-4">
        <Link href={backHref}>
          <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Button>
        </Link>
        <div className="py-12 text-center text-red-500">Purchase order tidak ditemukan</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Link href={backHref}>
            <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
              <ArrowLeft className="h-4 w-4" />
              {backLabel}
            </Button>
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{po.nomor_po}</h1>
              {getStatusBadge(po.status)}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {po.nama_supplier || "-"}
              <span className="text-gray-300"> · </span>
              {formatDate(po.tanggal_po)}
              <span className="text-gray-300"> · </span>
              {formatAmount(po.grand_total || 0)}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link href={`/dashboard/purchasing/print/po/${po.id}`} target="_blank">
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              <Printer className="w-4 h-4 mr-2" />
              Cetak
            </Button>
          </Link>
          
          {normalizedStatus === "draft" && (
            <>
              <Link href={`${RM_ROUTES.purchasingPo}/edit/${po.id}`}>
                <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">Ubah</Button>
              </Link>
              <Button onClick={() => setIsApproveDialogOpen(true)} className="purchasing-main-button w-full sm:w-auto">
                <CheckCircle className="w-4 h-4 mr-2" />
                Setujui
              </Button>
            </>
          )}
          
          {normalizedStatus === "approved" && (
            <Button onClick={() => setIsSendDialogOpen(true)} className="purchasing-main-button w-full sm:w-auto">
              <Send className="w-4 h-4 mr-2" />
              Kirim ke Supplier
            </Button>
          )}

          {["approved", "sent", "partial", "partially_received"].includes(normalizedStatus || "") && (
            <Link
              href={
                po.active_delivery_id
                  ? `${RM_ROUTES.purchasingDelivery}/${po.active_delivery_id}`
                  : `${RM_ROUTES.purchasingDelivery}/insert?po_id=${po.id}`
              }
            >
              <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
                <Truck className="w-4 h-4 mr-2" />
                {po.active_delivery_id
                  ? `Lihat Pengiriman${po.active_delivery_number ? ` ${po.active_delivery_number}` : ""}`
                  : ["partial", "partially_received"].includes(normalizedStatus || "")
                    ? "Kirim Ulang"
                    : "Buat Pengiriman"}
              </Button>
            </Link>
          )}

          {["partial", "partially_received"].includes(normalizedStatus || "") && (
            <Button
              variant="outline"
              onClick={() => setIsCloseDialogOpen(true)}
              className="purchasing-secondary-button w-full sm:w-auto"
            >
              <Lock className="w-4 h-4 mr-2" />
              Tutup PO
            </Button>
          )}
          
          {normalizedStatus !== "received" &&
            normalizedStatus !== "cancelled" &&
            normalizedStatus !== "closed" && (
            <Button variant="outline" onClick={() => setIsCancelDialogOpen(true)} className="h-10 w-full rounded-lg border-red-200 bg-white px-3 text-sm font-medium text-red-600 shadow-sm hover:!border-red-200 hover:!bg-red-50 hover:!text-red-700 sm:w-auto">
              <XCircle className="w-4 h-4 mr-2" />
              Batalkan
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-pink-50 text-pink-600">
                <FileText className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Status Purchase Order</p>
                <div className="mt-1 flex flex-wrap gap-1">{getStatusBadge(po.status)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Banknote className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Total Purchase Order</p>
                <p className="text-lg font-bold text-gray-900">{formatAmount(po.grand_total || payableAmount)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <CreditCard className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Dibayar</p>
                <p className="text-lg font-bold text-emerald-700">{formatAmount(po.paid_amount || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <Boxes className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Progres Keseluruhan</p>
                <p className="text-lg font-bold text-gray-900">{overallProgress}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Info PO */}
        <Card className="border-gray-200/70 shadow-sm lg:col-span-2">
          <CardHeader className="border-b border-gray-100 pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="w-5 h-5" />
              Informasi Purchase Order
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-sm text-gray-500">Status</Label>
                <div className="flex flex-wrap gap-2">
                  {getStatusBadge(po.status)}
                  {getLifecycleBadge()}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-sm text-gray-500">Tanggal PO</Label>
                <div className="font-semibold text-gray-900">{formatDate(po.tanggal_po)}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="flex items-center gap-1 text-sm text-gray-500">
                  <User className="w-4 h-4" />
                  Supplier
                </Label>
                <div className="font-semibold text-gray-900">{po.nama_supplier}</div>
                <div className="text-sm text-gray-500">
                  {po.supplier_kode}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="flex items-center gap-1 text-sm text-gray-500">
                  <Calendar className="w-4 h-4" />
                  Estimasi Pengiriman
                </Label>
                <div className="font-semibold text-gray-900">
                  {formatDate(po.tanggal_kirim_estimasi)}
                </div>
              </div>
            </div>

            {po.catatan && (
              <div className="space-y-1">
                <Label className="text-sm text-gray-500">Catatan</Label>
                <div className="text-gray-700">{po.catatan}</div>
              </div>
            )}

            {po.source_type === "production_order" && (
              <div className="rounded-lg border border-pink-100 bg-pink-50 p-3">
                <Label className="flex items-center gap-1 text-sm text-pink-700">
                  <Factory className="w-4 h-4" />
                  Sumber Purchase Order
                </Label>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge className="bg-pink-600 text-white hover:bg-pink-600">Production Order</Badge>
                  {po.production_order_id ? (
                    <Link
                      href={`/dashboard/purchasing/production/orders/${po.production_order_id}`}
                      className="font-medium text-pink-700 hover:underline"
                    >
                      {po.production_order_number || po.source_reference || po.production_order_id}
                    </Link>
                  ) : (
                    <span className="font-medium">{po.source_reference || "-"}</span>
                  )}
                </div>
              </div>
            )}

            {po.alamat_pengiriman && (
              <div className="space-y-1">
                <Label className="flex items-center gap-1 text-sm text-gray-500">
                  <MapPin className="w-4 h-4" />
                  Alamat Pengiriman
                </Label>
                <div className="text-gray-700">{po.alamat_pengiriman}</div>
              </div>
            )}

            {/* Tracking Info */}
            <div className="mt-4 border-t border-gray-200/70 pt-4">
              <h4 className="mb-3 font-semibold text-gray-900">Pelacakan</h4>
              <div className="space-y-2 text-sm">
                {po.approved_at && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Disetujui</span>
                    <span>{formatDateTime(po.approved_at)}</span>
                  </div>
                )}
                {po.sent_at && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Terkirim via {po.sent_via}</span>
                    <span>{formatDateTime(po.sent_at)}</span>
                  </div>
                )}
                {po.cancelled_at && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Dibatalkan</span>
                    <span>{formatDateTime(po.cancelled_at)}</span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Financial Summary */}
        <Card className="border-gray-200/70 shadow-sm">
          <CardHeader className="border-b border-gray-100 pb-4">
            <CardTitle className="text-base">Ringkasan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(() => {
              // Hitung dari items kalau po.subtotal = 0
              const subtotalFromItems = po.items?.reduce((s: number, i: PurchaseOrderItem & { diskon_item?: number }) =>
                s + (i.subtotal || (i.qty_ordered * i.harga_satuan) - (i.diskon_item || 0)), 0) || 0;
              const subtotal = (po.subtotal && po.subtotal > 0) ? po.subtotal : subtotalFromItems;
              const diskon = po.diskon_nominal || 0;
              const ppnPersen = po.ppn_persen || 0;
              const ppnNominal = po.ppn_nominal && po.ppn_nominal > 0
                ? po.ppn_nominal
                : Math.round((subtotal - diskon) * ppnPersen / 100);
              const total = po.grand_total && po.grand_total > 0
                ? po.grand_total
                : (subtotal - diskon + ppnNominal);
              return (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatAmount(subtotal)}</span>
                  </div>
                  {diskon > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Diskon{po.diskon_persen ? ` (${po.diskon_persen}%)` : ""}</span>
                      <span className="text-red-500">- {formatAmount(diskon)}</span>
                    </div>
                  )}
                  {ppnPersen > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">PPN ({ppnPersen}%)</span>
                      <span>{formatAmount(ppnNominal)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-gray-200/70 pt-2 text-lg font-semibold">
                    <span>Total</span>
                    <span>{formatAmount(total)}</span>
                  </div>
                </>
              );
            })()}

            {normalizedStatus !== "cancelled" && (
              <div className="mt-4 border-t border-gray-200/70 pt-4">
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-900">Progres Keseluruhan Purchase Order</span>
                  <span className="font-semibold text-pink-700">{overallProgress}%</span>
                </div>
                <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={`h-full transition-all duration-500 ${
                      overallProgress >= 100
                        ? "bg-emerald-500"
                        : overallProgress > 0
                          ? "bg-pink-500"
                          : "bg-gray-400"
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, overallProgress))}%` }}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {renderProgressStage(
                    "Pemesanan",
                    orderProgress,
                    getOrderProgressDetail(),
                    "bg-blue-500"
                  )}
                  {renderProgressStage(
                    "Penerimaan",
                    receiptProgress,
                    `${formatQuantity(po.total_qty_received)} / ${formatQuantity(po.total_qty_ordered)} item`,
                    "bg-amber-500"
                  )}
                  {renderProgressStage(
                    "Quality Control",
                    qcProgress,
                    `${formatQuantity(po.total_qty_qc_posted ?? 0)} / ${formatQuantity(po.total_qty_received_grn ?? 0)} diperiksa`,
                    "bg-violet-500"
                  )}
                  {renderProgressStage(
                    "Retur",
                    returnProgress,
                    `${formatQuantity(po.total_qty_returned ?? 0)} / ${formatQuantity(po.total_qty_qc_posted ?? 0)} diretur`,
                    "bg-red-400"
                  )}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
                    <div className="text-xs text-emerald-700">Pembayaran</div>
                    <div className="mt-1 text-right text-sm font-semibold text-emerald-700">
                      {formatAmount(po.paid_amount || 0)}
                    </div>
                    <div className="mt-1 text-right text-xs text-emerald-700/80">
                      dari {formatAmount(payableAmount)} · {paymentProgress}%
                    </div>
                  </div>
                  <div className="rounded-lg border border-pink-100 bg-pink-50 px-3 py-2">
                    <div className="text-xs text-pink-700">Sisa tagihan</div>
                    <div className="mt-1 text-right text-sm font-semibold text-pink-700">
                      {formatAmount(po.outstanding_amount || 0)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {showPaymentManagement && (
      <Card className="border-gray-200/70 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-gray-100 pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <WalletCards className="w-5 h-5" />
            {fromInvoiceContext ? "Pembayaran Invoice" : "Termin Pembayaran & Pembayaran Vendor"}
          </CardTitle>
          <div className="flex flex-wrap gap-2 no-print">
            {!fromInvoiceContext && remainingScheduledAmount > 0 && (
              <Button
                variant="outline"
                onClick={openTermDialog}
                className="purchasing-secondary-button"
              >
                Tambah Cicilan
              </Button>
            )}
            <Button
              onClick={() => openPaymentDialog()}
              disabled={isFullyPaid || createPaymentMutation.isPending}
              className="purchasing-main-button"
            >
              {createPaymentMutation.isPending ? "Memproses..." : "Bayar"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-gray-200/70 bg-gray-50/60 p-3">
              <p className="text-xs font-medium text-gray-500">Status Pembayaran</p>
              <div className="mt-2">{getPaymentStatusBadge(po.payment_status)}</div>
            </div>
            <div className="rounded-lg border border-gray-200/70 bg-gray-50/60 p-3">
              <p className="text-xs font-medium text-gray-500">Tagihan Bersih</p>
              <p className="mt-1 font-semibold text-gray-900">{formatAmount(payableAmount)}</p>
              {(returnCreditAmount > 0 || rejectCreditAmount > 0) && (
                <p className="mt-1 text-xs text-red-600">
                  {returnCreditAmount > 0 && <>Retur -{formatAmount(returnCreditAmount)}</>}
                  {returnCreditAmount > 0 && rejectCreditAmount > 0 && " · "}
                  {rejectCreditAmount > 0 && <>Nota kredit reject -{formatAmount(rejectCreditAmount)}</>}
                  {" dari "}Total PO {formatAmount(grossPayableAmount)}
                </p>
              )}
            </div>
            <div className="rounded-lg border border-gray-200/70 bg-gray-50/60 p-3">
              <p className="text-xs font-medium text-gray-500">Dibayar</p>
              <p className="mt-1 font-semibold text-emerald-600">{formatAmount(po.paid_amount || 0)}</p>
            </div>
            <div className="rounded-lg border border-gray-200/70 bg-gray-50/60 p-3">
              <p className="text-xs font-medium text-gray-500">Jatuh Tempo Berikutnya</p>
              <p className="mt-1 font-semibold text-gray-900">{formatDate(po.next_due_date)}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200/70">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Termin Pembayaran</th>
                  <th className="px-4 py-3 text-left font-semibold">Jatuh Tempo</th>
                  <th className="px-4 py-3 text-right font-semibold">Nominal</th>
                  <th className="px-4 py-3 text-right font-semibold">Dibayar</th>
                  <th className="px-4 py-3 text-center font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold no-print">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {paymentTerms.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                      Belum ada jadwal pembayaran. Gunakan <span className="font-medium text-gray-700">Bayar</span> untuk
                      mencatat pelunasan atau pembayaran sebagian — jadwal akan dibuat otomatis.
                    </td>
                  </tr>
                ) : (
                  paymentTerms.map((term) => {
                    const remaining = Math.max(0, Number(term.amount || 0) - Number(term.paid_amount || 0));
                    return (
                      <tr key={term.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-gray-900">{getTermDisplayLabel(term)}</div>
                          <div className="text-xs text-gray-500">
                            {getTermDisplayLabel(term) === "Lunas"
                              ? "Pelunasan penuh"
                              : `Cicilan ${term.term_no}`}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{formatDate(term.due_date)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatAmount(term.amount)}</td>
                        <td className="px-4 py-3 text-right text-emerald-700">{formatAmount(term.paid_amount)}</td>
                        <td className="px-4 py-3 text-center">{getPaymentStatusBadge(term.status)}</td>
                        <td className="px-4 py-3 text-right no-print">
                          {!fromInvoiceContext && (
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openPaymentDialog(term)}
                                disabled={remaining <= 0}
                                className="h-8 rounded-lg border-gray-200 px-3 text-xs"
                              >
                                Bayar
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openDeleteTermDialog(term)}
                                disabled={Number(term.paid_amount || 0) > 0 || ["partial", "paid"].includes(term.status)}
                                className="h-8 w-8 rounded-lg p-0 text-red-500 hover:bg-red-50 hover:text-red-600 disabled:text-gray-300"
                                title={
                                  Number(term.paid_amount || 0) > 0 || ["partial", "paid"].includes(term.status)
                                    ? "Cicilan yang sudah dibayar tidak dapat dihapus"
                                    : "Hapus cicilan"
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {vendorPayments.length > 0 && (
            <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
              <h4 className="mb-3 font-semibold text-gray-900">Riwayat Pembayaran</h4>
              <div className="space-y-2">
                {vendorPayments.map((payment) => (
                  <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm">
                    <div>
                      <span className="font-semibold text-gray-900">
                        {(() => {
                          const linkedTerm = paymentTermById.get(payment.payment_term_id || "");
                          return linkedTerm ? getTermDisplayLabel(linkedTerm) : "Pembayaran";
                        })()}
                      </span>
                      <div className="text-xs text-gray-500">
                        {payment.payment_number} · {formatDate(payment.payment_date)}
                        {payment.receipt_path && (
                          <>
                            {" · "}
                            <a
                              href={`/api/purchasing/receipts/${payment.receipt_path
                                .replace(/^purchasing-receipts\//, "")
                                .split("/")
                                .map(encodeURIComponent)
                                .join("/")}`}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-pink-600 hover:underline"
                            >
                              Lihat Nota
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="font-semibold text-emerald-700">{formatAmount(payment.amount)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Items Table */}
      <Card className="border-gray-200/70 shadow-sm">
        <CardHeader className="border-b border-gray-100 pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="w-5 h-5" />
            Item Purchase Order
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Bahan Baku</th>
                  <th className="px-4 py-3 text-right font-semibold">Qty</th>
                  <th className="px-4 py-3 text-left font-semibold">Satuan</th>
                  <th className="px-4 py-3 text-right font-semibold">Harga Satuan</th>
                  <th className="px-4 py-3 text-right font-semibold">Subtotal</th>
                {normalizedStatus !== "draft" && normalizedStatus !== "cancelled" && (
                    <th className="px-4 py-3 text-right font-semibold">Qty Diterima</th>
                )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
              {items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{item.raw_material?.nama}</div>
                      <div className="text-xs text-gray-500">
                      {item.raw_material?.kode}
                    </div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{formatQuantity(item.qty_ordered)}</td>
                    <td className="px-4 py-3 text-gray-700">
                    {item.satuan?.nama || item.raw_material?.satuan_besar?.nama || item.raw_material?.satuan || "-"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                    {formatAmount(item.harga_satuan)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {formatAmount(item.subtotal)}
                    </td>
                  {normalizedStatus !== "draft" && normalizedStatus !== "cancelled" && (
                      <td className="px-4 py-3 text-right">
                      <div
                        className={
                          item.qty_received >= item.qty_ordered
                            ? "text-green-600"
                            : item.qty_received > 0
                            ? "text-yellow-600"
                            : "text-gray-400"
                        }
                      >
                        {formatQuantity(item.qty_received)} / {formatQuantity(item.qty_ordered)}
                      </div>
                      </td>
                  )}
                  </tr>
              ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Approve Dialog */}
      <Dialog open={isApproveDialogOpen} onOpenChange={setIsApproveDialogOpen}>
        <DialogContent className="gap-0 overflow-hidden rounded-2xl border border-gray-200/70 p-0 shadow-xl ring-1 ring-gray-200/60 sm:max-w-[420px]">
          <DialogHeader className="border-b border-gray-200/70 px-5 py-4">
            <DialogTitle className="text-base font-semibold text-gray-900">Setujui PO</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-5 text-gray-500">
              Apakah Anda yakin ingin menyetujui purchase order {po.nomor_po}?
              Setelah disetujui, purchase order tidak dapat diubah lagi.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mx-0 mb-0 gap-2 border-t border-gray-200/70 bg-gray-50/60 px-5 py-4 sm:justify-end">
            <Button variant="outline" onClick={() => setIsApproveDialogOpen(false)} disabled={isApproving} className="purchasing-secondary-button">
              Batal
            </Button>
            <Button onClick={handleApprove} disabled={isApproving} className="purchasing-main-button">
              {isApproving ? "Memproses..." : "Setujui"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Dialog */}
      <Dialog open={isSendDialogOpen} onOpenChange={setIsSendDialogOpen}>
        <DialogContent className="gap-0 overflow-hidden rounded-2xl border border-gray-200/70 p-0 shadow-xl ring-1 ring-gray-200/60 sm:max-w-[460px]">
          <DialogHeader className="border-b border-gray-200/70 px-5 py-4">
            <DialogTitle className="text-base font-semibold text-gray-900">Kirim Purchase Order</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-5 text-gray-500">
              Pilih metode pengiriman untuk purchase order {po.nomor_po}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-5 py-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Metode Pengiriman</Label>
              <Combobox
                options={[
                  { value: "EMAIL", label: "Email" },
                  { value: "WHATSAPP", label: "WhatsApp" },
                  { value: "PRINT", label: "Cetak / Manual" },
                  { value: "OTHER", label: "Lainnya" },
                ]}
                value={sendVia}
                onChange={(value) => setSendVia(value as "EMAIL" | "WHATSAPP" | "PRINT" | "OTHER")}
                placeholder="Pilih metode..."
                searchPlaceholder="Cari metode..."
                emptyMessage="Metode tidak ditemukan"
                className="!w-full h-9 text-sm"
              />
            </div>
          </div>
          <DialogFooter className="mx-0 mb-0 gap-2 border-t border-gray-200/70 bg-gray-50/60 px-5 py-4 sm:justify-end">
            <Button variant="outline" onClick={() => setIsSendDialogOpen(false)} disabled={isSending} className="purchasing-secondary-button">
              Batal
            </Button>
            <Button onClick={handleSend} disabled={isSending} className="purchasing-main-button">
              {isSending ? "Mengirim..." : "Kirim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showPaymentManagement && (
      <>
      {/* Payment Term Dialog */}
      <Dialog open={isTermDialogOpen} onOpenChange={setIsTermDialogOpen}>
        <DialogContent className="gap-0 overflow-hidden rounded-2xl border border-gray-200/70 p-0 shadow-xl ring-1 ring-gray-200/60 sm:max-w-[560px]">
          <DialogHeader className="border-b border-gray-200/70 px-5 py-4">
            <DialogTitle className="text-base font-semibold text-gray-900">Tambah Cicilan</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-5 text-gray-500">
              Jadwalkan pembayaran sebagian sebelum dicatat. Pelunasan penuh PO dilakukan langsung
              dari aksi Bayar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-5 py-4">
            <div className="rounded-xl border border-pink-100 bg-pink-50 p-3">
              <div className="text-xs font-semibold text-pink-700">Sisa nominal yang belum dijadwalkan</div>
              <div className="mt-1 text-lg font-bold text-pink-700">{formatAmount(remainingScheduledAmount)}</div>
              <div className="mt-1 text-xs text-pink-700/80">
                Total purchase order {formatAmount(payableAmount)} · Sudah dijadwalkan {formatAmount(scheduledAmount)}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Nama Termin Pembayaran</Label>
              <Input
                value={termForm.description}
                onChange={(event) => setTermForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Contoh: DP 30%, Termin 2, Pelunasan"
                className="h-9 text-sm"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <DsDateTimePicker
                label="Jatuh Tempo"
                value={termForm.due_date}
                onChange={(value) => setTermForm((prev) => ({ ...prev, due_date: value }))}
                placeholder="Pilih tanggal jatuh tempo..."
                dateOnly
                required
              />
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">Nominal</Label>
                  {remainingScheduledAmount > 0 && (
                    <button
                      type="button"
                      className="text-xs font-medium text-pink-600 hover:underline"
                      onClick={() => setTermForm((prev) => ({ ...prev, amount: remainingScheduledAmount }))}
                    >
                      Gunakan sisa
                    </button>
                  )}
                </div>
                <NumericInput
                  value={termForm.amount}
                  max={remainingScheduledAmount}
                  onValueChange={(value) => setTermForm((prev) => ({ ...prev, amount: value || undefined }))}
                  decimalScale={0}
                  className="h-9 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Catatan</Label>
              <Input
                value={termForm.notes}
                onChange={(event) => setTermForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Opsional"
                className="h-9 text-sm"
              />
            </div>
          </div>
          <DialogFooter className="mx-0 mb-0 gap-2 border-t border-gray-200/70 bg-gray-50/60 px-5 py-4 sm:justify-end">
            <Button variant="outline" onClick={() => setIsTermDialogOpen(false)} className="purchasing-secondary-button">
              Batal
            </Button>
            <Button onClick={handleCreateTerm} disabled={createTermMutation.isPending} className="purchasing-main-button">
              Simpan Termin Pembayaran
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Payment Term Dialog */}
      <Dialog open={isDeleteTermDialogOpen} onOpenChange={setIsDeleteTermDialogOpen}>
        <DialogContent className="gap-0 overflow-hidden rounded-2xl border border-gray-200/70 p-0 shadow-xl ring-1 ring-gray-200/60 sm:max-w-[440px]">
          <DialogHeader className="border-b border-gray-200/70 px-5 py-4">
            <DialogTitle className="text-base font-semibold text-gray-900">Hapus Termin Pembayaran</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-5 text-gray-500">
              Termin pembayaran ini akan dihapus dari jadwal dan nominalnya kembali tersedia untuk termin baru.
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 py-4">
            <div className="rounded-xl border border-red-100 bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-700">
                {deletingTerm?.description || `Termin Pembayaran ${deletingTerm?.term_no || ""}`}
              </p>
              <p className="mt-1 text-xs text-red-700/80">
                Nominal {formatAmount(Number(deletingTerm?.amount || 0))}. Hanya termin yang belum dibayar yang dapat dihapus.
              </p>
            </div>
          </div>
          <DialogFooter className="mx-0 mb-0 gap-2 border-t border-gray-200/70 bg-gray-50/60 px-5 py-4 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setIsDeleteTermDialogOpen(false)}
              disabled={isDeletingTerm}
              className="purchasing-secondary-button"
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteTerm}
              disabled={isDeletingTerm}
              className="purchasing-main-button"
            >
              {isDeletingTerm ? "Menghapus..." : "Hapus Termin Pembayaran"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vendor Payment Dialog */}
      <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
        <DialogContent className="gap-0 overflow-hidden rounded-2xl border border-gray-200/70 p-0 shadow-xl ring-1 ring-gray-200/60 sm:max-w-[620px]">
          <DialogHeader className="border-b border-gray-200/70 px-5 py-4">
            <DialogTitle className="text-base font-semibold text-gray-900">Bayar Purchase Order</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-5 text-gray-500">
              Catat pembayaran untuk purchase order ini. Pelunasan penuh diberi label{" "}
              <span className="font-medium text-gray-700">Lunas</span>; nominal lebih kecil dicatat
              sebagai cicilan.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-5 py-4">
            <div className="rounded-xl border border-pink-100 bg-pink-50 p-3">
              <div className="text-xs font-semibold text-pink-700">Sisa tagihan</div>
              <div className="mt-1 text-lg font-bold text-pink-700">{formatAmount(poOutstandingAmount)}</div>
              <div className="mt-1 text-xs text-pink-700/80">
                Total PO {formatAmount(grossPayableAmount)}
                {returnCreditAmount > 0 && <> · Retur -{formatAmount(returnCreditAmount)}</>}
                {rejectCreditAmount > 0 && <> · Nota kredit reject -{formatAmount(rejectCreditAmount)}</>}
                {" · "}Tagihan bersih {formatAmount(payableAmount)} · Dibayar {formatAmount(po?.paid_amount || 0)}
              </div>
            </div>

            {paymentPreviewType && (
              <div
                className={`rounded-xl border px-3 py-2 text-sm ${
                  paymentPreviewType === "full"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {paymentPreviewType === "full"
                  ? "Pembayaran ini akan dicatat sebagai Lunas."
                  : "Pembayaran ini akan dicatat sebagai cicilan."}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <DsDateTimePicker
                label="Tanggal Pembayaran"
                value={paymentForm.payment_date}
                onChange={(value) => setPaymentForm((prev) => ({ ...prev, payment_date: value }))}
                placeholder="Pilih tanggal pembayaran..."
                dateOnly
                required
              />
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">Nominal Pembayaran</Label>
                  {poOutstandingAmount > 0 && (
                    <button
                      type="button"
                      className="text-xs font-medium text-pink-600 hover:underline"
                      onClick={() =>
                        setPaymentForm((prev) => ({ ...prev, amount: poOutstandingAmount }))
                      }
                    >
                      Bayar lunas
                    </button>
                  )}
                </div>
                <NumericInput
                  value={paymentForm.amount}
                  max={poOutstandingAmount}
                  onValueChange={(value) => setPaymentForm((prev) => ({ ...prev, amount: value || undefined }))}
                  decimalScale={0}
                  className="h-9 text-sm"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Metode</Label>
                <Combobox
                  options={[
                    { value: "bank_transfer", label: "Transfer Bank" },
                    { value: "cash", label: "Tunai" },
                    { value: "giro", label: "Giro" },
                    { value: "qris", label: "QRIS" },
                    { value: "other", label: "Lainnya" },
                  ]}
                  value={paymentForm.method}
                  onChange={(value) => setPaymentForm((prev) => ({ ...prev, method: value as VendorPayment["method"] }))}
                  placeholder="Pilih metode..."
                  searchPlaceholder="Cari metode..."
                  emptyMessage="Metode tidak ditemukan"
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Nomor Referensi</Label>
                <Input
                  value={paymentForm.reference_number}
                  onChange={(event) => setPaymentForm((prev) => ({ ...prev, reference_number: event.target.value }))}
                  placeholder="Nomor transfer / bukti pembayaran"
                  className="h-9 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Catatan</Label>
              <Input
                value={paymentForm.notes}
                onChange={(event) => setPaymentForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Opsional"
                className="h-9 text-sm"
              />
            </div>
          </div>
          <DialogFooter className="mx-0 mb-0 gap-2 border-t border-gray-200/70 bg-gray-50/60 px-5 py-4 sm:justify-end">
            <Button variant="outline" onClick={() => setIsPaymentDialogOpen(false)} className="purchasing-secondary-button">
              Batal
            </Button>
            <Button
              onClick={handleCreatePayment}
              disabled={createPaymentMutation.isPending || isFullyPaid}
              className="purchasing-main-button"
            >
              {createPaymentMutation.isPending ? "Memproses..." : "Simpan Pembayaran"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </>
      )}

      {/* Cancel Dialog */}
      <Dialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
        <DialogContent className="gap-0 overflow-hidden rounded-2xl border border-gray-200/70 p-0 shadow-xl ring-1 ring-gray-200/60 sm:max-w-[460px]">
          <DialogHeader className="border-b border-gray-200/70 px-5 py-4">
            <DialogTitle className="text-base font-semibold text-gray-900">Batalkan Purchase Order</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-5 text-gray-500">
              Apakah Anda yakin ingin membatalkan purchase order {po.nomor_po}?
              Masukkan alasan pembatalan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-5 py-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Alasan Pembatalan *</Label>
              <Input
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Masukkan alasan..."
                className="h-9 text-sm"
              />
            </div>
          </div>
          <DialogFooter className="mx-0 mb-0 gap-2 border-t border-gray-200/70 bg-gray-50/60 px-5 py-4 sm:justify-end">
            <Button variant="outline" onClick={() => setIsCancelDialogOpen(false)} className="purchasing-secondary-button">
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={!cancelReason || cancelMutation.isPending}
              className="purchasing-main-button"
            >
              {cancelMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Batalkan Purchase Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Dialog — shortage will not be billed; no more deliveries */}
      <Dialog open={isCloseDialogOpen} onOpenChange={setIsCloseDialogOpen}>
        <DialogContent className="gap-0 overflow-hidden rounded-2xl border border-gray-200/70 p-0 shadow-xl ring-1 ring-gray-200/60 sm:max-w-[460px]">
          <DialogHeader className="border-b border-gray-200/70 px-5 py-4">
            <DialogTitle className="text-base font-semibold text-gray-900">Tutup Purchase Order</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-5 text-gray-500">
              Tutup {po.nomor_po} jika supplier tidak akan mengirim sisa barang.
              Tagihan hanya menghitung qty yang sudah diterima (lolos QC). Pengiriman baru tidak lagi diizinkan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-5 py-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Alasan Penutupan *</Label>
              <Input
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                placeholder="Contoh: Supplier tidak mengganti barang gagal QC"
                className="h-9 text-sm"
              />
            </div>
          </div>
          <DialogFooter className="mx-0 mb-0 gap-2 border-t border-gray-200/70 bg-gray-50/60 px-5 py-4 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setIsCloseDialogOpen(false)}
              className="purchasing-secondary-button"
              disabled={closeMutation.isPending}
            >
              Batal
            </Button>
            <Button
              onClick={handleClose}
              disabled={!closeReason.trim() || closeMutation.isPending}
              className="purchasing-main-button"
            >
              {closeMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Lock className="mr-2 h-4 w-4" />
              )}
              Tutup Purchase Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
