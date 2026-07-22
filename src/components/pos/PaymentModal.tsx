"use client";

import { useEffect, useState } from "react";
import {
  Banknote,
  CreditCard,
  Coins,
  Loader2,
  QrCode,
  Ticket,
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
import type { CfdPayment } from "@/lib/pos/cfd";

export type PaymentMethod = "cash" | "qris" | "credit_card" | "ark_coin" | "nfc_tab";

/** Hasil pratinjau tab ticketing (EPIC-023 Fase C) utk metode NFC Tab. */
export interface NfcTabCheckResult {
  ok: boolean;
  reason?: string;
  contactName?: string;
  paymentMode?: "postpaid" | "prepaid";
  available?: number | null;
}

const PAYMENT_OPTIONS: Array<{
  key: PaymentMethod;
  title: string;
  desc: string;
  icon: typeof Banknote;
}> = [
  { key: "cash", title: "Cash", desc: "Pay with cash", icon: Banknote },
  { key: "qris", title: "QRIS", desc: "Scan QR code", icon: QrCode },
  { key: "credit_card", title: "Credit Card", desc: "Visa / Mastercard", icon: CreditCard },
  { key: "ark_coin", title: "ARK Coin", desc: "Member balance", icon: Coins },
  { key: "nfc_tab", title: "NFC Tab", desc: "Gelang ticketing", icon: Ticket },
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
    /** UID gelang ticketing — terisi saat method 'nfc_tab' */
    nfcTabUid?: string;
  }) => void | Promise<void>;
  submitting?: boolean;
  formatCurrency: (v: number) => string;
  formatArk: (v: number) => string;
  onTapNFC: () => void;
  /**
   * Pratinjau tab ticketing utk metode NFC Tab (opsional — tanpa prop ini
   * opsi NFC Tab disembunyikan, mis. dipakai di luar kasir venue ticketing).
   */
  onCheckNfcTab?: (uid: string) => Promise<NfcTabCheckResult>;
  /**
   * EPIC-024 — sinkron state pembayaran ke customer display (opsional).
   * Bila diberikan: perubahan metode/tunai/QR dipancarkan; metode QRIS
   * membuat QR dinamis Xendit ber-nominal terkunci.
   */
  onCfdPayment?: (payment: CfdPayment | null) => void;
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
  onCheckNfcTab,
  onCfdPayment,
}: Props) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [arkToUse, setArkToUse] = useState(0);
  const [tabUidInput, setTabUidInput] = useState("");
  const [tabChecking, setTabChecking] = useState(false);
  const [tabResult, setTabResult] = useState<
    (NfcTabCheckResult & { uid: string }) | null
  >(null);
  // QRIS dinamis (EPIC-024) — QR per transaksi ber-nominal terkunci
  const [qris, setQris] = useState<{ amount: number; qr_string: string } | null>(
    null
  );
  const [qrisLoading, setQrisLoading] = useState(false);
  const [qrisError, setQrisError] = useState<string | null>(null);

  const checkTabUid = async (rawUid: string) => {
    const uid = rawUid.trim();
    if (!uid || !onCheckNfcTab || tabChecking) return;
    setTabChecking(true);
    setTabUidInput("");
    try {
      const result = await onCheckNfcTab(uid);
      setTabResult({ ...result, uid });
    } catch (err) {
      setTabResult({
        ok: false,
        reason: err instanceof Error ? err.message : "Gagal memeriksa gelang",
        uid,
      });
    } finally {
      setTabChecking(false);
    }
  };

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
      setTabUidInput("");
      setTabResult(null);
      setQris(null);
      setQrisError(null);
    }
  }, [open]);

  // Buat QR dinamis saat QRIS dipilih (sekali per nominal) — gagal bukan
  // penghalang bayar: kasir bisa lanjut dgn QRIS statis di meja.
  useEffect(() => {
    if (!open || method !== "qris" || !onCfdPayment) return;
    if (qrisLoading || (qris && qris.amount === totalAfterArk)) return;
    let cancelled = false;
    setQrisLoading(true);
    setQrisError(null);
    fetch("/api/pos/qris", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: totalAfterArk }),
    })
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setQrisError(body.error || "Gagal membuat QR dinamis");
          return;
        }
        setQris({ amount: body.data.amount, qr_string: body.data.qr_string });
      })
      .catch(() => {
        if (!cancelled) setQrisError("Gagal membuat QR dinamis");
      })
      .finally(() => {
        if (!cancelled) setQrisLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, method, totalAfterArk, onCfdPayment]);

  const cashAmount = parseIdrDigits(cashReceived);
  const change = method === "cash" ? cashAmount - totalAfterArk : 0;

  // Pancarkan state pembayaran ke customer display (satu arah, read-only)
  useEffect(() => {
    if (!onCfdPayment) return;
    if (!open) {
      onCfdPayment(null);
      return;
    }
    onCfdPayment({
      method,
      amount: totalAfterArk,
      cash_received: method === "cash" && cashAmount > 0 ? cashAmount : undefined,
      change: method === "cash" && cashAmount > 0 && change >= 0 ? change : undefined,
      qr_string: method === "qris" ? (qris?.qr_string ?? null) : undefined,
      qr_loading: method === "qris" ? qrisLoading : undefined,
    });
  }, [open, method, cashAmount, change, totalAfterArk, qris, qrisLoading, onCfdPayment]);

  const isValid = (() => {
    if (method === "cash") {
      return cashAmount >= totalAfterArk;
    }
    if (method === "ark_coin") {
      return !!selectedCustomer && selectedCustomer.ark_coin_balance >= total;
    }
    if (method === "nfc_tab") {
      return tabResult?.ok === true;
    }
    return true;
  })();

  const paymentOptions = PAYMENT_OPTIONS.filter(
    (option) => option.key !== "nfc_tab" || Boolean(onCheckNfcTab)
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>Payment Method</DialogPanelTitle>
          <DialogPanelDescription>
            Choose how to pay this bill.
          </DialogPanelDescription>
        </DialogPanelHeader>

        <DialogPanelBody className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            {paymentOptions.map((option) => {
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
                Amount received
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
                  {change >= 0 ? "Change" : "Shortfall"}
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

          {method === "qris" && onCfdPayment && (
            <div className="rounded-xl border border-gray-200/70 bg-muted/30 p-4 text-sm">
              {qrisLoading ? (
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Membuat QR dinamis…
                </span>
              ) : qris ? (
                <span className="inline-flex items-center gap-2 font-medium text-emerald-700">
                  <QrCode className="h-4 w-4" />
                  QR tampil di layar customer — nominal terkunci{" "}
                  {formatCurrency(qris.amount)}
                </span>
              ) : (
                <span className="text-amber-700">
                  {qrisError ?? "QR dinamis tidak tersedia"} — lanjutkan dengan
                  QRIS statis di meja.
                </span>
              )}
            </div>
          )}

          {method === "nfc_tab" && (
            <div className="space-y-3 rounded-xl border border-sky-200/80 bg-sky-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-sky-800">
                <Wifi className="h-4 w-4" />
                Tap gelang pengunjung
              </div>
              <Input
                autoFocus
                placeholder="Fokuskan kursor lalu tap gelang di reader"
                value={tabUidInput}
                onChange={(e) => setTabUidInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void checkTabUid(tabUidInput);
                  }
                }}
                disabled={submitting || tabChecking}
                className="h-11 border-sky-200/80 bg-white font-mono text-sm"
              />
              {tabChecking && (
                <p className="text-xs text-sky-700/80">Memeriksa gelang…</p>
              )}
              {tabResult && !tabChecking && (
                tabResult.ok ? (
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold text-emerald-700">
                      {tabResult.contactName}
                      <span className="ml-2 text-xs font-normal text-emerald-600">
                        {tabResult.paymentMode === "prepaid" ? "Prepaid" : "Postpaid"}
                      </span>
                    </p>
                    {tabResult.available !== null &&
                      tabResult.available !== undefined && (
                        <p className="text-xs text-muted-foreground">
                          {tabResult.paymentMode === "prepaid"
                            ? "Saldo tersisa setelah order"
                            : "Sisa plafon setelah order"}
                          : {formatCurrency(Math.max(0, tabResult.available - total))}
                        </p>
                      )}
                    <p className="text-xs text-emerald-600">
                      Tagihan pindah ke tab — dibayar saat keluar / dipotong saldo
                    </p>
                  </div>
                ) : (
                  <p className="text-sm font-medium text-red-600">
                    {tabResult.reason || "Gelang tidak bisa dipakai"}
                  </p>
                )
              )}
            </div>
          )}

          {method === "ark_coin" && !selectedCustomer && (
            <div className="space-y-3 rounded-xl border border-amber-200/80 bg-amber-50 p-4 text-center">
              <Wifi className="mx-auto h-8 w-8 text-amber-500" />
              <div className="text-sm font-semibold text-amber-800">
                No member selected
              </div>
              <p className="text-xs text-amber-700/80">
                Tap an NFC card or select a member to pay with ARK Coin.
              </p>
              <Button
                type="button"
                onClick={onTapNFC}
                disabled={submitting}
                className="w-full bg-amber-500 text-white hover:bg-amber-600"
              >
                Tap NFC card
              </Button>
            </div>
          )}

          {method === "ark_coin" && selectedCustomer && (
            <div className="space-y-2 rounded-xl border border-amber-200/80 bg-amber-50 p-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">ARK balance</span>
                <span className="font-semibold text-amber-700">
                  {formatArk(selectedCustomer.ark_coin_balance)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Bill total</span>
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
                  ? "Balance covers the full amount"
                  : `Short by ${formatArk(total - selectedCustomer.ark_coin_balance)}`}
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
            Cancel
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
                nfcTabUid:
                  method === "nfc_tab" && tabResult?.ok
                    ? tabResult.uid
                    : undefined,
              })
            }
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing…
              </>
            ) : (
              "Confirm payment"
            )}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
