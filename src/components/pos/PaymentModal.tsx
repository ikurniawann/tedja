"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CreditCard,
  Coins,
  Gift,
  Loader2,
  QrCode,
  Ticket,
  Wifi,
  type LucideIcon,
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

import { QrisCard } from "@/components/pos/QrisCard";

import { formatIdrInput, parseIdrDigits } from "./idr-input";
import type { CfdPayment } from "@/lib/pos/cfd";
import {
  MIXED_ARK_UNSUPPORTED_MESSAGE,
  MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE,
  buildPosQrisCreateBody,
  isCheckoutBillUnsupportedTender,
  isMixedUnsupportedTender,
  mayConfirmMixedQris,
  mixedQrisCheckoutIdForAmount,
  shouldSkipQrisPrepare,
} from "@/lib/pos/central-cashier";
import { cancelCheckout } from "@/lib/pos-api";
import {
  cashierMethodFromHandler,
  DEFAULT_POS_PAYMENT_METHODS,
} from "@/lib/pos/payment-methods";
import { usePaymentMethods } from "@/features/pos/payment-methods";

export type PaymentMethod =
  | "cash"
  | "qris"
  | "credit_card"
  | "ark_coin"
  | "nfc_tab"
  | "gift_card"
  // Metode kustom buatan admin (master Metode Bayar) — alur generik
  | (string & {});

/** Hasil pratinjau tab ticketing (EPIC-023 Fase C) utk metode NFC Tab. */
export interface NfcTabCheckResult {
  ok: boolean;
  reason?: string;
  contactName?: string;
  paymentMode?: "postpaid" | "prepaid";
  available?: number | null;
}

/**
 * Hasil pratinjau gift card (EPIC-034 Fase C). INDIKATIF — saldo final tetap
 * ditegakkan server saat debit ber-lock.
 */
export interface GiftCardCheckResult {
  ok: boolean;
  reason?: string;
  balance?: number;
  /** Saldo menutup SELURUH total (keputusan owner: full-cover only). */
  covers?: boolean;
  expiresAt?: string | null;
}

