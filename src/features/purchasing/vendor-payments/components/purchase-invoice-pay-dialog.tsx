"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { NumericInput } from "@/components/ui/numeric-input";
import { DsDateTimePicker } from "@/components/design-system";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VendorPayment } from "@/types/purchasing";
import { formatAmount } from "@/lib/purchasing/utils";
import { usePayPurchaseInvoice } from "../mutations";
import type { PurchaseInvoiceRow } from "../types";

type PayDialogProps = {
  row: PurchaseInvoiceRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function PurchaseInvoicePayDialog({ row, open, onOpenChange }: PayDialogProps) {
  const payMutation = usePayPurchaseInvoice();
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [method, setMethod] = useState<VendorPayment["method"]>("bank_transfer");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  const outstanding = row?.outstanding_amount ?? 0;
  const paymentPreviewType = useMemo(() => {
    const value = Number(amount || 0);
    if (value <= 0) return null;
    return value >= outstanding - 0.01 ? "full" : "installment";
  }, [amount, outstanding]);

  useEffect(() => {
    if (!open || !row) return;
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setAmount(row.outstanding_amount > 0 ? row.outstanding_amount : undefined);
    setMethod("bank_transfer");
    setReferenceNumber("");
    setNotes("");
  }, [open, row]);

  const handleSubmit = async () => {
    if (!row) return;
    const paymentAmount = Number(amount || 0);
    if (!paymentDate || paymentAmount <= 0) {
      toast.error("Enter a payment date and amount");
      return;
    }
    if (paymentAmount > outstanding + 0.01) {
      toast.error(`Payment amount cannot exceed outstanding balance (${formatAmount(outstanding)})`);
      return;
    }

    try {
      await payMutation.mutateAsync({
        poId: row.purchase_order_id,
        payload: {
          payment_date: paymentDate,
          amount: paymentAmount,
          method,
          reference_number: referenceNumber.trim() || null,
          notes: notes.trim() || null,
        },
      });
      toast.success(
        paymentPreviewType === "full" ? "Full payment recorded" : "Payment recorded successfully"
      );
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to record payment");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl border border-gray-200/70 p-0 shadow-xl ring-1 ring-gray-200/60 sm:max-w-[620px]">
        <DialogHeader className="border-b border-gray-200/70 px-5 py-4">
          <DialogTitle className="text-base font-semibold text-gray-900">
            Pay {row?.nomor_po || "Purchase Order"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-5 text-gray-500">
            Record a vendor payment for this purchase order invoice.
          </DialogDescription>
        </DialogHeader>
        {row && (
          <div className="grid gap-4 px-5 py-4">
            <div className="rounded-xl border border-pink-100 bg-pink-50 p-3">
              <div className="text-xs font-semibold text-pink-700">Outstanding balance</div>
              <div className="mt-1 text-lg font-bold text-pink-700">{formatAmount(outstanding)}</div>
              <div className="mt-1 text-xs text-pink-700/80">
                PO total {formatAmount(row.gross_payable_amount)}
                {row.return_credit_amount > 0 && (
                  <> · Returns -{formatAmount(row.return_credit_amount)}</>
                )}
                {row.reject_credit_amount > 0 && (
                  <> · Reject credits -{formatAmount(row.reject_credit_amount)}</>
                )}
                {" · "}Paid {formatAmount(row.paid_amount)}
              </div>
            </div>

            {paymentPreviewType && (
              <div
                className={`rounded-xl border px-3 py-2 text-sm ${
                  paymentPreviewType === "full"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {paymentPreviewType === "full"
                  ? "This payment will be recorded as Paid in Full."
                  : "This payment will be recorded as an installment."}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <DsDateTimePicker
                label="Payment Date"
                value={paymentDate}
                onChange={setPaymentDate}
                placeholder="Select payment date..."
                dateOnly
                required
              />
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">Payment Amount</Label>
                  {outstanding > 0 && (
                    <button
                      type="button"
                      className="text-xs font-medium text-pink-600 hover:underline"
                      onClick={() => setAmount(outstanding)}
                    >
                      Pay full amount
                    </button>
                  )}
                </div>
                <NumericInput
                  value={amount}
                  max={outstanding}
                  onValueChange={(value) => setAmount(value || undefined)}
                  decimalScale={0}
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Method</Label>
                <Combobox
                  options={[
                    { value: "bank_transfer", label: "Bank Transfer" },
                    { value: "cash", label: "Cash" },
                    { value: "giro", label: "Giro" },
                    { value: "qris", label: "QRIS" },
                    { value: "other", label: "Other" },
                  ]}
                  value={method}
                  onChange={(value) => setMethod(value as VendorPayment["method"])}
                  placeholder="Select method..."
                  searchPlaceholder="Search method..."
                  emptyMessage="No method found"
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Reference Number</Label>
                <Input
                  value={referenceNumber}
                  onChange={(event) => setReferenceNumber(event.target.value)}
                  placeholder="Transfer number / payment proof"
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional"
                className="h-9 text-sm"
              />
            </div>
          </div>
        )}
        <DialogFooter className="mx-0 mb-0 gap-2 border-t border-gray-200/70 bg-gray-50/60 px-5 py-4 sm:justify-end">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={payMutation.isPending}
            className="purchasing-secondary-button"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={payMutation.isPending || !row?.can_pay}
            className="purchasing-main-button"
          >
            {payMutation.isPending ? "Processing..." : "Submit Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
