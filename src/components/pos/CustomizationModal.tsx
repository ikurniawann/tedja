"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sparkles, Utensils } from "lucide-react";
import { PosProductThumbnail } from "@/components/pos/PosProductThumbnail";
import type { Product, ProductVariant } from "@/lib/pos-api";

export interface SelectedCustomization {
  product: Product;
  selectedVariant: string | null;
  selectedModifiers: Record<string, string[]>;
  quantity: number;
  notes: string;
}

interface Props {
  open: boolean;
  product: Product | null;
  value: SelectedCustomization | null;
  onChange: (value: SelectedCustomization | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
  formatCurrency: (v: number) => string;
  formatArk: (v: number) => string;
}

export function CustomizationModal({
  open,
  product,
  value,
  onChange,
  onConfirm,
  onCancel,
  formatCurrency,
  formatArk,
}: Props) {
  if (!product) return null;
  const variants = product.variants || [];
  const modifiers = product.modifiers || [];

  const selectedVariant = variants.find((v) => v.id === value?.selectedVariant);
  const variantAdj = selectedVariant?.price_adjustment || 0;
  let modifierAdj = 0;
  const modifierNames: string[] = [];

  modifiers.forEach((group) => {
    const selectedIds = value?.selectedModifiers?.[group.modifier_group.name] || [];
    selectedIds.forEach((modId) => {
      const mod = group.modifier_group.modifiers.find((m) => m.id === modId);
      if (mod) {
        modifierAdj += mod.price_adjustment || 0;
        modifierNames.push(mod.name);
      }
    });
  });

  const unitPrice = product.base_price + variantAdj + modifierAdj;
  const lineTotal = unitPrice * (value?.quantity || 1);

  return (
    <Dialog open={open} onOpenChange={() => onCancel()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">{product.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="flex gap-4">
            <div className="flex h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-gray-100">
              <PosProductThumbnail src={product.image_url} alt={product.name} iconClassName="h-8 w-8" />
            </div>
            <div className="flex-1">
              <div className="text-lg font-bold text-pink-600">{formatCurrency(product.base_price)}</div>
              <div className="text-sm text-amber-600 font-medium">{formatArk(product.base_price)}</div>
            </div>
          </div>

          {/* Variants */}
          {variants.length > 0 && (
            <div className="space-y-3">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-pink-600" />
                Pilih Varian
              </label>
              <div className="grid grid-cols-2 gap-2">
                {variants.map((variant) => {
                  const selected = value?.selectedVariant === variant.id;
                  const priceText =
                    variant.price_adjustment > 0
                      ? `+${formatCurrency(variant.price_adjustment)}`
                      : variant.price_adjustment < 0
                      ? `${formatCurrency(variant.price_adjustment)}`
                      : "Same price";
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() =>
                        onChange({ ...value!, selectedVariant: variant.id })
                      }
                      className={`p-3 rounded-lg border-2 text-left transition-all ${
                        selected
                          ? "border-pink-600 bg-pink-50"
                          : "border-gray-200 hover:border-pink-300"
                      }`}
                    >
                      <div className="font-medium text-gray-900">{variant.name}</div>
                      <div className="text-xs text-gray-600 mt-1">{priceText}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Modifiers */}
          {modifiers.map((group) => {
            const groupName = group.modifier_group.name;
            const selectedIds = value?.selectedModifiers?.[groupName] || [];
            return (
              <div key={group.modifier_group.id} className="space-y-3">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Utensils className="w-4 h-4 text-pink-600" />
                  {groupName}
                </label>
                <div className="space-y-2">
                  {group.modifier_group.modifiers.map((mod) => {
                    const isSelected = selectedIds.includes(mod.id);
                    const priceText =
                      mod.price_adjustment > 0
                        ? `+${formatCurrency(mod.price_adjustment)}`
                        : mod.price_adjustment < 0
                        ? `${formatCurrency(mod.price_adjustment)}`
                        : "";
                    return (
                      <button
                        key={mod.id}
                        type="button"
                        onClick={() => {
                          const next = { ...(value?.selectedModifiers || {}) };
                          const ids = [...(next[groupName] || [])];
                          if (isSelected) {
                            next[groupName] = ids.filter((id) => id !== mod.id);
                          } else {
                            // obey max_selection if > 0
                            const max = group.modifier_group.max_selection || 1;
                            if (max === 1) {
                              next[groupName] = [mod.id];
                            } else if (ids.length < max) {
                              next[groupName] = [...ids, mod.id];
                            }
                          }
                          onChange({ ...value!, selectedModifiers: next });
                        }}
                        className={`w-full p-3 rounded-lg border-2 text-left transition-all flex items-center justify-between ${
                          isSelected
                            ? "border-pink-600 bg-pink-50"
                            : "border-gray-200 hover:border-pink-300"
                        }`}
                      >
                        <span className="font-medium text-gray-900">{mod.name}</span>
                        {priceText && <span className="text-sm text-amber-600 font-medium">{priceText}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Notes */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700">Catatan Tambahan</label>
            <textarea
              value={value?.notes || ""}
              onChange={(e) => onChange({ ...value!, notes: e.target.value })}
              placeholder="Contoh: Jangan terlalu pedas, kurang manis, dll."
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
            />
          </div>

          {/* Qty + Total */}
          <div className="flex items-center justify-between pt-4 border-t">
            <span className="text-sm font-medium text-gray-700">Jumlah</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() =>
                  onChange({ ...value!, quantity: Math.max(1, (value?.quantity || 1) - 1) })
                }
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200"
              >
                -
              </button>
              <span className="text-lg font-medium w-8 text-center">{value?.quantity || 1}</span>
              <button
                onClick={() => onChange({ ...value!, quantity: (value?.quantity || 1) + 1 })}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200"
              >
                +
              </button>
            </div>
          </div>
          <div className="pt-4 mt-4 border-t border-pink-200">
            <div className="flex justify-between items-end">
              <div>
                <div className="text-lg font-bold text-gray-900">Total</div>
                <div className="text-xs text-gray-600">× {value?.quantity || 1} item</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-pink-600">{formatCurrency(lineTotal)}</div>
                <div className="text-xs text-amber-600 font-medium">{formatArk(lineTotal)}</div>
              </div>
            </div>
          </div>
          <button
            onClick={onConfirm}
            className="w-full py-3 bg-pink-600 text-white rounded-lg font-semibold hover:bg-pink-700 transition-colors"
          >
            Tambah ke Keranjang
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
