'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, CheckCircle, Clock, XCircle, CreditCard, Coins, User, Printer,
} from 'lucide-react';
import type { SplitDetail, Customer } from '@/lib/pos-api';
import { getOrderSplits, paySplit } from '@/lib/pos-api';
import { PaymentModal } from './PaymentModal';
import { printThermalReceipt, type ReceiptPayload } from './PrintReceipt';

interface SplitPaymentScreenProps {
  orderId: string;
  orderNumber?: string;
  orderType?: string;
  table?: string | null;
  items?: any[];
  notes?: string;
  total: number;
  taxAmount: number;
  discountAmount: number;
  customerName?: string;
  onBack: () => void;
  onComplete: () => void;
  formatCurrency: (n: number) => string;
  formatArk: (n: number) => string;
}

export function SplitPaymentScreen({
  orderId,
  orderNumber,
  orderType,
  table,
  items,
  notes,
  total,
  taxAmount,
  discountAmount,
  customerName,
  onBack,
  onComplete,
  formatCurrency,
  formatArk,
}: SplitPaymentScreenProps) {
  const [splits, setSplits] = useState<SplitDetail[]>([]);
  const [summary, setSummary] = useState({ total_paid: 0, total_remaining: total, split_count: 0, paid_count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payingSplit, setPayingSplit] = useState<SplitDetail | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [resultPayload, setResultPayload] = useState<ReceiptPayload | null>(null);
  const [paidSplitLabel, setPaidSplitLabel] = useState<string | null>(null);

  const fetchSplits = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await getOrderSplits(orderId);
      if (res.success && res.data) {
        setSplits(res.data.splits || []);
        setSummary({
          total_paid: res.data.total_paid || 0,
          total_remaining: res.data.total_remaining || 0,
          split_count: res.data.split_count || 0,
          paid_count: res.data.paid_count || 0,
        });
      } else {
        setError('Failed to load splits');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    fetchSplits();
  }, [fetchSplits]);

  const handlePay = useCallback(async (payload: {
    method: string;
    amount_paid: number;
    ark_coins_used: number;
  }) => {
    if (!payingSplit) return;
    try {
      const res = await paySplit(orderId, payingSplit.id, {
        payment_method: payload.method,
        amount_paid: payload.amount_paid,
        ark_coins_used: payload.ark_coins_used,
      });

      if (res.success) {
        // show success modal
        const receipt: ReceiptPayload = {
          orderId,
          orderNumber,
          orderType: orderType || 'dine_in',
          table: table ?? null,
          items: items || [],
          notes: notes || '',
          total: payingSplit.total_amount,
          change: res.data?.change || 0,
          paymentMethod: payload.method,
          customerName: payingSplit.customer_id ? undefined : customerName,
          discountAmount: payingSplit.discount_amount,
          taxAmount: payingSplit.tax_amount,
        };
        setPaidSplitLabel(payingSplit.label || `Guest ${payingSplit.split_index}`);
        setResultPayload(receipt);
        setShowPayment(false);
        setPayingSplit(null);
        // refresh list
        await fetchSplits();

        // If all paid, auto complete
        if (res.data?.paid_splits >= res.data?.total_splits) {
          setTimeout(() => onComplete(), 1500);
        }
      } else {
        setError(res.data?.error || 'Payment failed');
      }
    } catch (e: any) {
      setError(e.message || 'Payment failed');
    }
  }, [payingSplit, orderId, orderNumber, orderType, table, items, notes, customerName, fetchSplits, onComplete]);

  const handlePrint = useCallback((label: 'KITCHEN' | 'BAR' | 'CUSTOMER') => {
    if (!resultPayload) return;
    printThermalReceipt(resultPayload, label);
  }, [resultPayload]);

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
          <ArrowLeft className="w-4 h-4 text-gray-600" />
        </button>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Split Payment</h2>
          <p className="text-sm text-gray-500">Order #{orderNumber ? orderNumber.slice(-8).toUpperCase() : orderId.slice(-8).toUpperCase()} · {customerName || 'Walk-in'}</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <p className="text-xs text-gray-500">Bill total</p>
          <p className="text-sm font-bold text-gray-900">{formatCurrency(total)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <p className="text-xs text-gray-500">Paid</p>
          <p className="text-sm font-bold text-green-600">{formatCurrency(summary.total_paid)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <p className="text-xs text-gray-500">Remaining</p>
          <p className="text-sm font-bold text-pink-600">{formatCurrency(summary.total_remaining)}</p>
        </div>
      </div>

      {/* Splits list */}
      <div className="flex-1 overflow-y-auto bg-white border border-gray-200 rounded-xl">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading...</div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-red-600">{error}</div>
        ) : splits.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No splits found.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {splits.map((split) => (
              <div key={split.id} className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-pink-50 text-pink-600 font-bold text-sm flex items-center justify-center flex-shrink-0 border border-pink-200">
                  {split.split_index}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{split.label || `Guest ${split.split_index}`}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {split.status === 'paid' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                        <CheckCircle className="w-3 h-3" /> Paid
                      </span>
                    ) : split.status === 'cancelled' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                        <XCircle className="w-3 h-3" /> Cancelled
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                        <Clock className="w-3 h-3" /> Unpaid
                      </span>
                    )}
                    {split.payment_method && (
                      <span className="text-xs text-gray-500">
                        {split.payment_method === 'ark_coin' ? <><Coins className="w-3 h-3 inline mr-0.5" /> ARK</> : <><CreditCard className="w-3 h-3 inline mr-0.5" /> {split.payment_method?.toUpperCase()}</>}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-gray-900">{formatCurrency(split.total_amount)}</p>
                  {split.status === 'paid' && split.ark_coins_used > 0 && (
                    <p className="text-[10px] text-amber-600">{formatArk(split.ark_coins_used)}</p>
                  )}
                </div>
                {split.status === 'pending' && (
                  <button
                    onClick={() => { setPayingSplit(split); setShowPayment(true); }}
                    className="px-3 py-2 bg-pink-600 text-white text-xs font-semibold rounded-lg hover:bg-pink-700 transition-colors"
                  >
                    Pay
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Payment modal */}
      <PaymentModal
        open={showPayment && !!payingSplit}
        total={payingSplit?.total_amount || 0}
        totalAfterArk={payingSplit?.total_amount || 0}
        selectedCustomer={null}
        onClose={() => { setShowPayment(false); setPayingSplit(null); }}
        onConfirm={({ method, cashReceived, arkToUse }) => {
          handlePay({
            method,
            amount_paid: parseFloat(cashReceived) || payingSplit!.total_amount,
            ark_coins_used: arkToUse,
          });
        }}
        formatCurrency={formatCurrency}
        formatArk={formatArk}
        onTapNFC={() => { /* NFC for split: Phase 2 */ }}
      />

      {/* Success receipt */}
      {resultPayload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm space-y-5 rounded-2xl border border-gray-200/70 bg-white p-6 shadow-xs">
            <div className="space-y-2 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50">
                <CheckCircle className="h-8 w-8 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold text-foreground">
                Split paid successfully
              </h2>
              <p className="text-sm text-muted-foreground">
                {paidSplitLabel || "Guest share"}
                {orderNumber ? ` · ${orderNumber}` : ""}
              </p>
            </div>

            <div className="space-y-2.5 rounded-xl border border-gray-200/70 bg-muted/30 px-4 py-3.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {formatCurrency(resultPayload.total)}
                </span>
              </div>
              {resultPayload.change > 0 && (
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Change</span>
                  <span className="font-semibold tabular-nums text-emerald-600">
                    {formatCurrency(resultPayload.change)}
                  </span>
                </div>
              )}
              {resultPayload.paymentMethod && (
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Method</span>
                  <span className="font-medium capitalize text-foreground">
                    {resultPayload.paymentMethod.replace("_", " ")}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => handlePrint("CUSTOMER")}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200/80 bg-white px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
              >
                <Printer className="h-4 w-4" />
                Print receipt
              </button>
              <button
                type="button"
                onClick={() => {
                  setResultPayload(null);
                  setPaidSplitLabel(null);
                }}
                className="inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
