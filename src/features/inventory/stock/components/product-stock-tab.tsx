"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { formatAmount, formatDate } from "@/lib/purchasing/utils";
import { STALL_LABELS } from "@/lib/configuration/stall-labels";
import {
  CheckCircle2,
  Package,
  Search,
  ShoppingBag,
  X,
  XCircle,
} from "lucide-react";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingTablePagination } from "@/modules/purchasing/components/pagination/PurchasingTablePagination";
import { useProductStock } from "../queries";
import { listStockWarehouses } from "../api";

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "in_stock", label: "In Stock" },
  { value: "out_of_stock", label: "Out of Stock" },
];

function formatQty(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function ProductStockTab() {
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stallFilter, setStallFilter] = useState("all");
  const [warehouses, setWarehouses] = useState<
    { id: string; name: string; code: string }[]
  >([]);
  const [loadingWarehouses, setLoadingWarehouses] = useState(true);
  const [page, setPage] = useState(1);
  const limit = 10;

  useEffect(() => {
    setLoadingWarehouses(true);
    listStockWarehouses()
      .then(setWarehouses)
      .catch((e) => console.error("Error loading stalls:", e))
      .finally(() => setLoadingWarehouses(false));
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const listQuery = useProductStock({
    page,
    limit,
    status: statusFilter,
    search: search || undefined,
    warehouse_id: stallFilter !== "all" ? stallFilter : undefined,
  });

  const stallOptions = useMemo(
    () => [
      { value: "all", label: STALL_LABELS.allBranchTotal },
      ...warehouses.map((w) => ({
        value: w.id,
        label: w.name,
        description: w.code,
      })),
    ],
    [warehouses]
  );

  const items = listQuery.data?.items ?? [];
  const loading = listQuery.isLoading;
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const summary = useMemo(() => {
    const out = items.filter((i) => (Number(i.qty_available) || 0) <= 0).length;
    const totalValue = items.reduce((s, i) => s + (Number(i.total_value) || 0), 0);
    return { out, totalValue };
  }, [items]);

  const handleResetFilters = () => {
    setSearchQuery("");
    setSearch("");
    setStatusFilter("all");
    setStallFilter("all");
    setPage(1);
  };

  const hasActiveFilters =
    Boolean(search) || statusFilter !== "all" || stallFilter !== "all" || page > 1;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Total Products</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{total}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Out of Stock (This Page)</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{summary.out}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Stock Value (This Page)</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {formatAmount(summary.totalValue)}
            </p>
          </CardContent>
        </Card>
      </div>

      <PurchasingListSection
        icon={Package}
        title="Product Stock List"
        description="Review product code, stall, category, on-hand quantity, unit cost, selling price, stock value, and availability."
        toolbar={
          <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center">
            <Combobox
              options={stallOptions}
              value={stallFilter}
              onChange={(value) => {
                setStallFilter(value || "all");
                setPage(1);
              }}
              placeholder={loadingWarehouses ? STALL_LABELS.loading : STALL_LABELS.allBranchTotal}
              searchPlaceholder={STALL_LABELS.search}
              emptyMessage={STALL_LABELS.empty}
              disabled={loadingWarehouses}
              className="h-10 w-full lg:w-48"
            />
            <label className="relative w-full lg:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search product code or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
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
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v || "all");
                setPage(1);
              }}
              placeholder="All Statuses"
              className="h-10 w-full lg:w-44"
            />
            {hasActiveFilters && (
              <Button
                variant="outline"
                onClick={handleResetFilters}
                className="h-10 shrink-0 rounded-lg"
              >
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
                <th className="px-4 py-3 text-left font-semibold">Code</th>
                <th className="px-4 py-3 text-left font-semibold">Product Name</th>
                <th className="px-4 py-3 text-left font-semibold">Stall</th>
                <th className="px-4 py-3 text-left font-semibold">Category</th>
                <th className="px-4 py-3 text-right font-semibold">On Hand</th>
                <th className="px-4 py-3 text-left font-semibold">Unit</th>
                <th className="px-4 py-3 text-right font-semibold">COGS / Unit</th>
                <th className="px-4 py-3 text-right font-semibold">Selling Price</th>
                <th className="px-4 py-3 text-right font-semibold">Stock Value</th>
                <th className="px-4 py-3 text-center font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Last Update</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-gray-400">
                    Loading product stock...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-16 text-center text-gray-400">
                    <ShoppingBag className="mx-auto mb-3 h-12 w-12 opacity-30" />
                    <p>No product stock data found</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Stock appears automatically after production or finished goods completion
                    </p>
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const qty = Number(item.qty_available) || 0;
                  const isOut = qty <= 0;
                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">
                        {item.product_kode}
                      </td>
                      <td className="px-4 py-3">
                        {item.product_id ? (
                          <Link
                            href={PRODUCT_ROUTES.productsDetail(item.product_id)}
                            className="font-medium text-pink-700 hover:underline"
                          >
                            {item.product_nama}
                          </Link>
                        ) : (
                          <span className="font-medium text-gray-900">{item.product_nama}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {item.warehouse_name || item.warehouse_code || "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {item.product_kategori || "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-pink-700">
                        {formatQty(qty)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{item.satuan_nama || "—"}</td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {formatAmount(Number(item.unit_cost) || 0)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {formatAmount(Number(item.harga_jual) || 0)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-800">
                        {formatAmount(Number(item.total_value) || 0)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isOut ? (
                          <Badge
                            variant="outline"
                            className="border-red-200 bg-red-50 text-red-700"
                          >
                            <XCircle className="mr-1 inline h-3 w-3" />
                            Out of Stock
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-emerald-200 bg-emerald-50 text-emerald-700"
                          >
                            <CheckCircle2 className="mr-1 inline h-3 w-3" />
                            In Stock
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {item.last_movement_at ? formatDate(item.last_movement_at) : "—"}
                      </td>
                    </tr>
                  );
                })
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
