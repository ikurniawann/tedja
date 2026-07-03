"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatDate } from "@/lib/purchasing/utils";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { useProductDelivery } from "../queries";
import type { ProductDeliveryStatus } from "../types";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  ClipboardList,
  Loader2,
  Truck,
} from "lucide-react";

const RECEIVE_INSERT = PRODUCT_ROUTES.purchasingReceiveInsert;

const STATUS_COLORS: Record<ProductDeliveryStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  shipped: "bg-blue-50 text-blue-700 border-blue-200",
  in_transit: "bg-indigo-50 text-indigo-700 border-indigo-200",
  delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-gray-100 text-gray-600 border-gray-200",
};

const STATUS_LABELS: Record<ProductDeliveryStatus, string> = {
  pending: "Pending Receipt",
  shipped: "Shipped",
  in_transit: "In Transit",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export function ProductDeliveryDetailPage() {
  const router = useRouter();
  const params = useParams();
  const deliveryId = params.id as string;

  const detailQuery = useProductDelivery(deliveryId);
  const delivery = detailQuery.data ?? null;

  useEffect(() => {
    if (!detailQuery.isError) return;
    toast.error("Delivery not found");
    router.push(PRODUCT_ROUTES.purchasingDelivery);
  }, [detailQuery.isError, router]);

  if (detailQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-6 w-6 animate-spin text-gray-400" />
        Loading delivery...
      </div>
    );
  }

  if (!delivery) {
    return (
      <div className="space-y-4">
        <Link href={PRODUCT_ROUTES.purchasingDelivery}>
          <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <div className="py-12 text-center text-gray-500">Delivery not found.</div>
      </div>
    );
  }

  const isDelivered = delivery.status === "delivered";
  const canReceive = !isDelivered && delivery.status !== "cancelled";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4">
        <div className="flex items-start gap-3">
          <Link href={PRODUCT_ROUTES.purchasingDelivery}>
            <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">
                {delivery.nomor_resi || "Delivery Detail"}
              </h1>
              <Badge className={STATUS_COLORS[delivery.status]}>
                {STATUS_LABELS[delivery.status]}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {delivery.no_surat_jalan || "-"}
              <span className="text-gray-300"> · </span>
              {delivery.vendor?.nama || "-"}
              <span className="text-gray-300"> · </span>
              {delivery.kurir || "-"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Delivery Status</p>
            <div className="mt-2">
              <Badge className={STATUS_COLORS[delivery.status]}>
                {STATUS_LABELS[delivery.status]}
              </Badge>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Purchase Order</p>
            <p className="mt-1 truncate font-semibold text-gray-900">
              {delivery.purchase_order?.po_number || "-"}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Ship Date</p>
            <p className="mt-1 font-semibold text-gray-900">{formatDate(delivery.tanggal_kirim)}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Estimated Arrival</p>
            <p className="mt-1 font-semibold text-gray-900">
              {formatDate(delivery.tanggal_estimasi_tiba)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-gray-200/70 bg-gray-50/60 shadow-xs">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Delivery flow</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
                <span className="rounded-full border border-gray-200 bg-white px-3 py-1">
                  1. Delivery created
                </span>
                <ArrowRight className="h-4 w-4 text-gray-400" />
                <span className="rounded-full border border-gray-200 bg-white px-3 py-1">
                  2. Record goods receipt
                </span>
                <ArrowRight className="h-4 w-4 text-gray-400" />
                <span className="rounded-full border border-gray-200 bg-white px-3 py-1">
                  3. Stock updated
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isDelivered && (
                <Badge variant="outline" className="w-fit border-emerald-200 text-emerald-700">
                  Receipt recorded
                </Badge>
              )}
              {canReceive && (
                <Link href={`${RECEIVE_INSERT}?delivery_id=${delivery.id}`}>
                  <Button className="purchasing-main-button">Record Goods Receipt</Button>
                </Link>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Truck className="h-5 w-5" />
              Delivery Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/60 p-3">
                <p className="text-xs font-medium text-gray-500">Delivery Note Number</p>
                <p className="mt-1 font-semibold text-gray-900">{delivery.no_surat_jalan || "-"}</p>
              </div>
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/60 p-3">
                <p className="text-xs font-medium text-gray-500">Tracking Number</p>
                <p className="mt-1 font-semibold text-gray-900">{delivery.nomor_resi || "-"}</p>
              </div>
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/60 p-3">
                <p className="text-xs font-medium text-gray-500">Courier</p>
                <p className="mt-1 font-semibold text-gray-900">{delivery.kurir || "-"}</p>
              </div>
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/60 p-3">
                <p className="text-xs font-medium text-gray-500">Ship Date</p>
                <p className="mt-1 font-semibold text-gray-900">{formatDate(delivery.tanggal_kirim)}</p>
              </div>
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/60 p-3">
                <p className="text-xs font-medium text-gray-500">Estimated Arrival</p>
                <p className="mt-1 font-semibold text-gray-900">
                  {formatDate(delivery.tanggal_estimasi_tiba)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/60 p-3">
                <p className="text-xs font-medium text-gray-500">Actual Arrival</p>
                <p className="mt-1 font-semibold text-gray-900">
                  {formatDate(delivery.tanggal_aktual_tiba)}
                </p>
              </div>
            </div>
            {delivery.catatan && (
              <div className="border-t border-gray-200/70 pt-4">
                <p className="text-xs font-medium text-gray-500">Notes</p>
                <p className="mt-1 text-sm text-gray-700">{delivery.catatan}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-5 w-5" />
              Purchase Order Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="rounded-lg border border-gray-200/70 bg-gray-50/60 p-3">
              <p className="text-xs font-medium text-gray-500">Purchase Order Number</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">
                {delivery.purchase_order?.po_number || "-"}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200/70 bg-gray-50/60 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Building2 className="h-4 w-4 text-gray-400" />
                <p className="text-xs font-medium text-gray-500">Vendor</p>
              </div>
              <p className="font-semibold text-gray-900">{delivery.vendor?.nama || "-"}</p>
              <p className="text-sm text-gray-500">{delivery.vendor?.kode || ""}</p>
            </div>
            <div className="flex flex-col gap-2 border-t border-gray-200/70 pt-4">
              <Link href={PRODUCT_ROUTES.purchasingPoDetail(delivery.purchase_order_id)}>
                <Button variant="outline" className="purchasing-secondary-button w-full">
                  View Purchase Order
                </Button>
              </Link>
              {canReceive && (
                <Link href={`${RECEIVE_INSERT}?delivery_id=${delivery.id}`}>
                  <Button className="purchasing-main-button w-full">Record Goods Receipt</Button>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
