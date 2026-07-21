"use client";

import { useState } from "react";
import { FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatRupiah } from "../../pipeline/types";
import { useDeleteQuotation, useQuotations } from "../queries";
import {
  QUOTATION_STATUS_BADGES,
  QUOTATION_STATUS_LABELS,
  type Quotation,
} from "../types";
import { QuotationBuilderDialog } from "./quotation-builder-dialog";

interface QuotationSectionProps {
  dealId: string;
  enabled: boolean;
}

export function QuotationSection({ dealId, enabled }: QuotationSectionProps) {
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [deleting, setDeleting] = useState<Quotation | null>(null);

  const quotationsQuery = useQuotations(dealId, enabled);
  const deleteMutation = useDeleteQuotation();
  const quotations = quotationsQuery.data ?? [];

  return (
    <div className="space-y-2.5 border-b border-gray-100 px-6 py-4">
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <FileText className="h-4 w-4 text-pink-500" /> Quotation
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setEditing(null);
            setBuilderOpen(true);
          }}
          className="h-8 gap-1 rounded-lg bg-pink-600 text-white hover:bg-pink-700"
        >
          <Plus className="h-3.5 w-3.5" /> Buat Quotation
        </Button>
      </div>

      {quotationsQuery.isLoading ? (
        <div className="py-3 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-pink-600" />
        </div>
      ) : quotations.length === 0 ? (
        <p className="py-2 text-xs text-gray-400">
          Belum ada penawaran — susun item bebas + produk katalog per pax.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {quotations.map((quotation) => (
            <li
              key={quotation.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-gray-200/80 bg-white px-3 py-2.5"
            >
              <button
                type="button"
                onClick={() => {
                  setEditing(quotation);
                  setBuilderOpen(true);
                }}
                className="min-w-0 flex-1 text-left"
              >
                <p className="text-sm font-medium text-gray-900 hover:text-pink-600">
                  {quotation.quote_number}
                </p>
                <p className="text-xs text-gray-500">
                  {quotation.items.length} item ·{" "}
                  {quotation.use_ppn
                    ? `PPN ${Number(quotation.ppn_persen)}%`
                    : "tanpa PPN"}
                  {quotation.valid_until
                    ? ` · s/d ${new Date(quotation.valid_until).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}`
                    : ""}
                </p>
              </button>
              <div className="shrink-0 text-right">
                <Badge className={QUOTATION_STATUS_BADGES[quotation.status]}>
                  {QUOTATION_STATUS_LABELS[quotation.status]}
                </Badge>
                <p className="mt-0.5 text-sm font-semibold text-gray-900">
                  {formatRupiah(quotation.total)}
                </p>
              </div>
              {!quotation.stock_deducted_at ? (
                <button
                  type="button"
                  onClick={() => setDeleting(quotation)}
                  title="Hapus quotation"
                  className="shrink-0 text-gray-300 hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <QuotationBuilderDialog
        open={builderOpen}
        onOpenChange={(open) => {
          setBuilderOpen(open);
          if (!open) setEditing(null);
        }}
        dealId={dealId}
        quotation={editing}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus quotation?"
        description={`Quotation ${deleting?.quote_number ?? ""} akan dihapus.`}
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
