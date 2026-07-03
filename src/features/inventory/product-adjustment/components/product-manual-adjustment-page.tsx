"use client";

import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DsDateTimePicker } from "@/components/design-system";
import { PurchasingFormHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { toast } from "sonner";

function formatQty(value: number | null | undefined) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

type AdjustLine = {
  key: string;
  product_id: string;
  product_kode: string;
  product_nama: string;
  satuan: string | null;
  qty_system: number;
  qty_actual_input: string;
};

export function ProductManualAdjustmentPage() {
  const [adjustDate, setAdjustDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [lines, setLines] = useState<AdjustLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch("/api/inventory/finished-goods?limit=500")
      .then((res) => res.json())
      .then((json) => {
        const rows = Array.isArray(json.data) ? json.data : [];
        setLines(
          rows.map((row: Record<string, unknown>) => ({
            key: String(row.product_id || row.id),
            product_id: String(row.product_id || row.id),
            product_kode: String(row.product_kode || ""),
            product_nama: String(row.product_nama || ""),
            satuan: (row.satuan_nama as string) || null,
            qty_system: Number(row.qty_available) || 0,
            qty_actual_input: "",
          }))
        );
      })
      .catch(() => toast.error("Failed to load product list"))
      .finally(() => setLoading(false));
  }, []);

  const filteredLines = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (line) =>
        line.product_nama.toLowerCase().includes(q) ||
        line.product_kode.toLowerCase().includes(q)
    );
  }, [lines, itemSearch]);

  const progress = useMemo(() => {
    const filled = lines.filter((line) => line.qty_actual_input !== "").length;
    const variance = lines.filter((line) => {
      if (line.qty_actual_input === "") return false;
      const n = Number(line.qty_actual_input);
      return Number.isFinite(n) && n !== line.qty_system;
    }).length;
    return { filled, variance, total: lines.length };
  }, [lines]);

  const hasItems = lines.length > 0;

  const handleLineChange = (key: string, value: string) => {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, qty_actual_input: value } : line))
    );
  };

  const handleFillSystem = () => {
    setLines((prev) =>
      prev.map((line) => ({
        ...line,
        qty_actual_input: String(line.qty_system),
      }))
    );
  };

  const resolveQty = (line: AdjustLine): number | null => {
    if (line.qty_actual_input === "") return null;
    const n = Number(line.qty_actual_input);
    return Number.isFinite(n) ? n : null;
  };

  const validateInputs = () => {
    const toSave = lines.filter((line) => line.qty_actual_input !== "");
    if (toSave.length === 0) {
      toast.error("Enter new stock for at least one product");
      return false;
    }

    const invalid = lines.find((line) => {
      if (line.qty_actual_input === "") return false;
      const n = Number(line.qty_actual_input);
      return !Number.isFinite(n) || n < 0;
    });
    if (invalid) {
      toast.error("New stock must be a number greater than or equal to zero");
      return false;
    }

    const withVariance = toSave.filter((line) => resolveQty(line) !== line.qty_system);
    if (withVariance.length === 0) {
      toast.error("No stock variance to save");
      return false;
    }

    return true;
  };

  const buildNote = () => {
    const base = notes.trim();
    const dateLabel = adjustDate ? `Adjustment ${adjustDate}` : "Stock adjustment";
    return base ? `${dateLabel}: ${base}` : dateLabel;
  };

  const handleSubmit = async () => {
    if (!validateInputs()) return;

    const toSave = lines.filter((line) => {
      const qty = resolveQty(line);
      return qty !== null && qty !== line.qty_system;
    });

    setSubmitting(true);
    const note = buildNote();
    let saved = 0;
    let failed = 0;

    try {
      for (const line of toSave) {
        const qty = resolveQty(line)!;
        try {
          const res = await fetch("/api/inventory/finished-goods/adjustment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              product_id: line.product_id,
              qty_actual: qty,
              notes: note,
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            throw new Error(json.message || "Failed to adjust stock");
          }
          saved += 1;
          setLines((prev) =>
            prev.map((row) =>
              row.key === line.key ? { ...row, qty_system: qty, qty_actual_input: "" } : row
            )
          );
        } catch {
          failed += 1;
        }
      }

      if (saved > 0 && failed === 0) {
        toast.success(`${saved} product(s) adjusted successfully`);
      } else if (saved > 0) {
        toast.warning(`${saved} line(s) saved, ${failed} failed`);
      } else {
        toast.error("Failed to save stock adjustments");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.inventoryStock}
        title="Product Stock Adjustment"
        description="Manually correct finished product stock quantities"
        actions={
          hasItems ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="purchasing-secondary-button w-full sm:w-auto"
                onClick={handleFillSystem}
                disabled={submitting}
              >
                Fill with System Stock
              </Button>
              <Button
                type="button"
                className="purchasing-main-button w-full sm:w-auto"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Adjustment"
                )}
              </Button>
            </>
          ) : undefined
        }
      />

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="border-b border-gray-200/70 pb-3">
          <CardTitle className="text-base">Adjustment Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="min-w-0 md:col-span-4">
              <DsDateTimePicker
                label="Adjustment Date"
                value={adjustDate}
                onChange={setAdjustDate}
                placeholder="Select adjustment date..."
                dateOnly
                disabled={submitting}
              />
            </div>

            <div className="min-w-0 space-y-1.5 md:col-span-8">
              <Label htmlFor="notes" className="text-xs">
                Notes
              </Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reason for adjustment (optional)..."
                disabled={submitting}
                className="h-9 border-gray-200/80 text-sm"
              />
            </div>
          </div>

          {hasItems && (
            <div className="grid grid-cols-3 gap-3 border-t border-gray-200/70 pt-4">
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-3 py-2">
                <p className="text-xs font-medium text-gray-500">Total Lines</p>
                <p className="text-lg font-bold text-gray-900">{progress.total}</p>
              </div>
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-3 py-2">
                <p className="text-xs font-medium text-gray-500">Filled</p>
                <p className="text-lg font-bold text-amber-600">{progress.filled}</p>
              </div>
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-3 py-2">
                <p className="text-xs font-medium text-gray-500">With Variance</p>
                <p className="text-lg font-bold text-pink-600">{progress.variance}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-gray-200/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Stock Correction</h2>
              <p className="text-sm text-gray-500">
                {loading
                  ? "Loading product list..."
                  : hasItems
                    ? "Enter new stock for products that need correction"
                    : "No active products in this scope"}
              </p>
            </div>
            {hasItems && (
              <div className="relative w-full sm:max-w-xs">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="Search products..."
                  className="h-10 border-gray-200/80 pl-9 text-sm"
                  disabled={submitting}
                />
              </div>
            )}
          </div>

          <div className="overflow-x-auto px-4 pb-4">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Code</th>
                  <th className="px-4 py-3 text-left font-semibold">Product Name</th>
                  <th className="px-4 py-3 text-left font-semibold">Unit</th>
                  <th className="px-4 py-3 text-right font-semibold">System Stock</th>
                  <th className="px-4 py-3 text-right font-semibold">New Stock</th>
                  <th className="px-4 py-3 text-right font-semibold">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-pink-600" />
                      Loading items...
                    </td>
                  </tr>
                ) : filteredLines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                      {hasItems
                        ? "No items match your search"
                        : "No active products found"}
                    </td>
                  </tr>
                ) : (
                  filteredLines.map((line) => {
                    const actual =
                      line.qty_actual_input === "" ? null : Number(line.qty_actual_input);
                    const variance =
                      actual === null || !Number.isFinite(actual)
                        ? null
                        : actual - line.qty_system;

                    return (
                      <tr key={line.key} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">
                          {line.product_kode}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {line.product_nama}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{line.satuan || "—"}</td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          {formatQty(line.qty_system)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={line.qty_actual_input}
                            onChange={(e) => handleLineChange(line.key, e.target.value)}
                            placeholder="0"
                            disabled={submitting}
                            className="ml-auto h-9 w-28 border-gray-200/80 text-right text-sm"
                          />
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-medium ${
                            variance === null
                              ? "text-gray-400"
                              : variance === 0
                                ? "text-gray-600"
                                : variance > 0
                                  ? "text-emerald-600"
                                  : "text-red-600"
                          }`}
                        >
                          {variance === null ? "—" : formatQty(variance)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
