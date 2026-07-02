"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  ArrowPathIcon,
  ClipboardDocumentListIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingTablePagination } from "@/modules/purchasing/components/pagination/PurchasingTablePagination";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { useProductStockOpnameList } from "../queries";
import {
  PRODUCT_STOCK_OPNAME_STATUS_COLORS,
  PRODUCT_STOCK_OPNAME_STATUS_LABELS,
  type ProductStockOpnameStatus,
} from "../types";

const STATUS_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "draft", label: "Draft" },
  { value: "in_progress", label: "Sedang Dihitung" },
  { value: "completed", label: "Selesai" },
  { value: "cancelled", label: "Dibatalkan" },
];

function formatQty(value: number) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(value);
}

export function ProductStockOpnameListPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProductStockOpnameStatus | "all">("all");
  const limit = 20;

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
  });

  const items = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = listQuery.data?.pagination.total_pages ?? 1;
  const loading = listQuery.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Opname Produk</h1>
          <p className="text-sm text-gray-500">
            Hitung fisik stok produk jadi dan sesuaikan selisih — {total} sesi
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Link href={PRODUCT_ROUTES.inventoryOpnameInsert}>
            <Button className="h-10 w-full gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-pink-700 sm:w-auto">
              <PlusIcon className="h-4 w-4" />
              Buat Opname
            </Button>
          </Link>
          <Link href={PRODUCT_ROUTES.inventoryStock}>
            <Button variant="outline" className="h-10 w-full border-gray-200/80 sm:w-auto">
              Lihat Stok
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Total Sesi</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{total}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Sedang Dihitung</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">
              {items.filter((item) => item.status === "in_progress").length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Selesai</p>
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
        title="Daftar Stock Opname Produk"
        description="Sesi penghitungan fisik stok produk jadi"
        toolbar={
          <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nomor opname..."
                className="h-10 border-gray-200/80 pl-9"
              />
            </div>
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
          </div>
        }
      >
        <div className="overflow-x-auto px-4">
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-3 py-3">Nomor</th>
                <th className="px-3 py-3">Tanggal</th>
                <th className="px-3 py-3 text-right">Baris</th>
                <th className="px-3 py-3 text-right">Dihitung</th>
                <th className="px-3 py-3 text-right">Selisih</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-gray-400">
                    Memuat data...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-gray-400">
                    <ClipboardDocumentListIcon className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                    Belum ada sesi stock opname produk
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-gray-200/70 transition-colors hover:bg-gray-50/80"
                  >
                    <td className="px-3 py-3 font-semibold text-gray-950">
                      {item.opname_number}
                    </td>
                    <td className="px-3 py-3 text-gray-600">
                      {format(new Date(item.opname_date), "d MMM yyyy", { locale: localeId })}
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700">
                      {formatQty(item.total_lines)}
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700">
                      {formatQty(item.lines_counted)}
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700">
                      {formatQty(item.lines_with_variance)}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant="outline"
                        className={PRODUCT_STOCK_OPNAME_STATUS_COLORS[item.status]}
                      >
                        {PRODUCT_STOCK_OPNAME_STATUS_LABELS[item.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {item.status === "draft" || item.status === "in_progress" ? (
                        <Link href={PRODUCT_ROUTES.inventoryOpnameContinue(item.id)}>
                          <Button variant="ghost" size="sm" className="h-8 gap-1 text-pink-700">
                            <PencilSquareIcon className="h-4 w-4" />
                            Lanjutkan
                          </Button>
                        </Link>
                      ) : (
                        <Link href={PRODUCT_ROUTES.inventoryOpnameDetail(item.id)}>
                          <Button variant="ghost" size="sm" className="h-8 gap-1 text-pink-700">
                            <EyeIcon className="h-4 w-4" />
                            Lihat
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
