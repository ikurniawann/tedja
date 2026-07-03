"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ArrowLeft, Edit, Trash2, DollarSign, Package, Truck, CalendarDays, Star, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatAmount } from "@/lib/purchasing/utils";
import { usePriceList } from "../queries";
import { useDeletePriceList } from "../mutations";

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatNumber(num?: number | null) {
  return formatAmount(num, { maximumFractionDigits: 4 });
}

export function PriceListDetailPage() {
  const params = useParams();
  const router = useRouter();
  const priceListId = params.id as string;

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const priceListQuery = usePriceList(priceListId);
  const priceList = priceListQuery.data ?? null;
  const loading = priceListQuery.isLoading;
  const deleteMutation = useDeletePriceList();
  const isDeleting = deleteMutation.isPending;

  const getErrorMessage = (error: unknown, fallback: string) => {
    return error instanceof Error ? error.message : fallback;
  };

  const handleDelete = async () => {
    if (!priceList || isDeleting) return;
    try {
      await deleteMutation.mutateAsync(priceList.id);
      toast.success("Price list deleted successfully.");
      setIsDeleteDialogOpen(false);
      router.push("/dashboard/purchasing/price-list");
    } catch (error: unknown) {
      console.error("Error deleting price list:", error);
      toast.error(getErrorMessage(error, "Failed to delete price list."));
    }
  };

  const unitName = priceList?.satuan?.nama || "unit";
  const supplierCode = priceList?.supplier?.kode_supplier || priceList?.supplier?.kode || "-";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-pink-600" />
      </div>
    );
  }

  if (!priceList) {
    return (
      <div className="py-12 text-center text-red-500">Price list not found.</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{priceList.supplier?.nama_supplier}</h1>
            {priceList.is_preferred && (
              <Badge className="bg-blue-100 text-blue-800">Preferred</Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span>{priceList.bahan_baku?.nama || "-"}</span>
            <span className="text-gray-300">•</span>
            <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700">
              {priceList.bahan_baku?.kode || "-"}
            </span>
            <span className="text-gray-300">•</span>
            <span>{formatAmount(priceList.harga || 0)}</span>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Link href="/dashboard/purchasing/price-list">
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <Link href={`/dashboard/purchasing/price-list/edit/${priceList.id}`}>
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Button>
          </Link>
          <Button
            variant="outline"
            onClick={() => setIsDeleteDialogOpen(true)}
            className="h-10 w-full rounded-lg border-red-200 bg-white px-3 text-sm font-medium text-red-600 shadow-sm hover:!border-red-200 hover:!bg-red-50 hover:!text-red-700 sm:w-auto"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-pink-50 text-pink-600">
                <DollarSign className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Price per Unit</p>
                <p className="text-lg font-bold text-gray-900">{formatAmount(priceList.harga)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Package className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Minimum Quantity</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatNumber(priceList.minimum_qty)} {unitName}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <Truck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Lead Time</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatNumber(priceList.lead_time_days)} days
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <Star className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Supplier Status</p>
                <p className="text-lg font-bold text-gray-900">
                  {priceList.is_preferred ? "Preferred" : "Regular"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="border-gray-200/70 shadow-xs lg:col-span-2">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-5 w-5" />
              Pricing Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Supplier</p>
                <p className="font-semibold text-gray-900">{priceList.supplier?.nama_supplier || "-"}</p>
                <p className="text-sm text-gray-500">{supplierCode}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Raw Material</p>
                <p className="font-semibold text-gray-900">{priceList.bahan_baku?.nama || "-"}</p>
                <p className="text-sm text-gray-500">{priceList.bahan_baku?.kode || "-"}</p>
              </div>
            </div>
            <div className="border-t border-gray-200/70 pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-gray-500">Price per Unit</span>
                <span className="text-2xl font-bold text-gray-900">{formatAmount(priceList.harga)}</span>
              </div>
              <p className="text-sm text-gray-500">per {unitName}</p>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-gray-200/70 pt-4">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Minimum Quantity</p>
                  <p className="font-semibold text-gray-900">
                    {formatNumber(priceList.minimum_qty)} {unitName}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Lead Time</p>
                  <p className="font-semibold text-gray-900">
                    {formatNumber(priceList.lead_time_days)} days
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-5 w-5" />
              Validity Period
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div>
              <p className="text-sm text-gray-500">Effective From</p>
              <p className="font-semibold text-gray-900">{formatDate(priceList.berlaku_dari)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Effective Until</p>
              <p className="font-semibold text-gray-900">{formatDate(priceList.berlaku_sampai)}</p>
            </div>
            {priceList.catatan && (
              <div className="border-t border-gray-200/70 pt-4">
                <p className="mb-2 text-sm text-gray-500">Notes</p>
                <p className="text-sm text-gray-700">{priceList.catatan}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Delete Price List?"
        description="Are you sure you want to delete this price list? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loadingLabel="Deleting..."
        loading={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