const ICON_BY_KEY: Record<string, LucideIcon> = {
  banknote: Banknote,
  "qr-code": QrCode,
  "credit-card": CreditCard,
  coins: Coins,
  ticket: Ticket,
  gift: Gift,
  cash: Banknote,
  qris: QrCode,
  credit_card: CreditCard,
  ark_coin: Coins,
  nfc_tab: Ticket,
  gift_card: Gift,
};

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
    /** Kode gift card — terisi saat method 'gift_card' (EPIC-034 Fase C) */
    giftCardCode?: string;
    checkoutId?: string;
    checkoutNumber?: string;
    queueNumber?: string | null;
    xenditQrId?: string;
    xenditExternalId?: string;
    paymentMethodCode?: string;
    paymentMethodName?: string;
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
   * EPIC-034 Fase C — pratinjau saldo gift card (opsional; tanpa prop ini
   * opsi Gift Card disembunyikan, pola yang sama dgn NFC Tab).
   */
  onCheckGiftCard?: (code: string) => Promise<GiftCardCheckResult>;
  /**
   * EPIC-024 — sinkron state pembayaran ke customer display (opsional).
   * Bila diberikan: perubahan metode/tunai/QR dipancarkan; metode QRIS
   * membuat QR dinamis Xendit ber-nominal terkunci.
   */
  onCfdPayment?: (payment: CfdPayment | null) => void;
  /** Cart has items from 2+ stalls — QRIS must bind to checkout_id. */
  isMixedCart?: boolean;
  /** Paying an existing table/central checkout — ARK/NFC/gift are not wired. */
  isCheckoutBill?: boolean;
  onPrepareMixedQrisCheckout?: () => Promise<{
    checkout_id: string;
    checkout_number?: string;
    queue_number?: string | null;
  }>;
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
  onCheckGiftCard,
  onCfdPayment,
  isMixedCart = false,
  isCheckoutBill = false,
  onPrepareMixedQrisCheckout,
}: Props) {
  const methodsQuery = usePaymentMethods(true);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [selectedCode, setSelectedCode] = useState("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [arkToUse, setArkToUse] = useState(0);
  const [tabUidInput, setTabUidInput] = useState("");
  const [tabChecking, setTabChecking] = useState(false);
  const [tabResult, setTabResult] = useState<
    (NfcTabCheckResult & { uid: string }) | null
  >(null);
  // QRIS dinamis (EPIC-024) — QR per transaksi ber-nominal terkunci
  const [qris, setQris] = useState<{
    amount: number;
    qr_string: string;
    qr_id: string;
    reference_id?: string;
    merchant_name?: string | null;
    nmid?: string | null;
  } | null>(null);
  const [qrisLoading, setQrisLoading] = useState(false);
  const [qrisUnavailable, setQrisUnavailable] = useState(false);
  const [qrisError, setQrisError] = useState<string | null>(null);
  const [qrisPaid, setQrisPaid] = useState(false);
  const [mixedQrisCheckout, setMixedQrisCheckout] = useState<{
    checkout_id: string;
    checkout_number?: string;
    queue_number?: string | null;
    amount: number;
  } | null>(null);
  const qrisConfirmStarted = useRef(false);
  const qrisWasSubmitting = useRef(false);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const mixedQrisCheckoutRef = useRef(mixedQrisCheckout);
  mixedQrisCheckoutRef.current = mixedQrisCheckout;
  const qrisPaidRef = useRef(qrisPaid);
  qrisPaidRef.current = qrisPaid;
  const submittingRef = useRef(submitting);
  submittingRef.current = submitting;

  const abandonPreparedMixedQris = (checkoutId?: string | null) => {
    const id = checkoutId || mixedQrisCheckoutRef.current?.checkout_id;
    if (!id || qrisPaidRef.current || submittingRef.current) return;
    void cancelCheckout(id).catch(() => {});
  };

  const handleClose = () => {
    if (submitting) return;
    abandonPreparedMixedQris();
    onClose();
  };

  // EPIC-034 Fase C — kode gift card diketik/di-scan kasir
  const [giftCodeInput, setGiftCodeInput] = useState("");
  const [giftChecking, setGiftChecking] = useState(false);
  const [giftResult, setGiftResult] = useState<
    (GiftCardCheckResult & { code: string }) | null
  >(null);

  const paymentOptions = useMemo(() => {
    const source =
      methodsQuery.data && methodsQuery.data.length > 0
        ? methodsQuery.data
        : DEFAULT_POS_PAYMENT_METHODS.filter((m) => m.is_active);
    return source
      .filter((option) => {
        if (option.code === "nfc_tab") return Boolean(onCheckNfcTab);
        if (option.code === "gift_card") return Boolean(onCheckGiftCard);
        return true;
      })
      .map((option) => ({
        code: option.code,
        cashierKey: cashierMethodFromHandler(option.handler),
        title: option.name,
        desc: option.description,
        icon:
          ICON_BY_KEY[option.icon] ||
          ICON_BY_KEY[option.code] ||
          Banknote,
        requiresCashInput: option.requires_cash_input,
      }));
  }, [methodsQuery.data, onCheckGiftCard, onCheckNfcTab]);

  const checkGiftCode = async (rawCode: string) => {
    const code = rawCode.trim().toUpperCase();
    if (!code || !onCheckGiftCard || giftChecking) return;
    setGiftChecking(true);
    try {
      const result = await onCheckGiftCard(code);
      setGiftResult({ ...result, code });
    } catch (err) {
      setGiftResult({
        ok: false,
        reason: err instanceof Error ? err.message : "Gagal memeriksa gift card",
        code,
      });
    } finally {
      setGiftChecking(false);
    }
  };

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
      abandonPreparedMixedQris();
      setMethod("cash");
      setSelectedCode("cash");
      setCashReceived("");
      setArkToUse(0);
      setTabUidInput("");
      setTabResult(null);
      setGiftCodeInput("");
      setGiftResult(null);
      setQris(null);
      setQrisUnavailable(false);
      setQrisError(null);
      setQrisPaid(false);
      setMixedQrisCheckout(null);
      qrisConfirmStarted.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (isMixedCart && isMixedUnsupportedTender(method)) {
      setMethod("cash");
      setSelectedCode("cash");
    }
    if (isCheckoutBill && isCheckoutBillUnsupportedTender(method)) {
      setMethod("cash");
      setSelectedCode("cash");
    }
    if (method !== "qris") {
      abandonPreparedMixedQris();
      setMixedQrisCheckout(null);
      setQris(null);
      setQrisPaid(false);
      setQrisUnavailable(false);
      setQrisError(null);
      qrisConfirmStarted.current = false;
    }
  }, [isMixedCart, isCheckoutBill, method]);

  useEffect(() => {
    const previous = mixedQrisCheckoutRef.current;
    if (
      previous?.checkout_id &&
      previous.amount !== totalAfterArk
    ) {
      abandonPreparedMixedQris(previous.checkout_id);
    }
    setMixedQrisCheckout(null);
    setQris(null);
    setQrisLoading(false);
    setQrisPaid(false);
    setQrisUnavailable(false);
    setQrisError(null);
    qrisConfirmStarted.current = false;
  }, [totalAfterArk]);

  useEffect(() => {
    if (!open || paymentOptions.length === 0) return;
    if (!paymentOptions.some((option) => option.code === selectedCode)) {
      const first = paymentOptions[0];
      if (!first) return;
      setSelectedCode(first.code);
      setMethod(first.cashierKey);
    }
  }, [open, paymentOptions, selectedCode]);

  // Total berubah (item ditambah/dihapus) → hasil cek lama basi: saldo yang
  // tadinya menutup bisa jadi kurang. Paksa kasir cek ulang.
  useEffect(() => {
    setGiftResult(null);
  }, [total]);
  // Buat QR dinamis saat QRIS dipilih. Gagal → jangan settle; kasir pilih
  // metode lain. Confirm QRIS hanya lewat poll Xendit (bukan klik manual).
  useEffect(() => {
    if (!open || method !== "qris") return;
    const reusableCheckoutId = mixedQrisCheckoutIdForAmount({
      checkoutId: mixedQrisCheckout?.checkout_id,
      boundAmount: mixedQrisCheckout?.amount,
      currentAmount: totalAfterArk,
    });
    if (
      shouldSkipQrisPrepare({
        qrisLoading,
        existingQrAmount: qris?.amount ?? null,
        currentAmount: totalAfterArk,
        mixedCheckoutId: reusableCheckoutId,
        isMixedCart,
        existingQrPaid: qrisPaid,
      })
    ) {
      return;
    }
    let cancelled = false;
    setQrisLoading(true);
    setQrisUnavailable(false);
    setQrisError(null);

    const run = async () => {
      let checkoutId = mixedQrisCheckoutIdForAmount({
        checkoutId: mixedQrisCheckout?.checkout_id,
        boundAmount: mixedQrisCheckout?.amount,
        currentAmount: totalAfterArk,
      });
      if (isMixedCart) {
        if (!onPrepareMixedQrisCheckout) {
          throw new Error("Checkout multi-stall membutuhkan persiapan QRIS");
        }
        if (!checkoutId) {
          const prepared = await onPrepareMixedQrisCheckout();
          if (cancelled) return;
          checkoutId = prepared.checkout_id;
          setMixedQrisCheckout({ ...prepared, amount: totalAfterArk });
        }
      }

      const res = await fetch("/api/pos/qris", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildPosQrisCreateBody({
            amount: totalAfterArk,
            checkoutId,
          })
        ),
      });
      const body = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setQrisUnavailable(true);
        setQrisError(
          typeof body.error === "string" && body.error.trim()
            ? body.error
            : "Gagal membuat QR pembayaran"
        );
        return;
      }
      setQris({
        amount: body.data.amount,
        qr_string: body.data.qr_string,
        qr_id: String(body.data.qr_id || ""),
        reference_id: String(body.data.reference_id || ""),
        merchant_name: body.data.merchant_name ?? null,
        nmid: body.data.nmid ?? null,
      });
      setQrisPaid(false);
      qrisConfirmStarted.current = false;
    };

    void run()
      .catch((err) => {
        if (!cancelled) {
          setQrisUnavailable(true);
          setQrisError(err instanceof Error ? err.message : "Gagal menghubungi server QR");
        }
      })
      .finally(() => {
        if (!cancelled) setQrisLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, method, totalAfterArk, isMixedCart]);

  // QRIS lunas di Xendit → checkout otomatis, sama seperti tunai.
  useEffect(() => {
    if (!open || method !== "qris" || !qris?.qr_id || qrisUnavailable || submitting) {
      return;
    }
    if (qrisConfirmStarted.current) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/pos/qris/${encodeURIComponent(qris.qr_id)}/status`);
        const body = await res.json().catch(() => ({}));
        if (cancelled || qrisConfirmStarted.current) return;
        if (res.ok && body?.data?.paid) {
          if (
            !mayConfirmMixedQris({
              isMixedCart,
              method: "qris",
              qrisPaid: true,
              checkoutId: mixedQrisCheckout?.checkout_id,
            })
          ) {
            return;
          }
          qrisConfirmStarted.current = true;
          setQrisPaid(true);
          void Promise.resolve(
            onConfirmRef.current({
              method: "qris",
              cashReceived: "",
              arkToUse,
              checkoutId: mixedQrisCheckout?.checkout_id,
              checkoutNumber: mixedQrisCheckout?.checkout_number,
              queueNumber: mixedQrisCheckout?.queue_number,
              xenditQrId: qris.qr_id,
              xenditExternalId: qris.reference_id,
              paymentMethodCode: "qris",
              paymentMethodName: "QRIS",
            })
          ).catch(() => {
            qrisConfirmStarted.current = false;
            setQrisPaid(false);
          });
        }
      } catch {
        // Poll lanjut; kasir tetap bisa batal
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, method, qris?.qr_id, qrisUnavailable, submitting, arkToUse, mixedQrisCheckout, isMixedCart]);

  useEffect(() => {
    if (qrisWasSubmitting.current && !submitting && qrisPaid && open) {
      qrisConfirmStarted.current = false;
      setQrisPaid(false);
    }
    qrisWasSubmitting.current = submitting;
  }, [submitting, qrisPaid, open]);

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
    if (method === "gift_card") {
      // Full-cover only (keputusan owner): saldo kurang → kasir minta metode
      // lain, tidak ada bayar sebagian.
      return giftResult?.ok === true && giftResult.covers === true;
    }
    return true;
  })();

  const waitForQris = method === "qris";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && handleClose()}>
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
              const selected = selectedCode === option.code;
              const mixedBlocked = isMixedCart && isMixedUnsupportedTender(option.cashierKey);
              const checkoutBlocked =
                isCheckoutBill && isCheckoutBillUnsupportedTender(option.cashierKey);
              const blocked = mixedBlocked || checkoutBlocked;
              const desc = checkoutBlocked && option.cashierKey === "ark_coin"
                ? MIXED_ARK_UNSUPPORTED_MESSAGE
                : mixedBlocked || checkoutBlocked
                ? MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE
                : option.cashierKey === "ark_coin"
                  ? formatArk(selectedCustomer?.ark_coin_balance || 0)
                  : option.desc;

              return (
                <button
                  key={option.code}
                  type="button"
                  disabled={submitting || blocked}
                  onClick={() => {
                    if (blocked) return;
                    setSelectedCode(option.code);
                    setMethod(option.cashierKey);
                    if (option.cashierKey === "ark_coin" && !selectedCustomer) {
                      onTapNFC();
                    }
                  }}
                  className={cn(
                    "flex min-h-[5.5rem] flex-col items-start gap-2 rounded-xl border p-3.5 text-left transition-colors",
                    selected
                      ? "border-primary/40 bg-primary/10 ring-1 ring-primary/30"
                      : "border-gray-200/70 bg-white hover:border-primary/30 hover:bg-primary/5",
                    (submitting || blocked) && "cursor-not-allowed opacity-60"
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
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium text-foreground">
                  Amount received
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={submitting || totalAfterArk <= 0}
                  onClick={() => setCashReceived(String(Math.round(totalAfterArk)))}
                  className="h-8 border-primary/20 text-primary hover:bg-primary/5"
                >
                  Uang Pas
                </Button>
              </div>
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

          {method === "qris" && (
            <div className="rounded-xl border border-gray-200/70 bg-muted/30 p-4 text-sm">
              {qrisLoading ? (
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Membuat QR dinamis…
                </span>
              ) : qrisUnavailable || !qris ? (
                <span className="inline-flex items-center gap-2 text-amber-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Warning: {qrisError || "QR belum dikonfigurasi"}
                </span>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  {qris.qr_string ? (
                    <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      QR tampil di dialog QRIS…
                    </p>
                  ) : (
                    <span className="inline-flex items-center gap-2 text-amber-700">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      QR belum siap — coba pilih metode lain lalu kembali ke QRIS
                    </span>
                  )}
                </div>
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

          {method === "gift_card" && (
            <div className="space-y-3 rounded-xl border border-violet-200/80 bg-violet-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-violet-800">
                <Gift className="h-4 w-4" />
                Masukkan kode gift card
              </div>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  placeholder="Contoh: ABCD2345EFGH"
                  value={giftCodeInput}
                  onChange={(e) => {
                    setGiftCodeInput(e.target.value.toUpperCase());
                    // Kode diubah → hasil cek sebelumnya tidak berlaku lagi
                    if (giftResult) setGiftResult(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void checkGiftCode(giftCodeInput);
                    }
                  }}
                  disabled={submitting || giftChecking}
                  className="h-11 border-violet-200/80 bg-white font-mono text-sm tracking-wider"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void checkGiftCode(giftCodeInput)}
                  disabled={submitting || giftChecking || !giftCodeInput.trim()}
                  className="h-11 border-violet-200/80"
                >
                  Cek
                </Button>
              </div>
              {giftChecking && (
                <p className="text-xs text-violet-700/80">Memeriksa kartu…</p>
              )}
              {giftResult && !giftChecking && (
                giftResult.ok ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Saldo kartu</span>
                      <span className="font-semibold text-violet-700">
                        {formatCurrency(giftResult.balance ?? 0)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total tagihan</span>
                      <span className="font-semibold text-foreground">
                        {formatCurrency(total)}
                      </span>
                    </div>
                    {giftResult.covers ? (
                      <p className="text-sm font-medium text-emerald-600">
                        Saldo menutup seluruh tagihan — sisa{" "}
                        {formatCurrency(Math.max(0, (giftResult.balance ?? 0) - total))}
                      </p>
                    ) : (
                      <p className="text-sm font-medium text-red-600">
                        Saldo kurang {formatCurrency(total - (giftResult.balance ?? 0))} —
                        gift card harus menutup seluruh tagihan, minta metode lain
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm font-medium text-red-600">
                    {giftResult.reason || "Gift card tidak bisa dipakai"}
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
            onClick={handleClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          {waitForQris ? (
            <Button
              type="button"
              className="bg-primary hover:bg-primary/90"
              disabled
            >
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {qrisPaid || submitting ? "Processing…" : "Menunggu pembayaran…"}
            </Button>
          ) : (
            <Button
              type="button"
              className="bg-primary hover:bg-primary/90"
              disabled={!isValid || submitting}
              onClick={() => {
                if (
                  !mayConfirmMixedQris({
                    isMixedCart,
                    method,
                    qrisPaid,
                    checkoutId: mixedQrisCheckout?.checkout_id,
                  })
                ) {
                  return;
                }
                void onConfirm({
                  method,
                  cashReceived: String(cashAmount || ""),
                  arkToUse,
                  nfcTabUid:
                    method === "nfc_tab" && tabResult?.ok
                      ? tabResult.uid
                      : undefined,
                  giftCardCode:
                    method === "gift_card" && giftResult?.ok
                      ? giftResult.code
                      : undefined,
                  checkoutId: mixedQrisCheckout?.checkout_id,
                  checkoutNumber: mixedQrisCheckout?.checkout_number,
                  queueNumber: mixedQrisCheckout?.queue_number,
                  xenditQrId: method === "qris" ? qris?.qr_id : undefined,
                  xenditExternalId: method === "qris" ? qris?.reference_id : undefined,
                  paymentMethodCode: selectedCode,
                  paymentMethodName: paymentOptions.find((option) => option.code === selectedCode)
                    ?.title,
                });
              }}
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
          )}
        </DialogFooter>
      </DialogPanel>

      {/* Dialog fokus QRIS (owner 2026-08-16): QR tampil bergaya terpampang
          QRIS Indonesia (logo QRIS+GPN, merchant, NMID) menutupi modal bayar
          sampai pembayaran terkonfirmasi atau kasir memilih metode lain. */}
      {method === "qris" && qris?.qr_string && !qrisUnavailable ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-full w-full max-w-sm flex-col items-center gap-3 overflow-y-auto">
            <QrisCard
              qrString={qris.qr_string}
              merchantName={qris.merchant_name}
              nmid={qris.nmid}
            />
            <div className="w-full max-w-sm rounded-xl bg-white/95 px-4 py-3 text-center shadow-sm">
              <div className="text-2xl font-bold tabular-nums text-gray-900">
                {formatCurrency(qris.amount)}
              </div>
              <p className="mt-1 inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {qrisPaid || submitting
                  ? "Pembayaran diterima, menyelesaikan…"
                  : "Menunggu pembayaran pelanggan…"}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="border-white/40 bg-white/90 hover:bg-white"
              disabled={qrisPaid || submitting}
              onClick={() => setMethod("cash")}
            >
              Pilih metode lain
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
