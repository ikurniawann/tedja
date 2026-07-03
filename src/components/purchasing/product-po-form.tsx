"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Package, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { DsDateTimePicker } from "@/components/design-system";
import { NumericInput } from "@/components/ui/numeric-input";
import { formatAmount } from "@/lib/purchasing/utils";
import { toast } from "sonner";
import type {
  ApprovedProductPRForPO,
  ProductPOFormInput,
  ProductPOFormProduct,
  ProductPOFormVendor,
} from "@/features/purchasing/product-po/types";

type POItemRow = ProductPOFormInput["items"][number] & {
  product_name?: string;
  unit_name?: string;
};

interface ProductPOFormProps {
  vendors: ProductPOFormVendor[];
  products: ProductPOFormProduct[];
  units: { id: string; nama: string }[];
  approvedPRs?: ApprovedProductPRForPO[];
  initialPRId?: string;
  onSubmit: (data: ProductPOFormInput) => Promise<void>;
  isLoading?: boolean;
  cancelHref: string;
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

export function ProductPOForm({
  vendors,
  products,
  units,
  approvedPRs = [],
  initialPRId,
  onSubmit,
  isLoading,
  cancelHref,
}: ProductPOFormProps) {
  const router = useRouter();
  const [vendorId, setVendorId] = useState("");
  const [prId, setPrId] = useState(initialPRId || "");
  const [tanggalPo, setTanggalPo] = useState(todayISO());
  const [tanggalKirim, setTanggalKirim] = useState("");
  const [catatan, setCatatan] = useState("");
  const [alamat, setAlamat] = useState("");
  const [diskonPersen, setDiskonPersen] = useState(0);
  const [diskonNominal, setDiskonNominal] = useState(0);
  const [ppnPersen, setPpnPersen] = useState(11);
  const [items, setItems] = useState<POItemRow[]>([
    { product_id: "", qty_ordered: 1, harga_satuan: 0, notes: "" },
  ]);

  const selectedPR = approvedPRs.find((pr) => pr.id === prId);

  useEffect(() => {
    if (!selectedPR?.items?.length) return;
    setItems(
      selectedPR.items.map((item) => {
        const product = products.find((p) => p.id === item.product_id);
        return {
          product_id: item.product_id || "",
          pr_item_id: item.id,
          satuan_id: item.satuan_id || product?.satuan_id || undefined,
          qty_ordered: Number(item.qty || 1),
          harga_satuan: Number(item.estimated_price || product?.harga_modal || 0),
          notes: item.description || product?.nama || "",
          product_name: product?.nama || item.description,
          unit_name: product?.satuan_nama || item.unit,
        };
      })
    );
  }, [selectedPR, products]);

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + (item.qty_ordered || 0) * (item.harga_satuan || 0), 0),
    [items]
  );
  const discount = diskonPersen > 0 ? (subtotal * diskonPersen) / 100 : diskonNominal;
  const taxable = Math.max(0, subtotal - discount);
  const ppn = (taxable * ppnPersen) / 100;
  const total = taxable + ppn;

  async function applyPrice(index: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    let price = Number(product.harga_modal || 0);
    if (vendorId) {
      try {
        const res = await fetch(
          `/api/purchasing/vendor-price-list?vendor_id=${vendorId}&product_id=${productId}&status=active&limit=5`
        );
        const json = await res.json();
        const rows = (json.data || []) as Array<{ harga?: number; is_preferred?: boolean }>;
        const best = rows
          .filter((row) => Number(row.harga || 0) > 0)
          .sort((a, b) => (a.is_preferred === b.is_preferred ? 0 : a.is_preferred ? -1 : 1))[0];
        if (best?.harga) price = Number(best.harga);
      } catch {
        /* keep fallback */
      }
    }

    setItems((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              product_id: productId,
              satuan_id: product.satuan_id || undefined,
              product_name: product.nama,
              unit_name: product.satuan_nama || units.find((u) => u.id === product.satuan_id)?.nama,
              harga_satuan: price,
              notes: product.nama,
            }
          : row
      )
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vendorId) {
      toast.error("Vendor is required.");
      return;
    }
    if (items.some((item) => !item.product_id)) {
      toast.error("All line items must have a product.");
      return;
    }

    await onSubmit({
      vendor_id: vendorId,
      pr_id: prId || undefined,
      tanggal_po: tanggalPo,
      tanggal_kirim_estimasi: tanggalKirim || undefined,
      catatan: catatan.trim() || undefined,
      alamat_pengiriman: alamat.trim() || undefined,
      diskon_persen: diskonPersen,
      diskon_nominal: diskonNominal,
      ppn_persen: ppnPersen,
      items: items.map((item) => ({
        product_id: item.product_id,
        pr_item_id: item.pr_item_id,
        satuan_id: item.satuan_id,
        qty_ordered: Number(item.qty_ordered),
        harga_satuan: Number(item.harga_satuan),
        notes: item.notes,
      })),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Order Information
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 pt-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Vendor <span className="text-red-500">*</span>
                </Label>
                <Combobox
                  options={vendors.map((v) => ({ value: v.id, label: v.name, description: v.code }))}
                  value={vendorId}
                  onChange={setVendorId}
                  placeholder="Select vendor..."
                  searchPlaceholder="Search vendor..."
                  emptyMessage="No vendor found"
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Source Purchase Request</Label>
                <Combobox
                  options={approvedPRs.map((pr) => ({
                    value: pr.id,
                    label: pr.pr_number,
                    description: pr.department_name || undefined,
                  }))}
                  value={prId}
                  onChange={setPrId}
                  placeholder="Optional — select approved PR..."
                  searchPlaceholder="Search PR..."
                  emptyMessage="No approved PR found"
                  allowClear
                  className="h-9 text-sm"
                />
              </div>
              <DsDateTimePicker label="PO Date" value={tanggalPo} onChange={setTanggalPo} dateOnly />
              <DsDateTimePicker
                label="Estimated Delivery"
                value={tanggalKirim}
                onChange={setTanggalKirim}
                dateOnly
              />
              <div className="md:col-span-2 space-y-1.5">
                <Label className="text-xs">Delivery Address</Label>
                <Textarea value={alamat} onChange={(e) => setAlamat(e.target.value)} rows={2} className="text-sm" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4" />
                Order Items
              </CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setItems((prev) => [...prev, { product_id: "", qty_ordered: 1, harga_satuan: 0, notes: "" }])
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add Item
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {items.map((item, index) => (
                <div key={index} className="rounded-xl border border-gray-200/70 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-medium">Item {index + 1}</p>
                    {items.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-red-500"
                        onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-4 md:grid-cols-12">
                    <div className="md:col-span-4 space-y-1.5">
                      <Label className="text-xs">Product</Label>
                      <Combobox
                        options={products.map((p) => ({ value: p.id, label: p.nama, description: p.kode }))}
                        value={item.product_id}
                        onChange={(value) => applyPrice(index, value)}
                        placeholder="Select product..."
                        searchPlaceholder="Search..."
                        emptyMessage="No product found"
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="md:col-span-2 space-y-1.5">
                      <Label className="text-xs">Qty</Label>
                      <NumericInput
                        value={item.qty_ordered}
                        onValueChange={(value) =>
                          setItems((prev) =>
                            prev.map((row, i) => (i === index ? { ...row, qty_ordered: value || 1 } : row))
                          )
                        }
                        decimalScale={4}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="md:col-span-2 space-y-1.5">
                      <Label className="text-xs">Unit</Label>
                      <div className="flex h-9 items-center rounded-lg border border-gray-200/80 bg-gray-50 px-2.5 text-sm">
                        {item.unit_name || "-"}
                      </div>
                    </div>
                    <div className="md:col-span-2 space-y-1.5">
                      <Label className="text-xs">Unit Price</Label>
                      <NumericInput
                        value={item.harga_satuan}
                        onValueChange={(value) =>
                          setItems((prev) =>
                            prev.map((row, i) => (i === index ? { ...row, harga_satuan: value } : row))
                          )
                        }
                        decimalScale={0}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="md:col-span-2 rounded-lg bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">Subtotal</p>
                      <p className="text-sm font-semibold">
                        {formatAmount((item.qty_ordered || 0) * (item.harga_satuan || 0))}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="xl:col-span-4">
          <Card className="border-gray-200/70 shadow-xs xl:sticky xl:top-6">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Discount %</Label>
                  <NumericInput value={diskonPersen} onValueChange={setDiskonPersen} decimalScale={2} className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">VAT %</Label>
                  <NumericInput value={ppnPersen} onValueChange={setPpnPersen} decimalScale={2} className="h-9 text-sm" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Notes</Label>
                <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={3} className="text-sm" />
              </div>
              <div className="space-y-2 rounded-xl border border-gray-200/70 bg-gray-50/70 p-4 text-sm">
                <div className="flex justify-between"><span>Subtotal</span><span>{formatAmount(subtotal)}</span></div>
                <div className="flex justify-between"><span>Discount</span><span>{formatAmount(discount)}</span></div>
                <div className="flex justify-between"><span>VAT</span><span>{formatAmount(ppn)}</span></div>
                <div className="flex justify-between border-t border-gray-200/70 pt-2 font-semibold">
                  <span>Total</span><span>{formatAmount(total)}</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Button type="button" variant="outline" onClick={() => router.push(cancelHref)} disabled={isLoading}>
                  Cancel
                </Button>
                <Button type="submit" className="purchasing-main-button" disabled={isLoading}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Purchase Order
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}
