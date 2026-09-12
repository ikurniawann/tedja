"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import {
  formatRupiah,
  resolveVariant,
  unitPriceFor,
  type TableOrderProduct,
  type TableOrderVariant,
} from "@/lib/table-order/menu";
import { MAX_LINE_QTY } from "@/lib/table-order/pricing";
import { BottomSheet } from "./sheet";

type AddHandler = (
  product: TableOrderProduct,
  variant: TableOrderVariant | null,
  quantity: number
) => void;

export function VariantSheet({
  product,
  onClose,
  onAdd,
}: {
  product: TableOrderProduct | null;
  onClose: () => void;
  onAdd: AddHandler;
}) {
  if (!product) return null;
  // key=product.id → state pilihan/qty otomatis mulai dari awal utk produk lain.
  return <VariantSheetBody key={product.id} product={product} onClose={onClose} onAdd={onAdd} />;
}

function VariantSheetBody({
  product,
  onClose,
  onAdd,
}: {
  product: TableOrderProduct;
  onClose: () => void;
  onAdd: AddHandler;
}) {
  const [variantId, setVariantId] = useState<string | null>(product.variants[0]?.id ?? null);
  const [quantity, setQuantity] = useState(1);
  const variant = resolveVariant(product, variantId);
  const unitPrice = unitPriceFor(product, variant);

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={product.name}
      footer={
        <div className="flex items-center gap-3">
          <div className="inline-flex h-11 items-center rounded-full border border-gray-200">
            <button
              type="button"
              onClick={() => setQuantity((qty) => Math.max(1, qty - 1))}
              className="flex size-10 items-center justify-center text-gray-700"
              aria-label="Kurangi jumlah"
            >
              <Minus className="size-4" />
            </button>
            <span className="min-w-8 text-center text-sm font-bold">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((qty) => Math.min(MAX_LINE_QTY, qty + 1))}
              className="flex size-10 items-center justify-center text-gray-700"
              aria-label="Tambah jumlah"
            >
              <Plus className="size-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => onAdd(product, variant, quantity)}
            className="flex h-11 flex-1 items-center justify-between rounded-xl bg-primary px-4 text-sm font-bold text-white shadow-sm transition active:scale-[0.99]"
          >
            <span>Tambah ke keranjang</span>
            <span>{formatRupiah(unitPrice * quantity)}</span>
          </button>
        </div>
      }
    >
      {product.image && (
        <img src={product.image} alt={product.name} className="h-44 w-full rounded-2xl object-cover" />
      )}
      {product.description && (
        <p className="mt-3 text-sm leading-relaxed text-gray-600">{product.description}</p>
      )}

      {product.variants.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-gray-900">Pilih varian</div>
            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
              Wajib pilih 1
            </span>
          </div>
          <div className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {product.variants.map((option) => {
              const selected = option.id === variant?.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setVariantId(option.id)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="flex items-center gap-3">
                    <span
                      className={`flex size-5 items-center justify-center rounded-full border-2 ${
                        selected ? "border-primary bg-primary text-white" : "border-gray-300"
                      }`}
                    >
                      {selected && <Check className="size-3" />}
                    </span>
                    <span className="text-sm font-medium text-gray-900">{option.name}</span>
                  </span>
                  <span className="text-sm text-gray-600">
                    {option.priceAdjustment > 0 ? `+${formatRupiah(option.priceAdjustment)}` : "Gratis"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
