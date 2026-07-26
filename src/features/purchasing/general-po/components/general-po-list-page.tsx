"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingTablePagination } from "@/modules/purchasing/components/pagination/PurchasingTablePagination";
import { GENERAL_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { FileText, Plus, Search, Filter, Eye, X } from "lucide-react";
import { toast } from "sonner";
import { formatRp, formatDate } from "@/lib/purchasing/utils";
import { useGeneralPurchaseOrderList } from "../queries";

const STATUS_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Disetujui" },
  { value: "sent", label: "Dikirim" },
  { value: "partially_received", label: "Diterima Sebagian" },
  { value: "received", label: "Diterima" },
  { value: "cancelled", label: "Dibatalkan" },
];

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  approved: "Disetujui",
  sent: "Dikirim",
  partially_received: "Diterima Sebagian",
  partial: "Diterima Sebagian",
  received: "Diterima",
  cancelled: "Dibatalkan",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  approved: "bg-emerald-100 text-emerald-800",
  sent: "bg-blue-100 text-blue-800",
  partially_received: "bg-amber-100 text-amber-800",
  partial: "bg-amber-100 text-amber-800",
  received: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

export function GeneralPOListPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const limit = 10;

  const listQuery = useGeneralPurchaseOrderList({
    page,
    limit,
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const pos = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = listQuery.data?.pagination.total_pages ?? 1;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    if (listQuery.isError) toast.error("Gagal memuat purchase order");
  }, [listQuery.isError]);

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Purchase Order"
        description={`Kelola purchase order barang operasional — ${total} total`}
        actions={
          <Link href={GENERAL_ROUTES.purchasingPoInsert}>
            <Button className="purchasing-main-button w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Buat Purchase Order
            </Button>
          </Link>
        }
      />

      <PurchasingListSection
        icon={FileText}
        title="Daftar Purchase Order"
        description="Lacak purchase order barang operasional berdasarkan nomor, vendor, status, dan nilai total."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Cari nomor PO atau vendor..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-white pl-10 pr-10 text-sm"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="h-4 w-4 text-gray-400" />
                </button>
              )}
            </label>
            <Button variant="outline" onClick={() => setFilterOpen((v) => !v)} className="h-10">
              <Filter className="mr-2 h-4 w-4" />
              Filter
            </Button>
          </div>
        }
      >
        {filterOpen && (
          <div className="border-b border-gray-100 bg-gray-50/70 px-5 py-4">
            <Combobox
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
              placeholder="Filter status..."
              className="h-9 text-sm md:max-w-xs"
            />
          </div>
        )}

        {listQuery.isLoading ? (
          <div className="py-12 text-center text-sm text-gray-500">Memuat purchase order...</div>
        ) : pos.length === 0 ? (
          <div className="py-14 text-center">
            <FileText className="mx-auto mb-4 h-12 w-12 text-gray-300" />
            <p className="text-gray-500">Belum ada purchase order</p>
            <Link href={GENERAL_ROUTES.purchasingPoInsert}>
              <Button variant="outline" className="mt-4 purchasing-secondary-button">
                Buat Purchase Order Pertama
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Nomor PO</th>
                    <th className="px-4 py-3 text-left font-semibold">Tanggal</th>
                    <th className="px-4 py-3 text-left font-semibold">Vendor</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pos.map((po) => (
                    <tr
                      key={po.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => router.push(GENERAL_ROUTES.purchasingPoDetail(po.id))}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">{po.nomor_po}</td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(po.tanggal_po)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{po.vendor_name || "-"}</div>
                        <div className="text-xs text-gray-500">{po.vendor_code || ""}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatRp(po.grand_total ?? po.total ?? 0)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={STATUS_STYLES[po.status] || "bg-gray-100 text-gray-700"}>
                          {STATUS_LABELS[po.status] || po.status.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Link href={GENERAL_ROUTES.purchasingPoDetail(po.id)}>
                          <Button variant="ghost" size="sm" title="Lihat detail">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
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
          </>
        )}
      </PurchasingListSection>
    </div>
  );
}
