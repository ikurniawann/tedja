'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Users, Minus, Plus, AlertCircle, CheckCircle, Split, UtensilsCrossed, Equal, Hash,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { PosCartItem } from '@/hooks/use-pos-cart';

export interface SplitItemMapping {
  order_item_index: number;
  quantity: number;
  product_id: string;
  product_name: string;
  unit_price: number;
}

export interface SplitConfig {
  mode: 'equal' | 'per-item' | 'custom';
  count: number;
  splits: {
    label: string;
    customerId?: string;
    total: number;
    subtotal: number;
    tax_amount: number;
    discount_amount: number;
    items?: SplitItemMapping[];
  }[];
}

interface SplitBillModalProps {
  open: boolean;
  total: number;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  cartItems: PosCartItem[];
  onClose: () => void;
  onConfirm: (config: SplitConfig) => void;
  formatCurrency: (n: number) => string;
}

export function SplitBillModal({
  open, total, subtotal, taxAmount, discountAmount, cartItems,
  onClose, onConfirm, formatCurrency,
}: SplitBillModalProps) {
  const [mode, setMode] = useState<'equal' | 'per-item' | 'custom'>('equal');
  const [count, setCount] = useState(2);
  const [labels, setLabels] = useState<string[]>(['', '']);

  // per-item assignments: itemId -> [qty_split1, qty_split2, ...]
  const [assignments, setAssignments] = useState<Record<string, number[]>>({});

  // custom nominal per split
  const [customNominals, setCustomNominals] = useState<number[]>([0, 0]);

  // Initialize / sync assignments when items or count changes
  useEffect(() => {
    setAssignments((prev) => {
      const next: Record<string, number[]> = {};
      cartItems.forEach((item) => {
        const existing = prev[item.id] || [];
        const arr = [...existing];
        while (arr.length < count) arr.push(0);
        while (arr.length > count) arr.pop();
        const assignedQty = arr.reduce((a, b) => a + b, 0);
        if (assignedQty === 0) {
          arr[0] = item.quantity;
        }
        next[item.id] = arr;
      });
      return next;
    });
    // Keep labels and customNominals in sync with count
    setLabels((prev) => {
      const next = [...prev];
      while (next.length < count) next.push('');
      while (next.length > count) next.pop();
      return next;
    });
    setCustomNominals((prev) => {
      const next = [...prev];
      while (next.length < count) {
        const remainder = total - next.reduce((a, b) => a + b, 0);
        next.push(Math.max(0, Math.floor(remainder)));
      }
      while (next.length > count) next.pop();
      return next;
    });
  }, [cartItems, count, total]);

  // ---- EQUAL MODE calculations ----
  const equalSplits = useMemo(() => {
    if (count <= 0) return [];
    const base = Math.floor(total / count);
    const remainder = total - base * count;
    return Array.from({ length: count }, (_, i) => {
      const isLast = i === count - 1;
      const splitTotal = isLast ? base + remainder : base;
      return {
        label: labels[i] || `Orang ${i + 1}`,
        total: splitTotal,
        subtotal: 0,
        tax: Math.round(taxAmount / count),
        discount: Math.round(discountAmount / count),
      };
    });
  }, [count, total, taxAmount, discountAmount, labels]);

  // ---- PER-ITEM MODE calculations ----
  const perItemSplits = useMemo(() => {
    const rawSubtotals = Array.from({ length: count }, (_, splitIdx) => {
      let s = 0;
      cartItems.forEach((item) => {
        const qty = assignments[item.id]?.[splitIdx] || 0;
        s += qty * item.price;
      });
      return s;
    });

    const rawTotalSubtotal = rawSubtotals.reduce((a, b) => a + b, 0);

    return Array.from({ length: count }, (_, i) => {
      const ratio = rawTotalSubtotal > 0 ? rawSubtotals[i] / rawTotalSubtotal : 0;
      const splitTax = Math.round(taxAmount * ratio);
      const splitDisc = Math.round(discountAmount * ratio);
      const splitTotal = rawSubtotals[i] + splitTax - splitDisc;
      return {
        label: labels[i] || `Orang ${i + 1}`,
        subtotal: rawSubtotals[i],
        tax: splitTax,
        discount: splitDisc,
        total: splitTotal,
      };
    });
  }, [count, cartItems, assignments, taxAmount, discountAmount, labels]);

  // ---- CUSTOM MODE calculations ----
  const customSplits = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const rawTotal = customNominals[i] || 0;
      // Distribute tax/discount proportionally based on nominal vs total
      const ratio = total > 0 ? rawTotal / total : 0;
      const splitTax = Math.round(taxAmount * ratio);
      const splitDisc = Math.round(discountAmount * ratio);
      const splitSubtotal = rawTotal - splitTax + splitDisc;
      return {
        label: labels[i] || `Orang ${i + 1}`,
        total: rawTotal,
        subtotal: splitSubtotal,
        tax: splitTax,
        discount: splitDisc,
      };
    });
  }, [count, customNominals, labels, total, taxAmount, discountAmount]);

  // ---- Unassigned calculation ----
  const unassignedTotal = useMemo(() => {
    if (mode !== 'per-item') return 0;
    let u = 0;
    cartItems.forEach((item) => {
      const assigned = (assignments[item.id] || []).reduce((a, b) => a + b, 0);
      u += Math.max(0, item.quantity - assigned);
    });
    return u;
  }, [mode, cartItems, assignments]);

  // ---- Custom remainder ----
  const customRemainder = useMemo(() => {
    if (mode !== 'custom') return 0;
    const sum = customNominals.reduce((a, b) => a + b, 0);
    return total - sum;
  }, [mode, customNominals, total]);

  // ---- Handlers ----
  const handleDecrease = () => setCount((c) => Math.max(2, c - 1));
  const handleIncrease = () => {
    setCount((c) => c + 1);
    setLabels((prev) => [...prev, '']);
    setCustomNominals((prev) => {
      const sum = prev.reduce((a, b) => a + b, 0);
      return [...prev, Math.max(0, total - sum)];
    });
  };

  const handleLabelChange = (idx: number, val: string) => {
    setLabels((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  };

  const handleQtyChange = (itemId: string, splitIdx: number, delta: number) => {
    setAssignments((prev) => {
      const item = cartItems.find((i) => i.id === itemId);
      if (!item) return prev;
      const arr = [...(prev[itemId] || Array(count).fill(0))];
      const currentAssigned = arr.reduce((a, b) => a + b, 0);
      const available = item.quantity - (currentAssigned - arr[splitIdx]);
      const nextVal = Math.max(0, Math.min(arr[splitIdx] + delta, available));
      if (nextVal === arr[splitIdx]) return prev;
      arr[splitIdx] = nextVal;
      return { ...prev, [itemId]: arr };
    });
  };

  const handleSetQty = (itemId: string, splitIdx: number, val: number) => {
    setAssignments((prev) => {
      const item = cartItems.find((i) => i.id === itemId);
      if (!item) return prev;
      const arr = [...(prev[itemId] || Array(count).fill(0))];
      const currentAssigned = arr.reduce((a, b, idx) => a + (idx === splitIdx ? 0 : b), 0);
      const maxVal = Math.max(0, item.quantity - currentAssigned);
      const nextVal = Math.max(0, Math.min(val, maxVal));
      arr[splitIdx] = nextVal;
      return { ...prev, [itemId]: arr };
    });
  };

  const handleCustomNominalChange = (idx: number, rawVal: string) => {
    const val = parseFloat(rawVal.replace(/[^0-9]/g, '')) || 0;
    setCustomNominals((prev) => {
      const next = [...prev];
      next[idx] = Math.max(0, val);
      return next;
    });
  };

  const handleConfirm = () => {
    if (mode === 'equal') {
      onConfirm({
        mode: 'equal',
        count,
        splits: equalSplits.map((s) => ({
          label: s.label,
          total: s.total,
          subtotal: s.total - s.tax + s.discount,
          tax_amount: s.tax,
          discount_amount: s.discount,
        })),
      });
    } else if (mode === 'custom') {
      onConfirm({
        mode: 'custom',
        count,
        splits: customSplits.map((s) => ({
          label: s.label,
          total: s.total,
          subtotal: s.subtotal,
          tax_amount: s.tax,
          discount_amount: s.discount,
        })),
      });
    } else {
      const splits: SplitConfig['splits'] = perItemSplits.map((s, splitIdx) => {
        const items: SplitItemMapping[] = [];
        cartItems.forEach((item, itemIdx) => {
          const qty = assignments[item.id]?.[splitIdx] || 0;
          if (qty > 0) {
            items.push({
              order_item_index: itemIdx,
              quantity: qty,
              product_id: item.productId,
              product_name: item.name,
              unit_price: item.price,
            });
          }
        });
        return {
          label: s.label,
          subtotal: s.subtotal,
          tax_amount: s.tax,
          discount_amount: s.discount,
          total: s.total,
          items,
        };
      });
      onConfirm({ mode: 'per-item', count, splits });
    }
  };

  const isValid = useMemo(() => {
    if (mode === 'equal') {
      return equalSplits.reduce((sum, s) => sum + s.total, 0) === total;
    }
    if (mode === 'custom') {
      return customRemainder === 0;
    }
    return unassignedTotal === 0;
  }, [mode, equalSplits, total, customRemainder, unassignedTotal]);

  const splitsToRender = mode === 'equal' ? equalSplits : mode === 'custom' ? customSplits : perItemSplits;
  const splitTotalSum = splitsToRender.reduce((sum, s) => sum + s.total, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Split className="w-5 h-5 text-primary" /> Split Bill
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Mode Toggle */}
          <div className="flex p-1 bg-gray-100 rounded-lg">
            <button
              onClick={() => setMode('equal')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${
                mode === 'equal' ? 'bg-white shadow-sm text-primary' : 'text-gray-500'
              }`}
            >
              <Equal className="w-4 h-4" /> Sama Rata
            </button>
            <button
              onClick={() => setMode('custom')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${
                mode === 'custom' ? 'bg-white shadow-sm text-primary' : 'text-gray-500'
              }`}
            >
              <Hash className="w-4 h-4" /> Nominal
            </button>
            <button
              onClick={() => setMode('per-item')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${
                mode === 'per-item' ? 'bg-white shadow-sm text-primary' : 'text-gray-500'
              }`}
            >
              <UtensilsCrossed className="w-4 h-4" /> Per Item
            </button>
          </div>

          {/* Split count */}
          <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5 text-gray-500" />
              <div>
                <p className="text-sm font-medium text-gray-900">Jumlah Orang</p>
                <p className="text-xs text-gray-500">
                  {mode === 'equal'
                    ? 'Bagikan sama rata'
                    : mode === 'custom'
                    ? 'Atur nominal per orang'
                    : 'Atur item per orang'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleDecrease}
                className="w-8 h-8 rounded-full border-2 border-gray-200 flex items-center justify-center hover:bg-gray-100 text-gray-600 disabled:opacity-30"
                disabled={count <= 2}
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="text-lg font-bold text-gray-900 w-6 text-center">{count}</span>
              <button
                onClick={handleIncrease}
                className="w-8 h-8 rounded-full border-2 border-gray-200 flex items-center justify-center hover:bg-gray-100 text-gray-600"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Custom Nominal Inputs */}
          {mode === 'custom' && (
            <div className="space-y-3">
              {Array.from({ length: count }, (_, idx) => (
                <div key={idx} className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                  <div className="w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <Input
                      placeholder={`Nama orang ${idx + 1}`}
                      value={labels[idx] || ''}
                      onChange={(e) => handleLabelChange(idx, e.target.value)}
                      className="h-8 text-sm border-gray-200 bg-white mb-2"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">Nominal</span>
                      <Input
                        type="number"
                        min={0}
                        value={customNominals[idx] || 0}
                        onChange={(e) => handleCustomNominalChange(idx, e.target.value)}
                        className="h-8 text-sm border-gray-200 bg-white flex-1"
                      />
                    </div>
                  </div>
                  <div className="text-right text-sm font-bold text-gray-900">
                    {formatCurrency(customNominals[idx] || 0)}
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between px-1 text-sm">
                <span className="text-gray-500">Sisa</span>
                <span className={`font-bold ${customRemainder !== 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {formatCurrency(Math.abs(customRemainder))}
                </span>
              </div>
              {customRemainder !== 0 && (
                <div className="flex items-center gap-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-lg">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  Total nominal ({formatCurrency(splitTotalSum)}) harus sama dengan total order ({formatCurrency(total)}).
                </div>
              )}
            </div>
          )}

          {/* Per-Item Assignment UI */}
          {mode === 'per-item' && (
            <div className="space-y-3">
              {cartItems.length === 0 ? (
                <div className="text-center text-sm text-gray-400 py-4">Tidak ada item di cart.</div>
              ) : (
                <div className="space-y-2">
                  {/* Header row with split labels */}
                  <div className="grid gap-2 text-[10px] text-gray-500 text-center items-end"
                    style={{ gridTemplateColumns: `1fr repeat(${count + 1}, minmax(48px, 1fr))` }}
                  >
                    <div className="text-left pl-1">Item / Harga</div>
                    {Array.from({ length: count }, (_, i) => (
                      <div key={i} className="leading-tight">{labels[i] || `S${i + 1}`}</div>
                    ))}
                    <div>Sisa</div>
                  </div>

                  {cartItems.map((item) => {
                    const arr = assignments[item.id] || Array(count).fill(0);
                    const assigned = arr.reduce((a, b) => a + b, 0);
                    const remaining = Math.max(0, item.quantity - assigned);
                    return (
                      <div key={item.id} className="bg-gray-50 rounded-lg p-2 space-y-1.5">
                        <div className="flex justify-between items-center text-xs px-1">
                          <span className="font-medium text-gray-900 truncate">{item.name}</span>
                          <span className="text-gray-500">{formatCurrency(item.price)} × {item.quantity}</span>
                        </div>
                        <div className="grid gap-2 items-center"
                          style={{ gridTemplateColumns: `1fr repeat(${count + 1}, minmax(48px, 1fr))` }}
                        >
                          <div className="text-[10px] text-gray-400 pl-1">Sub: {formatCurrency(item.price * item.quantity)}</div>
                          {Array.from({ length: count }, (_, splitIdx) => (
                            <div key={splitIdx} className="flex items-center justify-center">
                              <div className="flex items-center bg-white border border-gray-200 rounded-md overflow-hidden h-7">
                                <button
                                  onClick={() => handleQtyChange(item.id, splitIdx, -1)}
                                  className="px-1.5 text-gray-500 hover:bg-gray-100 text-xs"
                                >−</button>
                                <input
                                  type="number"
                                  min={0}
                                  max={item.quantity}
                                  value={arr[splitIdx] || 0}
                                  onChange={(e) => handleSetQty(item.id, splitIdx, parseInt(e.target.value) || 0)}
                                  className="w-6 text-center text-xs font-semibold text-gray-900 border-0 p-0 focus:ring-0"
                                />
                                <button
                                  onClick={() => handleQtyChange(item.id, splitIdx, 1)}
                                  className="px-1.5 text-gray-500 hover:bg-gray-100 text-xs"
                                >+</button>
                              </div>
                            </div>
                          ))}
                          <div className={`text-center text-xs font-bold ${remaining > 0 ? 'text-red-500' : 'text-green-600'}`}>
                            {remaining}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {unassignedTotal > 0 && (
                <div className="flex items-center gap-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-lg">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  Ada {unassignedTotal} item yang belum di-assign.
                </div>
              )}
            </div>
          )}

          {/* Split labels & Totals (Equal or Per-Item) */}
          {mode !== 'custom' && (
            <div className="space-y-2">
              {Array.from({ length: count }, (_, idx) => {
                const s = splitsToRender[idx];
                return (
                  <div key={idx} className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                    <div className="w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1">
                      <Input
                        placeholder={`Nama orang ${idx + 1}`}
                        value={labels[idx] || ''}
                        onChange={(e) => handleLabelChange(idx, e.target.value)}
                        className="h-8 text-sm border-gray-200 bg-white"
                      />
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-primary">{formatCurrency(s.total)}</p>
                      <p className="text-[10px] text-gray-500">
                        {mode === 'per-item' ? (
                          <>Sub {formatCurrency(s.subtotal)} · Tax {formatCurrency(s.tax)} · Disc {formatCurrency(s.discount)}</>
                        ) : (
                          <>Tax {formatCurrency(s.tax)} · Disc {formatCurrency(s.discount)}</>
                        )}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Total check */}
          <div className="flex items-center justify-between text-sm px-1">
            <span className="text-gray-500">Total Split</span>
            <span className="font-bold text-gray-900">{formatCurrency(splitTotalSum)}</span>
          </div>

          {mode === 'equal' && splitTotalSum !== total && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-lg">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              Total split ({formatCurrency(splitTotalSum)}) ≠ Order ({formatCurrency(total)}).
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Batal</Button>
            <Button
              className="flex-1 bg-primary hover:bg-primary/90"
              onClick={handleConfirm}
              disabled={!isValid}
            >
              <CheckCircle className="w-4 h-4 mr-2" /> Konfirmasi Split
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
