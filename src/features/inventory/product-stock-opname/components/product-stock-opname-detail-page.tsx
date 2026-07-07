"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircleIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PurchasingFormHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { useProductStockOpname } from "../queries";
import {
  PRODUCT_STOCK_OPNAME_STATUS_COLORS,
  PRODUCT_STOCK_OPNAME_STATUS_LABELS,
} from "../types";

function formatQty(value: number | null | undefined) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(dateStr?: string | null) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ProductStockOpnameDetailPageProps {
  id: string;
}

export function ProductStockOpnameDetailPage({ id }: ProductStockOpnameDetailPageProps) {
  const detailQuery = useProductStockOpname(id);
  const [search, setSearch] = useState("");

  const detail = detailQuery.data;

  const filteredLines = useMemo(() => {
    const lines = detail?.lines ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (line) =>
        line.product_nama?.toLowerCase().includes(q) ||
        line.product_kode?.toLowerCase().includes(q)
    );
  }, [detail?.lines, search]);

  const progress = useMemo(() => {
    const lines = detail?.lines ?? [];
    const counted = lines.filter(
      (line) => line.qty_counted !== null && line.qty_counted !== undefined
    ).length;
    const variance = lines.filter(
      (line) =>
        line.qty_variance !== null &&
        line.qty_variance !== undefined &&
        line.qty_variance !== 0
    ).length;
    return { counted, variance, total: lines.length };
  }, [detail?.lines]);

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
        Loading product stock opname history...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-gray-500">Product stock opname not found</p>
        <Link href={PRODUCT_ROUTES.inventoryOpname}>
          <Button variant="outline" className="purchasing-secondary-button">
            Back
          </Button>
        </Link>
      </div>
    );
  }

  const canContinue = detail.status === "draft" || detail.status === "in_progress";

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.inventoryOpname}
        title={detail.opname_number}
        description={
          <>
            Product stock opname history · {formatDate(detail.opname_date)}
            {detail.warehouse?.name ? (
              <>
                {" "}
                · Stall: {detail.warehouse.name}
              </>
            ) : null}
          </>
        }
        actions={
          canContinue ? (
            <Link href={PRODUCT_ROUTES.inventoryOpnameContinue(detail.id)}>
              <Button className="purchasing-main-button w-full sm:w-auto">
                Continue Counting
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={PRODUCT_STOCK_OPNAME_STATUS_COLORS[detail.status]}>
          {PRODUCT_STOCK_OPNAME_STATUS_LABELS[detail.status]}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Total Lines</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{progress.total}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Counted</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{progress.counted}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">With Variance</p>
            <p className="mt-1 text-2xl font-bold text-pink-600">{progress.variance}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Status</p>
            <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-gray-800">
              {detail.status === "completed" && (
                <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
              )}
              {PRODUCT_STOCK_OPNAME_STATUS_LABELS[detail.status]}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-gray-200/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Product Lines</h2>
              <p className="text-sm text-gray-500">
                Physical stock count results (read only)
              </p>
            </div>
            <div className="relative w-full sm:max-w-xs">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products..."
                className="h-10 border-gray-200/80 pl-9 text-sm"
              />
            </div>
          </div>

          <div className="overflow-x-auto px-4 pb-4">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Code</th>
                  <th className="px-4 py-3 text-left font-semibold">Product Name</th>
                  <th className="px-4 py-3 text-left font-semibold">Unit</th>
                  <th className="px-4 py-3 text-right font-semibold">System Stock</th>
                  <th className="px-4 py-3 text-right font-semibold">Physical Quantity</th>
                  <th className="px-4 py-3 text-right font-semibold">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredLines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                      No lines found
                    </td>
                  </tr>
                ) : (
                  filteredLines.map((line) => (
                    <tr key={line.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">
                        {line.product_kode}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {line.product_nama}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{line.satuan || "—"}</td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {formatQty(line.qty_system)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {line.qty_counted === null || line.qty_counted === undefined
                          ? "—"
                          : formatQty(line.qty_counted)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {line.qty_variance === null || line.qty_variance === undefined ? (
                          <span className="text-gray-400">—</span>
                        ) : line.qty_variance === 0 ? (
                          <span className="text-emerald-600">0</span>
                        ) : line.qty_variance > 0 ? (
                          <span className="font-medium text-emerald-600">
                            +{formatQty(line.qty_variance)}
                          </span>
                        ) : (
                          <span className="font-medium text-red-600">
                            {formatQty(line.qty_variance)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {detail.notes && (
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Notes</p>
            <p className="mt-1 text-sm text-gray-700">{detail.notes}</p>
          </CardContent>
        </Card>
      )}

      {detail.status === "completed" && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircleIcon className="h-5 w-5 shrink-0" />
          Stock opname completed
          {detail.completed_at ? ` on ${formatDateTime(detail.completed_at)}` : ""}. Stock
          variances have been posted to inventory.
        </div>
      )}

      {detail.status === "cancelled" && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-800">
          <XMarkIcon className="h-5 w-5 shrink-0" />
          This stock opname session has been cancelled.
        </div>
      )}

      {canContinue && (
        <div className="rounded-lg border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This session is still in draft status. Use the{" "}
          <span className="font-medium">Continue Counting</span> button to resume counting on
          the opname page.
        </div>
      )}
    </div>
  );
}
