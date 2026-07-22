"use client";

import { useState } from "react";
import { Loader2, Trash2, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateDealPayment,
  useDealPayments,
  useDeleteDealPayment,
} from "../queries";
import { formatRupiah } from "../types";

/**
 * Pembayaran deal (EPIC-022 Fase G): catat pembayaran masuk + progress
 * pelunasan vs termin quotation (waterfall — status per termin otomatis).
 */

const METHOD_LABELS: Record<string, string> = {
  cash: "Tunai",
  transfer: "Transfer",
  qris: "QRIS",
  edc: "Kartu / EDC",
  lainnya: "Lainnya",
};

const TERM_BADGES: Record<string, string> = {
  lunas: "bg-emerald-100 text-emerald-700",
  sebagian: "bg-amber-100 text-amber-700",
  belum: "bg-gray-100 text-gray-500",
};

const todayInput = () => {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
};

function formatShortDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function PaymentSection({
  dealId,
  enabled,
}: {
  dealId: string;
  enabled: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("transfer");
  const [paidOn, setPaidOn] = useState(todayInput);
  const [note, setNote] = useState("");

  const paymentsQuery = useDealPayments(dealId, enabled);
  const createMutation = useCreateDealPayment(dealId, () => {
    setAmount("");
    setNote("");
  });
  const deleteMutation = useDeleteDealPayment(dealId);

  const data = paymentsQuery.data;
  const progressPct =
    data && data.summary.reference_total > 0
      ? Math.min(
          100,
          Math.round((data.summary.total_paid / data.summary.reference_total) * 100)
        )
      : 0;

  const handleSubmit = () => {
    const value = Number(amount) || 0;
    if (value <= 0 || !paidOn || createMutation.isPending) return;
    createMutation.mutate({
      amount: value,
      method,
      paid_on: paidOn,
      note: note.trim() || null,
    });
  };

  return (
    <div className="space-y-3 border-b border-gray-100 px-6 py-4">
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <Wallet className="h-4 w-4 text-pink-500" />
        Pembayaran
      </p>

      {paymentsQuery.isLoading || !data ? (
        <div className="py-4 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-pink-600" />
        </div>
      ) : (
        <>
          {/* Progress pelunasan */}
          <div className="rounded-xl border border-gray-200/80 p-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-gray-600">
                Terbayar{" "}
                <span className="font-semibold text-gray-900">
                  {formatRupiah(data.summary.total_paid)}
                </span>{" "}
                dari {formatRupiah(data.summary.reference_total)}
                {data.summary.reference_quote_number ? (
                  <span className="ml-1 text-xs text-gray-400">
                    ({data.summary.reference_quote_number}
                    {data.summary.reference_is_accepted ? " · diterima" : ""})
                  </span>
                ) : null}
              </span>
              <span className="text-sm font-bold text-gray-900">{progressPct}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full ${
                  progressPct >= 100 ? "bg-emerald-500" : "bg-pink-500"
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {data.summary.outstanding > 0 ? (
              <p className="mt-1.5 text-xs text-gray-500">
                Sisa tagihan:{" "}
                <span className="font-semibold text-gray-800">
                  {formatRupiah(data.summary.outstanding)}
                </span>
              </p>
            ) : data.summary.reference_total > 0 ? (
              <p className="mt-1.5 text-xs font-medium text-emerald-600">
                Lunas ✓
              </p>
            ) : null}

            {/* Status per termin (waterfall dari total pembayaran) */}
            {data.terms.length > 0 ? (
              <div className="mt-2.5 space-y-1.5">
                {data.terms.map((term, index) => (
                  <div
                    key={index}
                    className="flex flex-wrap items-center gap-2 text-xs"
                  >
                    <Badge className={`border-0 font-normal ${TERM_BADGES[term.status]}`}>
                      {term.status}
                    </Badge>
                    <span className="font-medium text-gray-800">
                      {term.label} ({Number(term.percent).toLocaleString("id-ID")}%)
                    </span>
                    <span className="text-gray-500">
                      {formatRupiah(term.paid)} / {formatRupiah(term.amount)}
                    </span>
                    {term.due_date ? (
                      <span className="ml-auto text-gray-400">
                        jatuh tempo {formatShortDate(term.due_date)}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Catat pembayaran */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Nominal"
              className="h-9 text-sm"
            />
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(METHOD_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
              className="h-9 text-sm"
            />
            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              disabled={createMutation.isPending || !(Number(amount) > 0) || !paidOn}
              className="h-9 rounded-lg bg-pink-600 text-white hover:bg-pink-700"
            >
              {createMutation.isPending ? "Menyimpan…" : "Catat"}
            </Button>
          </div>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Catatan (mis. transfer BCA a.n. Budi — DP)"
            className="h-9 text-sm"
          />

          {/* Riwayat */}
          {data.payments.length > 0 ? (
            <ul className="space-y-1.5">
              {data.payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex items-center gap-2 rounded-lg border border-gray-200/70 px-3 py-2 text-sm"
                >
                  <span className="font-semibold text-gray-900">
                    {formatRupiah(payment.amount)}
                  </span>
                  <Badge className="border-0 bg-gray-100 font-normal text-gray-600">
                    {METHOD_LABELS[payment.method] ?? payment.method}
                  </Badge>
                  <span className="text-xs text-gray-500">
                    {formatShortDate(payment.paid_on)}
                    {payment.note ? ` · ${payment.note}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(payment.id)}
                    title="Hapus catatan (salah catat)"
                    className="ml-auto shrink-0 text-gray-300 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">
              Belum ada pembayaran tercatat.
            </p>
          )}
        </>
      )}
    </div>
  );
}
