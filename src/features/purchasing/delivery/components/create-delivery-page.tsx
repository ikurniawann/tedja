"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { DsDateTimePicker } from "@/components/design-system";
import { toast } from "sonner";
import {
  TruckIcon,
  ArrowLeftIcon,
  SaveIcon,
  Loader2Icon,
  Package,
  Info,
} from "lucide-react";
import { useDeliveryPOOptions, usePOItemsForDelivery } from "../queries";
import { useCreateDelivery } from "../mutations";
import { formatCurrency, formatQuantity } from "../utils";
import type { PurchaseOrderItem } from "@/types/purchasing";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const GUIDELINES = [
  "Select a purchase order that is approved, sent, or partially received.",
  "Purchase orders with a completed delivery can still receive additional shipments.",
  "Purchase orders with an open delivery in progress are hidden from this list.",
  "Delivery note number, shipment date, and estimated arrival date are required.",
  "Initial status will be pending receipt.",
];

export function CreateDeliveryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [formData, setFormData] = useState({
    po_id: "",
    supplier_id: "",
    no_surat_jalan: "",
    kurir: "",
    no_resi: "",
    tanggal_kirim: new Date().toISOString().split("T")[0],
    tanggal_estimasi_tiba: "",
    catatan: "",
  });

  const poOptionsQuery = useDeliveryPOOptions(false);
  const fetchingPOs = poOptionsQuery.isLoading;
  const poList = poOptionsQuery.data ?? [];

  const createMutation = useCreateDelivery();
  const loading = createMutation.isPending;

  useEffect(() => {
    const poId = searchParams.get("po_id");
    if (!poId || fetchingPOs) return;

    const po = poList.find((p) => p.id === poId);
    if (po) {
      setFormData((prev) =>
        prev.po_id ? prev : { ...prev, po_id: poId, supplier_id: po.supplier_id }
      );
      return;
    }

    if (poList.length > 0 || !poOptionsQuery.isLoading) {
      toast.error("This purchase order already has a delivery or is not eligible.");
    }
  }, [searchParams, poList, fetchingPOs, poOptionsQuery.isLoading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.po_id || !formData.no_surat_jalan) {
      toast.error("Purchase order and delivery note number are required.");
      return;
    }

    if (!formData.tanggal_kirim) {
      toast.error("Shipment date is required.");
      return;
    }

    if (!formData.tanggal_estimasi_tiba) {
      toast.error("Estimated arrival date is required.");
      return;
    }

    try {
      const data = await createMutation.mutateAsync(formData);
      toast.success(`Delivery ${data.nomor_resi || ""} created successfully.`);
      router.push(data.id ? `/dashboard/purchasing/delivery/${data.id}` : "/dashboard/purchasing/delivery");
      router.refresh();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to create delivery."));
    }
  }

  const selectedPO = poList.find((po) => po.id === formData.po_id);

  const poItemsQuery = usePOItemsForDelivery(formData.po_id);
  const poItems: PurchaseOrderItem[] = poItemsQuery.data ?? [];
  const fetchingPOItems = poItemsQuery.isLoading;

  const itemsSubtotal = useMemo(
    () => poItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0),
    [poItems]
  );

  const canSubmit =
    Boolean(formData.po_id) &&
    Boolean(formData.no_surat_jalan.trim()) &&
    Boolean(formData.tanggal_kirim) &&
    Boolean(formData.tanggal_estimasi_tiba);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Link href="/dashboard/purchasing/delivery">
            <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
              <ArrowLeftIcon className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Create Delivery</h1>
            <p className="text-sm text-gray-500">
              Record a shipment from the supplier against a purchase order
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TruckIcon className="h-4 w-4" />
                  Delivery Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs">
                    Purchase Order <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={poList.map((po) => ({
                      value: po.id,
                      label: po.nomor_po,
                      description: po.nama_supplier ?? undefined,
                    }))}
                    value={formData.po_id}
                    onChange={(value) => {
                      const po = poList.find((p) => p.id === value);
                      setFormData((prev) => ({
                        ...prev,
                        po_id: value,
                        supplier_id: po?.supplier_id || "",
                      }));
                    }}
                    placeholder={fetchingPOs ? "Loading purchase orders..." : "Select purchase order"}
                    searchPlaceholder="Search purchase order or supplier..."
                    emptyMessage="No eligible purchase orders found"
                    allowClear
                    disabled={fetchingPOs}
                    className="w-full! h-9 text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="no_surat_jalan" className="text-xs">
                      Delivery Note Number <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="no_surat_jalan"
                      placeholder="Example: DN-2025-0001"
                      value={formData.no_surat_jalan}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, no_surat_jalan: e.target.value }))
                      }
                      className="h-9 text-sm"
                    />
                  </div>

                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="no_resi" className="text-xs">
                      Tracking Number
                    </Label>
                    <Input
                      id="no_resi"
                      placeholder="Example: JNE123456789"
                      value={formData.no_resi}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, no_resi: e.target.value }))
                      }
                      className="h-9 text-sm"
                    />
                  </div>
                </div>

                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="kurir" className="text-xs">
                    Courier / Shipping Company
                  </Label>
                  <Input
                    id="kurir"
                    placeholder="Example: JNE, J&T, SiCepat"
                    value={formData.kurir}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, kurir: e.target.value }))
                    }
                    className="h-9 text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <DsDateTimePicker
                    label="Shipment Date"
                    value={formData.tanggal_kirim}
                    onChange={(v) => setFormData((prev) => ({ ...prev, tanggal_kirim: v }))}
                    placeholder="Select shipment date..."
                    dateOnly
                    required
                  />
                  <DsDateTimePicker
                    label="Estimated Arrival Date"
                    value={formData.tanggal_estimasi_tiba}
                    onChange={(v) => setFormData((prev) => ({ ...prev, tanggal_estimasi_tiba: v }))}
                    placeholder="Select estimated arrival date..."
                    dateOnly
                    required
                  />
                </div>

                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="catatan" className="text-xs">
                    Notes
                  </Label>
                  <Textarea
                    id="catatan"
                    placeholder="Add notes if needed..."
                    value={formData.catatan}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, catatan: e.target.value }))
                    }
                    rows={3}
                    className="resize-none text-sm"
                  />
                </div>
              </CardContent>
            </Card>

            {formData.po_id && (
              <Card className="border-gray-200/70 shadow-xs">
                <CardHeader className="border-b border-gray-200/70 pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Package className="h-4 w-4" />
                    Purchase Order Items
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {fetchingPOItems ? (
                    <div className="flex items-center justify-center py-10 text-sm text-gray-500">
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                      Loading purchase order items...
                    </div>
                  ) : poItems.length === 0 ? (
                    <div className="py-10 text-center text-sm text-gray-500">
                      No items found for this purchase order
                    </div>
                  ) : (
                    <div className="overflow-x-auto px-4">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200/70 text-xs uppercase tracking-wide text-gray-500">
                            <th className="py-3 pr-4 text-left font-semibold">Raw Material</th>
                            <th className="px-4 py-3 text-right font-semibold">Quantity</th>
                            <th className="px-4 py-3 text-left font-semibold">Unit</th>
                            <th className="px-4 py-3 text-right font-semibold">Unit Price</th>
                            <th className="py-3 pl-4 text-right font-semibold">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200/70">
                          {poItems.map((item) => (
                            <tr key={item.id} className="hover:bg-gray-50/80">
                              <td className="py-3 pr-4">
                                <div className="font-medium text-gray-900">
                                  {item.raw_material?.nama}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {item.raw_material?.kode}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right text-gray-700">
                                {formatQuantity(item.qty_ordered)}
                              </td>
                              <td className="px-4 py-3 text-gray-700">
                                {item.satuan?.nama ||
                                  item.raw_material?.satuan_besar?.nama ||
                                  item.raw_material?.satuan ||
                                  "-"}
                              </td>
                              <td className="px-4 py-3 text-right text-gray-700">
                                {formatCurrency(item.harga_satuan)}
                              </td>
                              <td className="py-3 pl-4 text-right font-medium text-gray-900">
                                {formatCurrency(item.subtotal)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="xl:col-span-4">
            <Card className="border-gray-200/70 shadow-xs xl:sticky xl:top-6">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="text-base">Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                {selectedPO ? (
                  <dl className="space-y-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-gray-500">Purchase Order</dt>
                      <dd className="text-right font-medium text-gray-900">{selectedPO.nomor_po}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-gray-500">Supplier</dt>
                      <dd className="text-right font-medium text-gray-900">
                        {selectedPO.nama_supplier || "-"}
                      </dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-gray-500">Items</dt>
                      <dd className="text-right font-medium text-gray-900">
                        {fetchingPOItems ? "..." : poItems.length}
                      </dd>
                    </div>
                    {poItems.length > 0 && (
                      <div className="flex items-start justify-between gap-3 border-t border-gray-200/70 pt-3">
                        <dt className="font-medium text-gray-900">Estimated Total</dt>
                        <dd className="text-right font-semibold text-gray-900">
                          {formatCurrency(itemsSubtotal)}
                        </dd>
                      </div>
                    )}
                  </dl>
                ) : (
                  <p className="text-sm text-gray-500">
                    Select a purchase order to preview shipment details.
                  </p>
                )}

                <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
                    <Info className="h-4 w-4 text-pink-600" />
                    Guidelines
                  </div>
                  <ul className="space-y-2 text-xs leading-5 text-gray-600">
                    {GUIDELINES.map((line) => (
                      <li key={line} className="flex gap-2">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-gray-200/70 pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="purchasing-secondary-button w-full sm:w-auto"
            onClick={() => router.push("/dashboard/purchasing/delivery")}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={loading || !canSubmit}
            className="purchasing-main-button w-full sm:w-auto"
          >
            {loading ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <SaveIcon className="mr-2 h-4 w-4" />
                Submit
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
