"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Combobox } from "@/components/ui/combobox";
import { ArrowLeft, CheckCircle, Loader2, Printer, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { formatRp, formatDate } from "@/lib/purchasing/utils";
import { GENERAL_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { NAV_FROM_APPROVAL_PO } from "@/lib/iam/nav-context";
import { useNavFrom } from "@/lib/iam/use-nav-from";
import { useGeneralPurchaseOrder } from "../queries";
import {
  useApproveGeneralPurchaseOrder,
  useCancelGeneralPurchaseOrder,
  useSendGeneralPurchaseOrder,
} from "../mutations";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  approved: "Disetujui",
  sent: "Dikirim",
  partially_received: "Diterima Sebagian",
  received: "Diterima",
  cancelled: "Dibatalkan",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "border-gray-200 bg-gray-50 text-gray-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  sent: "border-blue-200 bg-blue-50 text-blue-700",
  partially_received: "border-amber-200 bg-amber-50 text-amber-700",
  received: "border-green-200 bg-green-50 text-green-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

export function GeneralPODetailPage() {
  const params = useParams();
  const poId = params.id as string;
  const navFrom = useNavFrom();
  const fromApproval = navFrom === NAV_FROM_APPROVAL_PO;
  const backHref = fromApproval ? GENERAL_ROUTES.approvalPo : GENERAL_ROUTES.purchasingPo;
  const backLabel = fromApproval ? "Kembali ke Approval" : "Kembali";
  const { data: po, isLoading, isError } = useGeneralPurchaseOrder(poId);

  const approveMutation = useApproveGeneralPurchaseOrder();
  const sendMutation = useSendGeneralPurchaseOrder();
  const cancelMutation = useCancelGeneralPurchaseOrder();

  const [sendOpen, setSendOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [sendVia, setSendVia] = useState<"EMAIL" | "WHATSAPP" | "PRINT" | "OTHER">("EMAIL");
  const [cancelReason, setCancelReason] = useState("");

  if (isLoading) {
    return (
      <div className="flex min-h-56 items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-pink-600" />
        Memuat purchase order...
      </div>
    );
  }

  if (isError || !po) {
    return <div className="py-12 text-center text-sm text-red-600">Purchase order tidak ditemukan.</div>;
  }

  const statusStyle = STATUS_STYLES[po.status] || STATUS_STYLES.draft;
  const statusLabel = STATUS_LABELS[po.status] || po.status.replace(/_/g, " ");

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
              <Badge variant="outline" className={statusStyle}>
                {statusLabel}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {formatDate(po.tanggal_po)} · {po.vendor_name || "-"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {po.status === "draft" && (
            <Button
              className="purchasing-main-button"
              disabled={approveMutation.isPending}
              onClick={async () => {
                try {
                  await approveMutation.mutateAsync(poId);
                  toast.success("Purchase order disetujui.");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Gagal menyetujui.");
                }
              }}
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              Setujui
            </Button>
          )}
          {po.status === "approved" && (
            <Button className="purchasing-main-button" onClick={() => setSendOpen(true)}>
              <Send className="mr-2 h-4 w-4" />
              Kirim
            </Button>
          )}
          {po.status !== "cancelled" && po.status !== "received" && (
            <Button variant="outline" className="border-red-200 text-red-600" onClick={() => setCancelOpen(true)}>
              <XCircle className="mr-2 h-4 w-4" />
              Batalkan
            </Button>
          )}
          <Link href={`/dashboard/purchasing/print/po/${poId}`} target="_blank">
            <Button variant="outline" className="purchasing-secondary-button">
              <Printer className="mr-2 h-4 w-4" />
              Cetak
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="text-base">Informasi Order</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 p-4 md:grid-cols-2 text-sm">
              <div><p className="text-xs text-gray-500">Vendor</p><p className="font-medium">{po.vendor_name || "-"}</p></div>
              <div><p className="text-xs text-gray-500">Kode Vendor</p><p className="font-medium">{po.vendor_code || "-"}</p></div>
              <div><p className="text-xs text-gray-500">Tanggal PO</p><p className="font-medium">{formatDate(po.tanggal_po)}</p></div>
              <div><p className="text-xs text-gray-500">Estimasi Kirim</p><p className="font-medium">{po.tanggal_kirim_estimasi ? formatDate(po.tanggal_kirim_estimasi) : "-"}</p></div>
              {po.pr_number && (
                <div><p className="text-xs text-gray-500">Sumber PR</p><p className="font-medium">{po.pr_number}</p></div>
              )}
              {po.alamat_pengiriman && (
                <div className="md:col-span-2"><p className="text-xs text-gray-500">Alamat Pengiriman</p><p>{po.alamat_pengiriman}</p></div>
              )}
              {po.catatan && (
                <div className="md:col-span-2"><p className="text-xs text-gray-500">Catatan</p><p>{po.catatan}</p></div>
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="text-base">Item Order</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto p-4">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Barang</th>
                      <th className="px-4 py-3 text-right">Qty Pesan</th>
                      <th className="px-4 py-3 text-right">Qty Terima</th>
                      <th className="px-4 py-3 text-right">Harga Satuan</th>
                      <th className="px-4 py-3 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(po.items || []).map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{item.supply_item?.nama || item.catatan || "-"}</span>
                            {item.supply_item?.stockable !== undefined && (
                              <Badge
                                className={
                                  item.supply_item?.stockable
                                    ? "border-0 bg-blue-100 text-blue-700"
                                    : "border-0 bg-gray-100 text-gray-600"
                                }
                              >
                                {item.supply_item?.stockable ? "Stok" : "Expense"}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-gray-500">{item.supply_item?.kode}</div>
                        </td>
                        <td className="px-4 py-3 text-right">{item.qty_ordered}</td>
                        <td className="px-4 py-3 text-right">{item.qty_received ?? 0}</td>
                        <td className="px-4 py-3 text-right">{formatRp(item.harga_satuan || 0)}</td>
                        <td className="px-4 py-3 text-right font-medium">{formatRp(item.subtotal || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-gray-200/70 shadow-xs xl:col-span-4 xl:sticky xl:top-6">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="text-base">Ringkasan Keuangan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatRp(po.subtotal || 0)}</span></div>
            <div className="flex justify-between"><span>Diskon</span><span>{formatRp(po.diskon_nominal || 0)}</span></div>
            <div className="flex justify-between"><span>PPN</span><span>{formatRp(po.ppn_nominal || 0)}</span></div>
            <div className="flex justify-between border-t border-gray-200/70 pt-2 font-semibold">
              <span>Total</span><span className="text-pink-700">{formatRp(po.grand_total ?? po.total ?? 0)}</span>
            </div>
            <div className="flex justify-between text-gray-500"><span>Dibayar</span><span>{formatRp(po.paid_amount || 0)}</span></div>
            <div className="flex justify-between text-gray-500"><span>Sisa</span><span>{formatRp(po.outstanding_amount || 0)}</span></div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kirim Purchase Order</DialogTitle>
            <DialogDescription>Tandai purchase order ini sudah dikirim ke vendor.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Kirim Via</Label>
            <Combobox
              options={[
                { value: "EMAIL", label: "Email" },
                { value: "WHATSAPP", label: "WhatsApp" },
                { value: "PRINT", label: "Cetak" },
                { value: "OTHER", label: "Lainnya" },
              ]}
              value={sendVia}
              onChange={(v) => setSendVia(v as typeof sendVia)}
              placeholder="Pilih metode..."
              className="h-9 text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendOpen(false)}>Batal</Button>
            <Button
              className="purchasing-main-button"
              disabled={sendMutation.isPending}
              onClick={async () => {
                try {
                  await sendMutation.mutateAsync({ id: poId, sentVia: sendVia });
                  toast.success("Purchase order ditandai sudah dikirim.");
                  setSendOpen(false);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Gagal mengirim.");
                }
              }}
            >
              Konfirmasi Kirim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Batalkan Purchase Order</DialogTitle>
            <DialogDescription>Tindakan ini tidak dapat dibatalkan.</DialogDescription>
          </DialogHeader>
          <Textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Alasan pembatalan..."
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Tutup</Button>
            <Button
              variant="outline"
              className="border-red-200 text-red-600"
              disabled={!cancelReason.trim() || cancelMutation.isPending}
              onClick={async () => {
                try {
                  await cancelMutation.mutateAsync({ id: poId, reason: cancelReason.trim() });
                  toast.success("Purchase order dibatalkan.");
                  setCancelOpen(false);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Gagal membatalkan.");
                }
              }}
            >
              Batalkan PO
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
