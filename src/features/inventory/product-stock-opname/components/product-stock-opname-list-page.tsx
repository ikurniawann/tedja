"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowPathIcon,
  ClipboardDocumentListIcon,
  EyeIcon,
  PencilSquareIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingTablePagination } from "@/modules/purchasing/components/pagination/PurchasingTablePagination";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { STALL_LABELS } from "@/lib/configuration/stall-labels";
import { useProductStockOpnameList, useProductStockOpnameWarehouses } from "../queries";
import {
  PRODUCT_STOCK_OPNAME_STATUS_COLORS,
  PRODUCT_STOCK_OPNAME_STATUS_LABELS,
  type ProductStockOpnameStatus,
} from "../types";

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "in_progress", label: "Counting in Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function formatQty(value: number) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatOpnameDate(dateStr?: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function ProductStockOpnameListPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProductStockOpnameStatus | "all">("all");
  const [stallFilter, setStallFilter] = useState("");
  const limit = 10;

  const warehousesQuery = useProductStockOpnameWarehouses();
  const stallOptions = [
    { value: "", label: `All ${STALL_LABELS.plural}` },
    ...(warehousesQuery.data ?? []).map((w) => ({
      value: w.id,
      label: w.name,
      description: w.code,
    })),
  ];

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const listQuery = useProductStockOpnameList({
    page,
    limit,
    status: statusFilter,
    search: search || undefined,
    reason: "stock_opname",
    warehouse_id: stallFilter || undefined,
  });

  const items = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = listQuery.data?.pagination.total_pages ?? 1;
  const loading = listQuery.isLoading;

  const hasActiveFilters =
    Boolean(search) || statusFilter !== "all" || Boolean(stallFilter) || page > 1;

  const handleResetFilters = () => {
    setSearchQuery("");
    setSearch("");
    setStatusFilter("all");
    setStallFilter("");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Product Stock Opname"
        description={`Count physical finished product stock and reconcile variances — ${total} sessions`}
        actions={
          <>
            <Link href={PRODUCT_ROUTES.inventoryOpnameInsert}>
              <Button className="purchasing-main-button w-full sm:w-auto">
                <PlusIcon className="mr-2 h-4 w-4" />
                Create Stock Opname
              </Button>
            </Link>
            <Link href={PRODUCT_ROUTES.inventoryStock}>
              <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
                View Stock
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Total Sessions</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{total}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Counting in Progress</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">
              {items.filter((item) => item.status === "in_progress").length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Completed</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">
              {items.filter((item) => item.status === "completed").length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Draft</p>
            <p className="mt-1 text-2xl font-bold text-gray-700">
              {items.filter((item) => item.status === "draft").length}
            </p>
          </CardContent>
        </Card>
      </div>

      <PurchasingListSection
        icon={ClipboardDocumentListIcon}
        title="Product Stock Opname List"
        description="Physical stock counting sessions for finished products"
        toolbar={
          <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative flex-1 lg:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search opname number..."
                className="h-10 border-gray-200/80 pl-9 pr-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>
            <Combobox
              options={stallOptions}
              value={stallFilter}
              onChange={(value) => {
                setStallFilter(value);
                setPage(1);
              }}
              placeholder={
                warehousesQuery.isLoading ? STALL_LABELS.loading : `All ${STALL_LABELS.plural}`
              }
              searchPlaceholder={STALL_LABELS.search}
              emptyMessage={STALL_LABELS.empty}
              disabled={warehousesQuery.isLoading}
              allowClear
              className="h-10 w-full lg:w-48"
            />
            <Combobox
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value as ProductStockOpnameStatus | "all");
                setPage(1);
              }}
              options={STATUS_OPTIONS}
              placeholder="Status"
              className="h-10 w-full lg:w-48"
            />
            <Button
              variant="outline"
              className="h-10 border-gray-200/80"
              onClick={() => listQuery.refetch()}
              disabled={loading}
            >
              <ArrowPathIcon className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {hasActiveFilters && (
              <Button variant="outline" onClick={handleResetFilters} className="h-10 shrink-0">
                Reset
              </Button>
            )}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Number</th>
                <th className="px-4 py-3 text-left font-semibold">Stall</th>
                <th className="px-4 py-3 text-left font-semibold">Date</th>
                <th className="px-4 py-3 text-right font-semibold">Lines</th>
                <th className="px-4 py-3 text-right font-semibold">Counted</th>
                <th className="px-4 py-3 text-right font-semibold">Variance</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                    Loading stock opname sessions...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                    <ClipboardDocumentListIcon className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                    No product stock opname sessions yet
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={
                          item.status === "draft" || item.status === "in_progress"
                            ? PRODUCT_ROUTES.inventoryOpnameContinue(item.id)
                            : PRODUCT_ROUTES.inventoryOpnameDetail(item.id)
                        }
                        className="font-medium text-pink-700 hover:underline"
                      >
                        {item.opname_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {item.warehouse?.name || item.warehouse?.code || "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatOpnameDate(item.opname_date)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {formatQty(item.total_lines)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {formatQty(item.lines_counted)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {formatQty(item.lines_with_variance)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={PRODUCT_STOCK_OPNAME_STATUS_COLORS[item.status]}
                      >
                        {PRODUCT_STOCK_OPNAME_STATUS_LABELS[item.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.status === "draft" || item.status === "in_progress" ? (
                        <Link href={PRODUCT_ROUTES.inventoryOpnameContinue(item.id)}>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Continue counting"
                            className="h-8 cursor-pointer gap-1 text-pink-700"
                          >
                            <PencilSquareIcon className="h-4 w-4" />
                          </Button>
                        </Link>
                      ) : (
                        <Link href={PRODUCT_ROUTES.inventoryOpnameDetail(item.id)}>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="View detail"
                            className="h-8 cursor-pointer gap-1 text-pink-700"
                          >
                            <EyeIcon className="h-4 w-4" />
                          </Button>
                        </Link>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <PurchasingTablePagination
          page={page}
          totalPages={totalPages}
          totalItems={total}
          pageSize={limit}
          onPageChange={setPage}
        />
      </PurchasingListSection>
    </div>
  );
}
