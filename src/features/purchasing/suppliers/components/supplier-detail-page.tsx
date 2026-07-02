"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import PurchasingGuard from "@/modules/purchasing/components/auth/PurchasingGuard";
import { SupplierPriceHistoryPanel } from "@/modules/purchasing/components/supplier-price-history/SupplierPriceHistoryPanel";
import {
  Building2,
  Pencil,
  Power,
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  FileText,
  TrendingUp,
  Truck,
  User,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { SupplierPOSummary } from "@/types/supplier";
import { useSupplier, useSupplierPOHistory } from "../queries";
import { useDeleteSupplier } from "../mutations";
import { suppliersQueryKeys } from "../query-keys";
import { useAuth } from "@/hooks/use-auth";
import { formatAmount } from "@/lib/purchasing/utils";
import { toast } from "sonner";

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMoney(amount: number, currency = "IDR") {
  return `${formatAmount(amount)} ${currency}`;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function SupplierDetailPage() {
  return (
    <PurchasingGuard minRole="purchasing_staff">
      <SupplierDetailInner />
    </PurchasingGuard>
  );
}

function SupplierDetailInner() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const supplierId = params.id as string;
  const isAdmin = user?.role === "purchasing_admin";

  const supplierQuery = useSupplier(supplierId);
  const supplier = supplierQuery.data ?? null;
  const loading = supplierQuery.isLoading;

  const poHistoryQuery = useSupplierPOHistory(supplierId);
  const poHistory: SupplierPOSummary[] = poHistoryQuery.data?.data ?? [];
  const poLoading = poHistoryQuery.isLoading;

  const [deactivateDialog, setDeactivateDialog] = useState(false);
  const deactivateMutation = useDeleteSupplier();
  const deactivateLoading = deactivateMutation.isPending;

  useEffect(() => {
    if (supplierQuery.isError) {
      toast.error(getErrorMessage(supplierQuery.error, "Failed to load supplier."));
      router.push("/dashboard/purchasing/suppliers");
    }
  }, [supplierQuery.isError, supplierQuery.error, router]);

  async function handleDeactivate() {
    if (!supplier || deactivateLoading) return;
    try {
      await deactivateMutation.mutateAsync(supplier.id);
      toast.success(`Supplier "${supplier.nama_supplier}" deactivated successfully.`);
      setDeactivateDialog(false);
      queryClient.invalidateQueries({ queryKey: suppliersQueryKeys.detail(supplierId) });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to deactivate supplier."));
    }
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center text-gray-400">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-pink-600" />
          <p>Loading supplier...</p>
        </div>
      </div>
    );
  }

  if (!supplier) return null;

  const a = supplier.analytics;

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-8">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{supplier.nama_supplier}</h1>
            <Badge
              variant={supplier.is_active ? "default" : "secondary"}
              className={supplier.is_active ? "bg-green-100 text-green-700 hover:bg-green-100" : ""}
            >
              {supplier.is_active ? "Active" : "Inactive"}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            {supplier.kode && (
              <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700">
                {supplier.kode}
              </span>
            )}
            {supplier.kode && supplier.kota && <span className="text-gray-300">•</span>}
            {supplier.kota && <span>{supplier.kota}</span>}
            {(supplier.kode || supplier.kota) && supplier.created_at && (
              <span className="text-gray-300">•</span>
            )}
            {supplier.created_at && <span>Joined {formatDate(supplier.created_at)}</span>}
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Link href="/dashboard/purchasing/suppliers">
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          {isAdmin && supplier.is_active && (
            <Button
              variant="outline"
              onClick={() => setDeactivateDialog(true)}
              className="h-10 w-full rounded-lg border-red-200 bg-white px-3 text-sm font-medium text-red-600 shadow-sm hover:!border-red-200 hover:!bg-red-50 hover:!text-red-700 sm:w-auto"
            >
              <Power className="mr-2 h-4 w-4" />
              Deactivate
            </Button>
          )}
          {isAdmin && (
            <Link href={`/dashboard/purchasing/suppliers/edit/${supplier.id}`}>
              <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {a.po_aktif_count > 0 && (
          <Card className="border-gray-200/70 shadow-xs">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                  <FileText className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Active Purchase Orders</p>
                  <p className="text-lg font-bold">{a.po_aktif_count}</p>
                  {a.po_aktif_nilai > 0 && (
                    <p className="text-xs text-gray-400">
                      {formatMoney(a.po_aktif_nilai, supplier.currency)}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        {a.jumlah_po_12_bulan > 0 && (
          <Card className="border-gray-200/70 shadow-xs">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50">
                  <TrendingUp className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Transactions (12 months)</p>
                  <p className="text-lg font-bold">{a.jumlah_po_12_bulan}</p>
                  {a.total_transaksi_12_bulan > 0 && (
                    <p className="text-xs text-gray-400">
                      {formatMoney(a.total_transaksi_12_bulan, supplier.currency)}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        {a.on_time_delivery_rate > 0 && (
          <Card className="border-gray-200/70 shadow-xs">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50">
                  <Truck className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">On-Time Delivery</p>
                  <p className="text-lg font-bold">{a.on_time_delivery_rate.toFixed(1)}%</p>
                  <p className="text-xs text-gray-400">Last 12 months</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        {supplier.payment_terms && (
          <Card className="border-gray-200/70 shadow-xs">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50">
                  <CreditCard className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Payment Terms</p>
                  <p className="text-lg font-bold">{supplier.payment_terms.replace("TOP", "TOP ")}</p>
                  <p className="text-xs text-gray-400">{supplier.currency}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Building2 className="h-4 w-4 text-blue-600" />
              Company Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4 text-sm">
            <InfoRow label="Name" value={supplier.nama_supplier} />
            <InfoRow label="Code" value={supplier.kode} />
            <InfoRow label="Category" value={supplier.kategori} />
            <InfoRow label="Tax ID" value={supplier.npwp} />
            <InfoRow label="Currency" value={supplier.currency} />
            {supplier.alamat && (
              <div className="border-t border-gray-200/70 pt-3">
                <div className="flex gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  <div>
                    <p className="mb-1 text-xs text-gray-500">Address</p>
                    <p className="whitespace-pre-wrap text-gray-900">{supplier.alamat}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <CreditCard className="h-4 w-4 text-amber-600" />
              Payment & Bank
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4 text-sm">
            <InfoRow label="Payment Terms" value={supplier.payment_terms?.replace("TOP", "TOP ")} />
            {(supplier.bank_nama || supplier.bank_rekening || supplier.bank_atas_nama) && (
              <div className="space-y-3 border-t border-gray-200/70 pt-3">
                <InfoRow label="Bank" value={supplier.bank_nama} />
                <InfoRow label="Account Number" value={supplier.bank_rekening} />
                <InfoRow label="Account Name" value={supplier.bank_atas_nama} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="border-b border-gray-200/70 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <User className="h-4 w-4 text-blue-600" />
            Contact Person
          </CardTitle>
        </CardHeader>
        <CardContent className="max-w-2xl space-y-3 pt-4 text-sm">
          {supplier.pic_name || supplier.pic_jabatan || supplier.email || supplier.pic_phone ? (
            <>
              <InfoRow label="Name" value={supplier.pic_name} icon={User} />
              <InfoRow label="Position" value={supplier.pic_jabatan} icon={User} />
              <InfoRow label="Email" value={supplier.email} icon={Mail} />
              <InfoRow label="Phone" value={supplier.pic_phone} icon={Phone} />
            </>
          ) : (
            <div className="py-8 text-center text-gray-400">
              <User className="mx-auto mb-2 h-12 w-12 opacity-20" />
              <p className="text-sm">No contact information available</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="border-b border-gray-200/70 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4 text-purple-600" />
            Purchase Order History
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {poLoading ? (
            <div className="py-8 text-center text-gray-400">Loading...</div>
          ) : poHistory.length === 0 ? (
            <div className="py-8 text-center text-gray-400">
              <FileText className="mx-auto mb-2 h-12 w-12 opacity-20" />
              <p className="text-sm">No purchase orders yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200/70 bg-gray-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-gray-600">Purchase Order</th>
                    <th className="px-4 py-2.5 text-left font-medium text-gray-600">Date</th>
                    <th className="px-4 py-2.5 text-left font-medium text-gray-600">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium text-gray-600">Items</th>
                    <th className="px-4 py-2.5 text-right font-medium text-gray-600">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {poHistory.map((po) => (
                    <tr key={po.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono font-medium text-blue-600">{po.po_number}</td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(po.tanggal)}</td>
                      <td className="px-4 py-3">
                        <POStatusBadge status={po.status} />
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{po.jumlah_item}</td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {formatMoney(po.total, po.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="border-b border-gray-200/70 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4 text-green-600" />
            Frequently Purchased Materials
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {a.bahan_sering_dibeli?.length ? (
            <div className="flex flex-wrap gap-2">
              {a.bahan_sering_dibeli.map((bahan, i) => (
                <Badge key={i} variant="secondary" className="bg-green-50 text-green-700 hover:bg-green-100">
                  {bahan}
                </Badge>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-gray-400">
              <FileText className="mx-auto mb-2 h-12 w-12 opacity-20" />
              <p className="text-sm">No material purchase data yet</p>
            </div>
          )}
        </CardContent>
      </Card>

      <SupplierPriceHistoryPanel supplierId={supplier.id} supplierName={supplier.nama_supplier} />

      <ConfirmDialog
        open={deactivateDialog}
        onOpenChange={setDeactivateDialog}
        title="Deactivate Supplier?"
        description={`Are you sure you want to deactivate "${supplier.nama_supplier}"? The supplier will no longer appear in active lists.`}
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        loadingLabel="Deactivating..."
        loading={deactivateLoading}
        onConfirm={handleDeactivate}
      />
    </div>
  );
}

function InfoRow({ label, value, icon: Icon }: { label: string; value?: string | null; icon?: LucideIcon }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />}
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="break-all font-medium text-gray-900">{value}</p>
      </div>
    </div>
  );
}

function POStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft: { label: "Draft", className: "bg-gray-100 text-gray-600" },
    pending_head: { label: "Pending Head", className: "bg-yellow-100 text-yellow-700" },
    pending_finance: { label: "Pending Finance", className: "bg-orange-100 text-orange-700" },
    approved: { label: "Approved", className: "bg-blue-100 text-blue-700" },
    sent: { label: "Sent", className: "bg-purple-100 text-purple-700" },
    partially_received: { label: "Partial", className: "bg-indigo-100 text-indigo-700" },
    received: { label: "Received", className: "bg-green-100 text-green-700" },
    cancelled: { label: "Cancelled", className: "bg-gray-200 text-gray-500" },
  };
  const cfg = map[status] || { label: status, className: "bg-gray-100 text-gray-600" };
  return <Badge className={cfg.className}>{cfg.label}</Badge>;
}
