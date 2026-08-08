"use client";

import { Label } from "@/components/ui/label";
import type { ProductOutputType } from "@/types/purchasing";

type ProductOutputTypeFieldProps = {
  value: ProductOutputType;
  onChange: (value: ProductOutputType) => void;
};

export function ProductOutputTypeField({ value, onChange }: ProductOutputTypeFieldProps) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-gray-600">Tipe Item</Label>
      <div className="grid h-10 max-w-md grid-cols-2 rounded-lg border border-gray-200/70 bg-gray-50 p-1">
        <button
          type="button"
          onClick={() => onChange("WIP")}
          className={`rounded-md text-xs font-semibold transition ${
            value === "WIP"
              ? "bg-white text-pink-700 shadow-xs"
              : "text-gray-500 hover:text-gray-800"
          }`}
        >
          WIP
        </button>
        <button
          type="button"
          onClick={() => onChange("FINISHED_GOOD")}
          className={`rounded-md text-xs font-semibold transition ${
            value === "FINISHED_GOOD"
              ? "bg-white text-pink-700 shadow-xs"
              : "text-gray-500 hover:text-gray-800"
          }`}
        >
          Barang Jadi
        </button>
      </div>
      <p className="text-xs text-gray-500">
        {value === "WIP"
          ? "Output produksi default masuk stok WIP dan bisa dipakai sebagai komponen resep (BOM)."
          : "Output produksi default masuk stok barang jadi."}
      </p>
    </div>
  );
}
