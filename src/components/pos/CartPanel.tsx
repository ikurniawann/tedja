'use client';

import { Minus, Plus, Trash2, ShoppingBag, Utensils, Truck, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PosCartItem } from '@/hooks/use-pos-cart';
import { HelpHint } from '@/components/ui/help-hint';

interface CartPanelProps {
  cart: PosCartItem[];
  orderType: 'dine_in' | 'takeaway' | 'delivery' | 'self_order';
  selectedTable: string | null;
  subtotal: number;
  discountAmount: number;
  selectedCustomer: { discount?: number; name?: string } | null;
  includeTax: boolean;
  tax: number;
  /** Label for optional tax toggle; null = tax not optional / hide toggle */
  taxToggleLabel?: string | null;
  /** Non-tax charge lines from billing breakdown (service / fee / rounding) */
  otherChargeLines?: Array<{ code: string; name: string; amount: number }>;
  arkToUseCapped: number;
  paymentMethod: string;
  totalAfterArk: number;
  total: number;
  formatCurrency: (value: number) => string;
  formatArk: (value: number) => string;
  setIncludeTax: (val: boolean) => void;
  setShowPaymentModal: () => void;
  onOpenBill: () => void;
  isSavingBill: boolean;
  canTransact?: boolean;
  onOpenShift?: () => void;
  updateQuantity: (id: string, delta: number) => void;
  removeFromCart: (id: string) => void;
  /** EPIC-032 C2 — kode promo kasir (opsional; tanpa props = tanpa UI promo) */
  membershipDiscountAmount?: number;
  promoApplied?: { code: string; discount: number } | null;
  promoDiscount?: number;
  promoInput?: string;
  promoBusy?: boolean;
  promoError?: string | null;
  promoDisabled?: boolean;
  onPromoInputChange?: (value: string) => void;
  onApplyPromo?: () => void;
  onClearPromo?: () => void;
}

