"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useReceivingWorkspace } from "../queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingTablePagination } from "@/modules/purchasing/components/pagination/PurchasingTablePagination";
import { RM_ROUTES, PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import {
  ClipboardDocumentCheckIcon,
  TruckIcon,
} from "@heroicons/react/24/outline";
import { Filter, Search, X, Eye, PackageCheck, ClipboardCheck, Truck } from "lucide-react";

type ReceivingStatus =
  | "waiting_delivery"
  | "in_delivery"
  | "partially_received"
  | "received"
  | "rejected"
  | "cancelled";

type POStatus = "draft" | "approved" | "sent" | "partially_received" | "received" | "cancelled" | string;

type PurchaseOrderRow = {
  id: string;
  nomor_po: string;
  nama_supplier?: string | null;
  supplier_id?: string | null;
  status: POStatus;
  tanggal_po?: string | null;
  total_qty_ordered?: number;
  total_qty_received?: number;
};

type DeliveryRow = {
  id: string;
  po_id?: string | null;
  po_number?: string | null;
  supplier_name?: string | null;
  delivery_number?: string | null;
  no_surat_jalan?: string | null;
  ekspedisi?: string | null;
  no_resi?: string | null;
  tanggal_kirim?: string | null;
  tanggal_estimasi_tiba?: string | null;
  status: "pending" | "shipped" | "in_transit" | "delivered" | "cancelled";
};

type GrnRow = {
  id: string;
  nomor_grn: string;
  delivery_id?: string | null;
  delivery_number?: string | null;
  po_id?: string | null;
  po_number?: string | null;
  supplier_name?: string | null;
  no_surat_jalan?: string | null;
  tanggal_penerimaan?: string | null;
  status: "pending" | "partially_received" | "received" | "rejected";
  total_item_diterima?: number;
  total_item_ditolak?: number;
  receive_count?: number;
};

type ReceivingRow = {
  key: string;
  status: ReceivingStatus;
  poId?: string | null;
  poNumber: string;
  poStatus?: string | null;
  supplierName: string;
  deliveryId?: string | null;
  deliveryNumber?: string | null;
  suratJalan?: string | null;
  grnId?: string | null;
  grnNumber?: string | null;
  date?: string | null;
  orderedQty?: number;
  receivedQty?: number;
  rejectedQty?: number;
  remainingQty?: number;
  deliveries: DeliveryRow[];
  grns: GrnRow[];
  pendingDelivery?: DeliveryRow | null;
  latestGrn?: GrnRow | null;
};

const STATUS_STYLES: Record<ReceivingStatus, string> = {
  waiting_delivery: "bg-slate-100 text-slate-700 border-slate-200",
  in_delivery: "bg-pink-50 text-pink-700 border-pink-200",
  partially_received: "bg-amber-50 text-amber-700 border-amber-200",
  received: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-gray-100 text-gray-600 border-gray-200",
};

const STATUS_LABELS: Record<ReceivingStatus, string> = {
  waiting_delivery: "Menunggu Pengiriman",
  in_delivery: "Dalam Pengiriman",
  partially_received: "Diterima Sebagian",
  received: "Diterima Penuh",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function normalizeStatus(value?: string | null) {
  return (value || "").toLowerCase();
}

function statusPriority(status: ReceivingStatus) {
  const order: Record<ReceivingStatus, number> = {
    in_delivery: 1,
    partially_received: 2,
    waiting_delivery: 3,
    rejected: 4,
    received: 5,
    cancelled: 6,
  };
  return order[status];
}

function formatQty(value?: number | null) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(Number(value || 0));
}

function deliveryLabel(delivery: DeliveryRow) {
  return delivery.no_resi || delivery.delivery_number || delivery.no_surat_jalan || "Pengiriman";
}

type ModuleType = "raw_material" | "product";

type ReceivingWorkspacePageProps = {
  moduleType?: ModuleType;
};

export function ReceivingWorkspacePage({
  moduleType = "raw_material",
}: ReceivingWorkspacePageProps) {
  const isProduct = moduleType === "product";
  const routes = isProduct ? PRODUCT_ROUTES : RM_ROUTES;
  const supplierColumnLabel = isProduct ? "Vendor" : "Supplier";
  const searchPlaceholder = isProduct
    ? "Cari PO, vendor, surat jalan, no. resi, atau GRN..."
    : "Cari PO, supplier, surat jalan, no. resi, atau GRN...";

  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReceivingStatus | "all">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 10;

  const workspaceQuery = useReceivingWorkspace(moduleType);
  const loading = workspaceQuery.isLoading;
  const purchaseOrders = (workspaceQuery.data?.purchase_orders ?? []) as PurchaseOrderRow[];
  const deliveries = (workspaceQuery.data?.deliveries ?? []) as DeliveryRow[];
  const grns = (workspaceQuery.data?.grns ?? []) as GrnRow[];

  const rows = useMemo<ReceivingRow[]>(() => {
    const deliveriesByPo = new Map<string, DeliveryRow[]>();
    const deliveryById = new Map<string, DeliveryRow>();
    const grnsByPo = new Map<string, GrnRow[]>();
    const grnsByDelivery = new Map<string, GrnRow[]>();
    const poById = new Map<string, PurchaseOrderRow>();

    for (const po of purchaseOrders) poById.set(po.id, po);
    for (const delivery of deliveries) {
      deliveryById.set(delivery.id, delivery);
      if (delivery.po_id) {
        const current = deliveriesByPo.get(delivery.po_id) || [];
        deliveriesByPo.set(delivery.po_id, [...current, delivery]);
      }
    }
    for (const grn of grns) {
      if (grn.po_id) {
        const current = grnsByPo.get(grn.po_id) || [];
        grnsByPo.set(grn.po_id, [...current, grn]);
      }
      if (grn.delivery_id) {
        const current = grnsByDelivery.get(grn.delivery_id) || [];
        grnsByDelivery.set(grn.delivery_id, [...current, grn]);
      }
    }

    const nextRows: ReceivingRow[] = [];
    const handledPoIds = new Set<string>();

    for (const po of purchaseOrders) {
      const poStatus = normalizeStatus(po.status);
      if (
        !["approved", "sent", "partially_received", "received", "cancelled", "closed"].includes(
          poStatus
        )
      ) {
        continue;
      }

      const poDeliveries = (deliveriesByPo.get(po.id) || []).sort((a, b) =>
        String(b.tanggal_kirim || "").localeCompare(String(a.tanggal_kirim || ""))
      );
      if (poDeliveries.length === 0) continue;

      const poGrns = (grnsByPo.get(po.id) || []).sort((a, b) =>
        String(b.tanggal_penerimaan || "").localeCompare(String(a.tanggal_penerimaan || ""))
      );
      const pendingDelivery = poDeliveries.find((delivery) => {
        if (delivery.status === "cancelled") return false;
        return !(grnsByDelivery.get(delivery.id) || []).length;
      }) || null;
      const latestDelivery = poDeliveries.find((delivery) => delivery.status !== "cancelled") || null;
      const latestGrn = poGrns[0] || null;
      handledPoIds.add(po.id);

      const orderedQty = Number(po.total_qty_ordered || 0);
      const receivedQty = Number(po.total_qty_received || 0);
      const rejectedQty = poGrns.reduce((sum, grn) => sum + Number(grn.total_item_ditolak || 0), 0);
      const remainingQty = Math.max(0, orderedQty - receivedQty);

      let status: ReceivingStatus = "waiting_delivery";
      if (poStatus === "cancelled") status = "cancelled";
      else if (poStatus === "closed") status = remainingQty > 0 ? "partially_received" : "received";
      else if (poStatus === "received" || remainingQty <= 0) status = "received";
      else if (pendingDelivery || (latestDelivery && poGrns.length === 0)) status = "in_delivery";
      else if (poStatus === "partially_received" || poGrns.length > 0) status = "partially_received";

      nextRows.push({
        key: `po-${po.id}`,
        status,
        poId: po.id,
        poNumber: po.nomor_po,
        poStatus,
        supplierName: po.nama_supplier || "-",
        deliveryId: pendingDelivery?.id || latestDelivery?.id || null,
        deliveryNumber: latestDelivery ? deliveryLabel(latestDelivery) : null,
        suratJalan: latestDelivery?.no_surat_jalan || latestGrn?.no_surat_jalan || null,
        grnId: latestGrn?.id || null,
        grnNumber: latestGrn?.nomor_grn || null,
        date: latestGrn?.tanggal_penerimaan || latestDelivery?.tanggal_kirim || po.tanggal_po || null,
        orderedQty,
        receivedQty,
        rejectedQty,
        remainingQty,
        deliveries: poDeliveries,
        grns: poGrns,
        pendingDelivery,
        latestGrn,
      });
    }

    for (const delivery of deliveries) {
      if (delivery.po_id && handledPoIds.has(delivery.po_id)) continue;
      const grnList = grnsByDelivery.get(delivery.id) || [];
      const grn = grnList[0] || null;
      let status: ReceivingStatus = delivery.status === "cancelled" ? "cancelled" : "in_delivery";
      if (grn?.status === "received") status = "received";
      if (grn?.status === "partially_received") status = "partially_received";
      if (grn?.status === "rejected") status = "rejected";

      nextRows.push({
        key: `delivery-${delivery.id}`,
        status,
        poId: delivery.po_id || null,
        poNumber: delivery.po_number || "-",
        supplierName: "-",
        deliveryId: delivery.id,
        deliveryNumber: delivery.no_resi || delivery.po_number || null,
        suratJalan: delivery.no_surat_jalan || null,
        grnId: grn?.id || null,
        grnNumber: grn?.nomor_grn || null,
        date: grn?.tanggal_penerimaan || delivery.tanggal_kirim || null,
        receivedQty: Number(grn?.total_item_diterima || 0),
        rejectedQty: Number(grn?.total_item_ditolak || 0),
        remainingQty: undefined,
        deliveries: [delivery],
        grns: grn ? [grn] : [],
        pendingDelivery: grn ? null : delivery,
        latestGrn: grn || null,
      });
    }

    return nextRows
      .filter((row) => row.deliveries.length > 0)
      .sort((a, b) => statusPriority(a.status) - statusPriority(b.status));
  }, [deliveries, grns, purchaseOrders]);

  const filteredRows = rows.filter((row) => {
    const matchesStatus = statusFilter === "all" || row.status === statusFilter;
    const haystack = [
      row.poNumber,
      row.supplierName,
      row.deliveryNumber,
      row.suratJalan,
      row.grnNumber,
      ...row.grns.map((grn) => grn.nomor_grn),
    ]
      .join(" ")
      .toLowerCase();
    return matchesStatus && haystack.includes(search.toLowerCase());
  });

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / limit));
  const paginatedRows = filteredRows.slice((page - 1) * limit, page * limit);

  const counts = rows.reduce(
    (acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    },
    {} as Record<ReceivingStatus, number>
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  function handleResetFilters() {
    setSearch("");
    setSearchQuery("");
    setStatusFilter("all");
    setPage(1);
  }

  const isFilterActive = statusFilter !== "all";

  function isFullyReceived(row: ReceivingRow) {
    return row.status === "received" || Number(row.remainingQty || 0) <= 0;
  }

  /** Sisa PO but no open shipment — need Kirim Ulang, not continue same GRN. */
  function canReshipForRemaining(row: ReceivingRow) {
    return (
      !isFullyReceived(row) &&
      Number(row.remainingQty || 0) > 0 &&
      !row.pendingDelivery?.id &&
      !!row.poId &&
      (row.status === "partially_received" || row.latestGrn?.status === "partially_received")
    );
  }

  function canRunQualityControl(row: ReceivingRow) {
    return !!row.grnId && row.latestGrn?.status === "pending";
  }

  function renderActions(row: ReceivingRow) {
    const iconButton = (href: string, title: string, icon: ReactNode, key: string) => (
      <Link key={key} href={href}>
        <Button variant="ghost" size="sm" className="cursor-pointer" title={title}>
          {icon}
        </Button>
      </Link>
    );

    const actions: ReactNode[] = [];
    const fullyReceived = isFullyReceived(row);

    // Only receive against a delivery that has no GRN yet (new shipment arrived).
    if (!fullyReceived && row.pendingDelivery?.id) {
      actions.push(
        iconButton(
          `${isProduct ? PRODUCT_ROUTES.purchasingReceiveInsert : RM_ROUTES.purchasingGrnInsert}?delivery_id=${row.pendingDelivery.id}`,
          "Buat GRN",
          <PackageCheck className="h-4 w-4 text-primary" />,
          "receive"
        )
      );
    }

    if (canReshipForRemaining(row)) {
      actions.push(
        <Link
          key="reship"
          href={`${isProduct ? PRODUCT_ROUTES.purchasingDeliveryInsert : RM_ROUTES.purchasingDelivery}/insert?po_id=${row.poId}`}
        >
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-lg border-primary/20 px-2.5 text-xs font-medium text-primary shadow-sm hover:!border-primary/30 hover:!bg-primary/5 hover:!text-primary"
            title="Buat pengiriman baru untuk sisa qty"
          >
            <Truck className="h-3.5 w-3.5" />
            Kirim Ulang
          </Button>
        </Link>
      );
    }

    if (row.grnId) {
      actions.push(
        iconButton(
          isProduct
            ? PRODUCT_ROUTES.purchasingReceiveDetail(row.grnId)
            : RM_ROUTES.purchasingGrnDetail(row.grnId),
          "Lihat detail",
          <Eye className="h-4 w-4 text-pink-600" />,
          "detail"
        )
      );
    }

    if (canRunQualityControl(row)) {
      actions.push(
        iconButton(
          isProduct
            ? PRODUCT_ROUTES.purchasingReceiveQc(row.grnId!)
            : RM_ROUTES.purchasingGrnQc(row.grnId!),
          "Inspeksi QC",
          <ClipboardCheck className="h-4 w-4 text-emerald-600" />,
          "qc"
        )
      );
    } else if (actions.length === 0 && row.deliveryId) {
      actions.push(
        iconButton(
          isProduct
            ? PRODUCT_ROUTES.purchasingDeliveryDetail(row.deliveryId)
            : `/dashboard/purchasing/delivery/${row.deliveryId}`,
          "Lihat pengiriman",
          <Eye className="h-4 w-4 text-pink-600" />,
          "delivery-detail"
        )
      );
    } else if (actions.length === 0 && row.poId) {
      actions.push(
        iconButton(
          isProduct ? routes.purchasingPoDetail(row.poId) : `/dashboard/purchasing/po/${row.poId}`,
          "Lihat purchase order",
          <Eye className="h-4 w-4 text-pink-600" />,
          "po-detail"
        )
      );
    }

    return actions;
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">GRN</h1>
        <p className="text-sm text-gray-500">
          Pantau pengiriman, penerimaan, qty diterima/ditolak, dan sisa kiriman — {filteredRows.length} total
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {(["in_delivery", "partially_received", "received", "rejected"] as ReceivingStatus[]).map((status) => (
          <Card key={status} className="border-gray-200/70 shadow-xs">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-gray-500">{STATUS_LABELS[status]}</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{counts[status] || 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <PurchasingListSection
        icon={ClipboardDocumentCheckIcon}
        title="Daftar GRN"
        description="Setiap baris adalah purchase order yang sudah punya pengiriman. Buat GRN (terima + QC), lanjutkan penerimaan sebagian, atau tinjau yang sudah selesai. GRN lama yang menunggu QC masih menampilkan aksi QC."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
          <label className="relative w-full md:w-96">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-10 bg-white pl-10 pr-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label="Hapus pencarian"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
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
          {(search || isFilterActive) && (
            <Button variant="outline" onClick={handleResetFilters} className="h-10 flex-shrink-0 rounded-lg">
              Atur Ulang
            </Button>
          )}
          </div>
        }
      >
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
                    options={[
                      { value: "all", label: "Semua Status" },
                      { value: "in_delivery", label: "Dalam Pengiriman" },
                      { value: "partially_received", label: "Diterima Sebagian" },
                      { value: "received", label: "Diterima Penuh" },
                      { value: "rejected", label: "Ditolak" },
                      { value: "cancelled", label: "Dibatalkan" },
                    ]}
                    value={statusFilter}
                    onChange={(value) => {
                      setStatusFilter(value as ReceivingStatus | "all");
                      setPage(1);
                    }}
                    placeholder="Filter status..."
                    searchPlaceholder="Cari status..."
                    emptyMessage="Status tidak ditemukan"
                    className="!w-full h-9 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center">
              <p className="text-sm text-gray-500">Memuat data penerimaan...</p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="py-14 text-center">
              <TruckIcon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">Tidak ada data yang cocok dengan filter saat ini</p>
            </div>
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    {[
                      "Purchase Order",
                      supplierColumnLabel,
                      "No. GRN",
                      "Pengiriman",
                      "Progress Item",
                      "Status",
                      "Terakhir Diubah",
                      "Aksi",
                    ].map((heading) => (
                      <th
                        key={heading}
                        className={`px-4 py-3 font-semibold ${
                          heading === "Aksi" ? "text-right" : "text-left"
                        }`}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginatedRows.map((row) => (
                    <tr key={row.key} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        {row.poId ? (
                          <Link
                            href={
                              isProduct
                                ? routes.purchasingPoDetail(row.poId)
                                : `/dashboard/purchasing/po/${row.poId}`
                            }
                            className="font-medium text-pink-700 hover:underline"
                          >
                            {row.poNumber}
                          </Link>
                        ) : (
                          <span className="font-medium">{row.poNumber}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">{row.supplierName}</td>
                      <td className="px-4 py-3 text-sm">
                        {row.grns.length === 0 ? (
                          <span className="text-gray-400">-</span>
                        ) : (
                          <div className="space-y-1">
                            {row.grns.slice(0, 3).map((grn) => (
                              <Link
                                key={grn.id}
                                href={
                                  isProduct
                                    ? PRODUCT_ROUTES.purchasingReceiveDetail(grn.id)
                                    : RM_ROUTES.purchasingGrnDetail(grn.id)
                                }
                                className="block font-medium text-pink-700 hover:underline"
                              >
                                {grn.nomor_grn}
                              </Link>
                            ))}
                            {row.grns.length > 3 && (
                              <div className="text-xs text-gray-500">+{row.grns.length - 3} lainnya</div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="space-y-1.5">
                          {row.deliveries.length === 0 ? (
                            <span className="text-gray-400">Belum ada pengiriman</span>
                          ) : (
                            row.deliveries.slice(0, 3).map((delivery) => (
                              <div key={delivery.id} className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Link
                                    href={
                                      isProduct
                                        ? PRODUCT_ROUTES.purchasingDeliveryDetail(delivery.id)
                                        : `/dashboard/raw-material/purchasing/delivery/${delivery.id}`
                                    }
                                    className="font-medium text-gray-900 hover:text-pink-700 hover:underline"
                                  >
                                    {deliveryLabel(delivery)}
                                  </Link>
                                  <span className="text-xs text-gray-400">Surat Jalan: {delivery.no_surat_jalan || "-"}</span>
                                </div>
                                {!row.grns.some((grn) => grn.delivery_id === delivery.id) && (
                                  <div className="mt-1 text-xs text-amber-600">GRN belum dicatat</div>
                                )}
                              </div>
                            ))
                          )}
                          {row.deliveries.length > 3 && (
                            <div className="text-xs text-gray-500">+{row.deliveries.length - 3} pengiriman lainnya</div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="font-medium">
                          Diterima {formatQty(row.receivedQty)} / {formatQty(row.orderedQty)}
                        </div>
                        {Number(row.remainingQty || 0) > 0 && (
                          <div className="text-xs text-gray-500">Sisa {formatQty(row.remainingQty)}</div>
                        )}
                        {/*
                          Tolak historis GRN jangan ditampilkan kalau sisa sudah terpenuhi (kirim ulang).
                          Tampilkan hanya jika sisa masih ada DAN PO ditutup (kekurangan dikunci).
                        */}
                        {normalizeStatus(row.poStatus) === "closed" &&
                          Number(row.remainingQty || 0) > 0 && (
                            <div className="text-xs text-red-600">
                              {formatQty(row.remainingQty)} tidak dipenuhi (PO ditutup)
                            </div>
                          )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={STATUS_STYLES[row.status]}>
                          {STATUS_LABELS[row.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm">{formatDate(row.date)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {renderActions(row)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PurchasingTablePagination
              page={page}
              totalPages={totalPages}
              totalItems={filteredRows.length}
              pageSize={limit}
              onPageChange={setPage}
            />
            </>
          )}
        </div>
      </PurchasingListSection>
    </div>
  );
}
