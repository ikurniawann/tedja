"use client";

import { useEffect, useState } from "react";
import {
  Banknote,
  CreditCard,
  Coins,
  Loader2,
  QrCode,
  Wifi,
} from "lucide-react";

import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { formatIdrInput, parseIdrDigits } from "./idr-input";

export type PaymentMethod = "cash" | "qris" | "credit_card" | "ark_coin";

const PAYMENT_OPTIONS: Array<{
  key: PaymentMethod;
  title: string;
  desc: string;
  icon: typeof Banknote;
}> = [
  { key: "cash", title: "Cash", desc: "Bayar dengan uang tunai", icon: Banknote },
  { key: "qris", title: "QRIS", desc: "Scan QR code", icon: QrCode },
  { key: "credit_card", title: "Credit Card", desc: "Visa / Mastercard", icon: CreditCard },
  { key: "ark_coin", title: "ARK Coin", desc: "Saldo member", icon: Coins },
];

interface Props {
  open: boolean;
  total: number;
  totalAfterArk: number;
  selectedCustomer: {
    id: string;
    name?: string;
    ark_coin_balance: number;
  } | null;
  onClose: () => void;
  onConfirm: (payload: {
    method: PaymentMethod;
    cashReceived: string;
    arkToUse: number;
  }) => void | Promise<void>;
  submitting?: boolean;
  formatCurrency: (v: number) => string;
  formatArk: (v: number) => string;
  onTapNFC: () => void;
}

export function PaymentModal({
  open,
  total,
  totalAfterArk,
  selectedCustomer,
  onClose,
  onConfirm,
  submitting = false,
  formatCurrency,
  formatArk,
  onTapNFC,
}: Props) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [arkToUse, setArkToUse] = useState(0);

  useEffect(() => {
    if (method === "ark_coin") {
      const max = selectedCustomer
        ? Math.min(selectedCustomer.ark_coin_balance, total)
        : 0;
      setArkToUse(max);
    } else {
      setArkToUse(0);
    }
  }, [method, selectedCustomer, total]);

  useEffect(() => {
    if (!open) {
      setMethod("cash");
      setCashReceived("");
      setArkToUse(0);
    }
  }, [open]);

  const cashAmount = parseIdrDigits(cashReceived);
  const change = method === "cash" ? cashAmount - totalAfterArk : 0;

  const isValid = (() => {
    if (method === "cash") {
      return cashAmount >= totalAfterArk;
    }
    if (method === "ark_coin") {
      return !!selectedCustomer && selectedCustomer.ark_coin_balance >= total;
    }
    return true;
  })();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>Metode Pembayaran</DialogPanelTitle>
          <DialogPanelDescription>
            Pilih cara bayar untuk tagihan ini.
          </DialogPanelDescription>
        </DialogPanelHeader>

        <DialogPanelBody className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            {PAYMENT_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = method === option.key;
              const desc =
                option.key === "ark_coin"
                  ? formatArk(selectedCustomer?.ark_coin_balance || 0)
                  : option.desc;

              return (
                <button
                  key={option.key}
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setMethod(option.key);
                    if (option.key === "ark_coin" && !selectedCustomer) {
                      onTapNFC();
                    }
                  }}
                  className={cn(
                    "flex min-h-[5.5rem] flex-col items-start gap-2 rounded-xl border p-3.5 text-left transition-colors",
                    selected
                      ? "border-primary/40 bg-primary/10 ring-1 ring-primary/30"
                      : "border-gray-200/70 bg-white hover:border-primary/30 hover:bg-primary/5",
                    submitting && "cursor-not-allowed opacity-60"
                  )}
                >
                  <Icon
                    className={cn(
                      "h-5 w-5",
                      selected ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      {option.title}
                    </div>
                    <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {method === "cash" && (
            <div className="space-y-3 rounded-xl border border-gray-200/70 bg-muted/30 p-4">
              <label className="text-sm font-medium text-foreground">
                Jumlah uang diterima
              </label>
              <Input
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={formatIdrInput(cashReceived)}
                onChange={(e) =>
                  setCashReceived(String(parseIdrDigits(e.target.value) || ""))
                }
                disabled={submitting}
                className="h-11 border-gray-200/80 bg-white text-base tabular-nums"
              />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {change >= 0 ? "Kembalian" : "Kurang"}
                </span>
                <span
                  className={cn(
                    "font-semibold",
                    change >= 0 ? "text-emerald-600" : "text-red-600"
                  )}
                >
                  {formatCurrency(Math.abs(change))}
                </span>
              </div>
            </div>
          )}

          {method === "ark_coin" && !selectedCustomer && (
            <div className="space-y-3 rounded-xl border border-amber-200/80 bg-amber-50 p-4 text-center">
              <Wifi className="mx-auto h-8 w-8 text-amber-500" />
              <div className="text-sm font-semibold text-amber-800">
                Member belum dipilih
              </div>
              <p className="text-xs text-amber-700/80">
                Tap kartu NFC atau pilih member untuk bayar dengan ARK Coin.
              </p>
              <Button
                type="button"
                onClick={onTapNFC}
                disabled={submitting}
                className="w-full bg-amber-500 text-white hover:bg-amber-600"
              >
                Tap kartu NFC
              </Button>
            </div>
          )}

          {method === "ark_coin" && selectedCustomer && (
            <div className="space-y-2 rounded-xl border border-amber-200/80 bg-amber-50 p-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Saldo ARK</span>
                <span className="font-semibold text-amber-700">
                  {formatArk(selectedCustomer.ark_coin_balance)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total tagihan</span>
                <span className="font-semibold text-foreground">
                  {formatArk(total)}
                </span>
              </div>
              <p
                className={cn(
                  "text-sm font-medium",
                  selectedCustomer.ark_coin_balance >= total
                    ? "text-emerald-600"
                    : "text-red-600"
                )}
              >
                {selectedCustomer.ark_coin_balance >= total
                  ? "Saldo cukup untuk membayar penuh"
                  : `Saldo kurang ${formatArk(total - selectedCustomer.ark_coin_balance)}`}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl border border-gray-200/70 bg-white px-4 py-3">
            <span className="text-sm font-medium text-muted-foreground">Total</span>
            <span className="text-lg font-bold text-primary">
              {formatCurrency(total)}
            </span>
          </div>
        </DialogPanelBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="border-gray-200/80"
            onClick={onClose}
            disabled={submitting}
          >
            Batal
          </Button>
          <Button
            type="button"
            className="bg-primary hover:bg-primary/90"
            disabled={!isValid || submitting}
            onClick={() =>
              onConfirm({
                method,
                cashReceived: String(cashAmount || ""),
                arkToUse,
              })
            }
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Memproses…
              </>
            ) : (
              "Konfirmasi pembayaran"
            )}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