export function CartPanel({
  cart,
  orderType,
  selectedTable,
  subtotal,
  discountAmount,
  selectedCustomer,
  includeTax,
  tax,
  taxToggleLabel = 'Tax (10%)',
  otherChargeLines = [],
  arkToUseCapped,
  paymentMethod,
  totalAfterArk,
  total,
  formatCurrency,
  formatArk,
  setIncludeTax,
  setShowPaymentModal,
  onOpenBill,
  isSavingBill,
  canTransact = true,
  onOpenShift,
  updateQuantity,
  removeFromCart,
  membershipDiscountAmount,
  promoApplied = null,
  promoDiscount = 0,
  promoInput = '',
  promoBusy = false,
  promoError = null,
  promoDisabled = false,
  onPromoInputChange,
  onApplyPromo,
  onClearPromo,
}: CartPanelProps) {
  const membershipAmt = membershipDiscountAmount ?? discountAmount;
  const showPromoUi = typeof onApplyPromo === 'function';
  return (
    <div className="flex w-full max-h-[60vh] flex-col rounded-xl border border-gray-200/70 bg-white shadow-xs lg:max-h-none lg:w-96">
      <div className="border-b border-gray-200/70 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Order</h2>
          <span className="text-sm text-gray-500">{cart.reduce((sum, i) => sum + i.quantity, 0)} items</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {orderType === 'dine_in' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              <Utensils className="h-3 w-3" /> Dine-in
            </span>
          )}
          {orderType === 'takeaway' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
              <ShoppingBag className="h-3 w-3" /> Takeaway
            </span>
          )}
          {orderType === 'delivery' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700">
              <Truck className="h-3 w-3" /> Delivery
            </span>
          )}
          {orderType === 'dine_in' && (
            <span
              className={
                selectedTable
                  ? 'inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary'
                  : 'inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600'
              }
            >
              {selectedTable ? `Table ${selectedTable}` : 'Without Table'}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {cart.length === 0 ? (
          <div className="py-8 text-center text-gray-400">
            <ShoppingBag className="mx-auto mb-2 h-12 w-12 opacity-50" />
            <p className="text-sm">No items yet</p>
          </div>
        ) : (
          cart.map((item) => (
            <div key={item.id} className="flex gap-3 rounded-xl bg-gray-50/80 p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-900">{item.name}</div>

                {(item.variantName || (item.modifierNames && item.modifierNames.length > 0)) && (
                  <div className="mb-1 mt-1 flex flex-wrap gap-1">
                    {item.variantName && (
                      <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                        {item.variantName}
                      </span>
                    )}
                    {item.modifierNames?.map((mod, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700"
                      >
                        {mod}
                      </span>
                    ))}
                  </div>
                )}

                {item.notes && <div className="mt-1 text-xs italic text-gray-500">{item.notes}</div>}

                <div className="text-xs text-gray-500">{formatCurrency(item.price)}</div>
                <div className="text-xs font-medium text-amber-600">{formatArk(item.price)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateQuantity(item.id, -1)}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200/80 bg-white hover:bg-gray-50"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                <button
                  type="button"
                  onClick={() => updateQuantity(item.id, 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200/80 bg-white hover:bg-gray-50"
                >
                  <Plus className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => removeFromCart(item.id)}
                  className="ml-1 text-gray-400 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2 border-t border-gray-200/70 bg-gray-50/50 p-4">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Subtotal</span>
          <div className="text-right">
            <div className="font-medium text-gray-900">{formatCurrency(subtotal)}</div>
            <div className="text-xs font-medium text-amber-600">{formatArk(subtotal)}</div>
          </div>
        </div>
        {membershipAmt > 0 && selectedCustomer && (
          <div className="flex justify-between text-sm">
            <span className="text-green-600">Discount ({selectedCustomer.discount}%)</span>
            <span className="font-medium text-green-600">-{formatCurrency(membershipAmt)}</span>
          </div>
        )}
        {promoApplied && promoDiscount > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-green-600">
              Promo {promoApplied.code}
              {onClearPromo && (
                <button
                  type="button"
                  onClick={onClearPromo}
                  className="ml-2 text-xs text-red-500 underline"
                >
                  hapus
                </button>
              )}
            </span>
            <span className="font-medium text-green-600">-{formatCurrency(promoDiscount)}</span>
          </div>
        )}
        {showPromoUi && !promoApplied && (
          <div>
            <div className="flex gap-2">
              <input
                type="text"
                value={promoInput}
                onChange={(e) => onPromoInputChange?.(e.target.value)}
                placeholder={promoDisabled ? 'Promo butuh koneksi' : 'Kode promo'}
                disabled={promoDisabled}
                className="h-8 w-full rounded-lg border border-gray-300 px-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none disabled:bg-gray-50"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 px-3"
                disabled={promoDisabled || promoBusy || promoInput.trim().length < 3}
                onClick={onApplyPromo}
              >
                {promoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Pakai'}
              </Button>
            </div>
            {promoError && (
              <p className="mt-1 text-xs text-red-600">{promoError}</p>
            )}
          </div>
        )}
        {taxToggleLabel ? (
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIncludeTax(!includeTax)}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
              >
                <div
                  className={`flex h-4 w-4 items-center justify-center rounded border ${
                    includeTax ? 'border-primary bg-primary' : 'border-gray-300'
                  }`}
                >
                  {includeTax && <Check className="h-3 w-3 text-white" />}
                </div>
                <span>{taxToggleLabel}</span>
              </button>
              <HelpHint helpId="pos.tax-toggle" role="default" />
            </div>
            <div className="text-right">
              <div className="font-medium text-gray-900">{formatCurrency(tax)}</div>
              <div className="text-xs font-medium text-amber-600">{formatArk(tax)}</div>
            </div>
          </div>
        ) : tax > 0 ? (
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Tax</span>
            <div className="text-right">
              <div className="font-medium text-gray-900">{formatCurrency(tax)}</div>
              <div className="text-xs font-medium text-amber-600">{formatArk(tax)}</div>
            </div>
          </div>
        ) : null}
        {otherChargeLines.map((line) => (
          <div key={line.code} className="flex justify-between text-sm">
            <span className="text-gray-600">{line.name}</span>
            <div className="text-right">
              <div className="font-medium text-gray-900">
                {line.amount < 0 ? '-' : ''}
                {formatCurrency(Math.abs(line.amount))}
              </div>
            </div>
          </div>
        ))}
        {paymentMethod === 'ark_coin' && arkToUseCapped > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-amber-600">ARK Coin</span>
            <span className="font-medium text-amber-600">-{formatArk(arkToUseCapped)}</span>
          </div>
        )}
        {paymentMethod === 'ark_coin' ? (
          <div className="border-t border-gray-200/70 pt-3 text-center">
            <div className="mb-1 text-lg font-bold text-gray-900">Total Payment</div>
            <div className="text-4xl font-bold text-amber-600">{formatArk(totalAfterArk)}</div>
            <div className="mt-1 text-xs text-gray-500">≈ {formatCurrency(totalAfterArk)}</div>
          </div>
        ) : (
          <div className="flex items-end justify-between border-t border-gray-200/70 pt-3">
            <div>
              <div className="text-lg font-bold text-gray-900">Total</div>
              <div className="text-xs font-medium text-amber-600">{formatArk(totalAfterArk)}</div>
            </div>
            <div className="text-2xl font-bold text-primary">{formatCurrency(totalAfterArk)}</div>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-gray-200/70 p-4">
        {!canTransact && (
          <div className="rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-800">
            Open a shift to pay or save orders.{' '}
            {onOpenShift && (
              <button
                type="button"
                onClick={onOpenShift}
                className="font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700"
              >
                Open shift
              </button>
            )}
          </div>
        )}
        <Button
          type="button"
          onClick={setShowPaymentModal}
          disabled={cart.length === 0 || !canTransact}
          className="h-11 w-full bg-primary font-semibold hover:bg-primary/90"
        >
          Pay {formatCurrency(total)}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onOpenBill}
          disabled={cart.length === 0 || isSavingBill || !canTransact}
          className="h-10 w-full border-amber-200/80 font-semibold text-amber-700 hover:bg-amber-50/80"
        >
          {isSavingBill ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Order'
          )}
        </Button>
      </div>
    </div>
  );
}
