"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { NumericInput } from "@/components/ui/numeric-input";
import { DsDateTimePicker } from "@/components/design-system";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/modules/purchasing/components/page/purchasing-page-header";
import { getReturnsModuleConfig } from "../returns-module";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { useReturnFormData, useReturnGrnOptions } from "../queries";
import { useCreateReturn } from "../mutations";
import { ReturnReasonType, ReturnableItem } from "@/types/purchasing";
import { formatAmount } from "@/lib/purchasing/utils";
import {
  AlertCircle,
  ClipboardList,
  Info,
  Loader2,
  Package,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

const RETURN_REASON_OPTIONS: { value: ReturnReasonType; label: string }[] = [
  { value: "damaged", label: "Damaged Goods" },
  { value: "wrong_item", label: "Wrong Item" },
  { value: "expired", label: "Expired" },
  { value: "overstock", label: "Overstock" },
  { value: "specification_mismatch", label: "Specification Mismatch" },
  { value: "other", label: "Other" },
];

const GUIDELINES = [
  "Only goods receipts that have completed quality control can be returned.",
  "Return quantity cannot exceed the QC-posted quantity minus prior returns.",
  "Submitted returns require purchasing manager approval before stock is deducted.",
];

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatQty(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

interface ReturnItem extends ReturnableItem {
  selected: boolean;
  qty_return: number;
  condition_notes: string;
}

export function NewReturnPage({
  moduleType = "raw_material",
}: {
  moduleType?: PurchasingModuleType;
}) {
  const config = getReturnsModuleConfig(moduleType);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialGrnId = searchParams.get("grn_id") || "";

  const [selectedGrnId, setSelectedGrnId] = useState(initialGrnId);
  const [returnableItems, setReturnableItems] = useState<ReturnItem[]>([]);
  const [formData, setFormData] = useState({
    grn_id: initialGrnId,
    supplier_id: "",
    vendor_id: "",
    return_date: new Date().toISOString().split("T")[0],
    reason_type: "" as ReturnReasonType | "",
    reason_notes: "",
    notes: "",
  });

  const grnOptionsQuery = useReturnGrnOptions(moduleType);
  const grnOptions = grnOptionsQuery.data ?? [];
  const formDataQuery = useReturnFormData(selectedGrnId || null);
  const loadingGrnOptions = grnOptionsQuery.isLoading;
  const loadingItems = Boolean(selectedGrnId) && formDataQuery.isLoading;

  const createMutation = useCreateReturn();
  const isSubmitting = createMutation.isPending;

  const selectedGrn = grnOptions.find((grn) => grn.id === selectedGrnId);

  useEffect(() => {
    if (grnOptionsQuery.isError) {
      toast.error("Failed to load goods receipt options");
    }
  }, [grnOptionsQuery.isError]);

  useEffect(() => {
    if (formDataQuery.isError) {
      console.error("Error loading return items:", formDataQuery.error);
      toast.error("Failed to load returnable items");
    }
  }, [formDataQuery.isError, formDataQuery.error]);

  useEffect(() => {
    if (initialGrnId && initialGrnId !== selectedGrnId) {
      setSelectedGrnId(initialGrnId);
    }
  }, [initialGrnId, selectedGrnId]);

  useEffect(() => {
    const itemsData = formDataQuery.data?.returnableItems;
    if (!selectedGrnId) {
      setReturnableItems([]);
      return;
    }

    if (!itemsData) return;

    setReturnableItems(
      itemsData.map((item: ReturnableItem) => ({
        ...item,
        selected: false,
        qty_return: 0,
        condition_notes: "",
      }))
    );

    if (itemsData.length > 0) {
      setFormData((prev) => ({
        ...prev,
        grn_id: itemsData[0].grn_id,
        supplier_id: config.isProduct ? "" : itemsData[0].supplier_id || "",
        vendor_id: config.isProduct ? itemsData[0].vendor_id || "" : "",
      }));
    } else if (selectedGrn) {
      setFormData((prev) => ({
        ...prev,
        grn_id: selectedGrn.id,
        supplier_id: config.isProduct ? "" : selectedGrn.supplier_id || "",
        vendor_id: config.isProduct ? selectedGrn.vendor_id || "" : "",
      }));
    }
  }, [formDataQuery.data, selectedGrnId, selectedGrn, config.isProduct]);

  const handleGrnChange = (grnId: string) => {
    setSelectedGrnId(grnId);
    setReturnableItems([]);
    setFormData((prev) => ({
      ...prev,
      grn_id: grnId,
      supplier_id: "",
      vendor_id: "",
    }));
  };

  const toggleItem = (grnItemId: string) => {
    setReturnableItems((items) =>
      items.map((item) =>
        item.grn_item_id === grnItemId ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const toggleAllItems = (checked: boolean) => {
    setReturnableItems((items) => items.map((item) => ({ ...item, selected: checked })));
  };

  const updateQtyReturn = (grnItemId: string, qty: number) => {
    setReturnableItems((items) =>
      items.map((item) =>
        item.grn_item_id === grnItemId
          ? {
              ...item,
              qty_return: Math.min(Math.max(0, qty), item.qty_available_to_return),
              selected: qty > 0 ? true : item.selected,
            }
          : item
      )
    );
  };

  const updateConditionNotes = (grnItemId: string, notes: string) => {
    setReturnableItems((items) =>
      items.map((item) =>
        item.grn_item_id === grnItemId ? { ...item, condition_notes: notes } : item
      )
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.grn_id) {
      toast.error("Goods receipt is required");
      return;
    }
    if (config.isProduct ? !formData.vendor_id : !formData.supplier_id) {
      toast.error(`${config.partyLabel} is required`);
      return;
    }
    if (!formData.reason_type) {
      toast.error("Return reason is required");
      return;
    }

    const selectedItems = returnableItems.filter(
      (item) => item.selected && item.qty_return > 0
    );

    if (selectedItems.length === 0) {
      toast.error("Select at least one item with a return quantity");
      return;
    }

    for (const item of selectedItems) {
      if (item.qty_return > item.qty_available_to_return) {
        const { nama } = config.itemName(item);
        toast.error(`Return qty for ${nama} exceeds available quantity`);
        return;
      }
    }

    try {
      await createMutation.mutateAsync({
        grn_id: formData.grn_id,
        ...(config.isProduct
          ? { vendor_id: formData.vendor_id, module_type: "product" as const }
          : { supplier_id: formData.supplier_id }),
        return_date: formData.return_date,
        reason_type: formData.reason_type as ReturnReasonType,
        reason_notes: formData.reason_notes,
        notes: formData.notes,
        items: selectedItems.map((item) => ({
          grn_item_id: item.grn_item_id,
          ...(config.isProduct
            ? { product_id: item.product_id }
            : { raw_material_id: item.raw_material_id }),
          qty_returned: item.qty_return,
          unit_cost: item.unit_price,
          batch_number: item.batch_number,
          expiry_date: item.expiry_date,
          condition_notes: item.condition_notes,
        })),
      });
      toast.success("Purchase return created and pending approval");
      router.push(config.listRoute);
    } catch (error: unknown) {
      console.error("Error creating return:", error);
      toast.error(getErrorMessage(error, "Failed to create purchase return"));
    }
  };

  const selectedCount = returnableItems.filter((i) => i.selected && i.qty_return > 0).length;
  const totalQty = returnableItems
    .filter((i) => i.selected)
    .reduce((sum, i) => sum + i.qty_return, 0);
  const totalAmount = returnableItems
    .filter((i) => i.selected)
    .reduce((sum, i) => sum + i.qty_return * i.unit_price, 0);

  const allSelected =
    returnableItems.length > 0 && returnableItems.every((item) => item.selected);

  if (loadingGrnOptions && !grnOptions.length) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-pink-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={config.listRoute}
        title="Create Purchase Return"
        description={`Return QC-completed goods to the ${config.partyLabel.toLowerCase()}.`}
      />

      <form id="purchase-return-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardList className="h-4 w-4 text-pink-600" />
                  Return Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs">
                    Goods Receipt <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={grnOptions.map((grn) => ({
                      value: grn.id,
                      label: grn.nomor_grn,
                      description: config.partyNameFromGrn(grn) || undefined,
                    }))}
                    value={selectedGrnId}
                    onChange={handleGrnChange}
                    placeholder={
                      loadingGrnOptions ? "Loading goods receipts..." : "Select goods receipt"
                    }
                    searchPlaceholder="Search GRN number..."
                    emptyMessage="No QC-completed goods receipts found"
                    disabled={loadingGrnOptions}
                    className="w-full! h-9 text-sm"
                  />
                  <p className="text-xs text-gray-500">
                    Only receipts with completed quality control are listed.
                  </p>
                </div>

                {selectedGrn && (
                  <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200/70 bg-gray-50/60 p-4 text-sm md:grid-cols-2">
                    <div>
                      <p className="text-xs text-gray-500">GRN Number</p>
                      <p className="font-medium text-gray-900">{selectedGrn.nomor_grn}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">{config.partyLabel}</p>
                      <p className="font-medium text-gray-900">
                        {config.partyNameFromGrn(selectedGrn)}
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <DsDateTimePicker
                    label="Return Date"
                    value={formData.return_date}
                    onChange={(value) =>
                      setFormData((prev) => ({ ...prev, return_date: value }))
                    }
                    placeholder="Select return date..."
                    dateOnly
                    required
                  />
                  <div className="min-w-0 space-y-1.5">
                    <Label className="text-xs">
                      Return Reason <span className="text-red-500">*</span>
                    </Label>
                    <Combobox
                      options={RETURN_REASON_OPTIONS}
                      value={formData.reason_type}
                      onChange={(value) =>
                        setFormData((prev) => ({
                          ...prev,
                          reason_type: value as ReturnReasonType,
                        }))
                      }
                      placeholder="Select reason..."
                      searchPlaceholder="Search reason..."
                      emptyMessage="No reason found"
                      className="w-full! h-9 text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reason_notes" className="text-xs">
                    Reason Notes
                  </Label>
                  <Textarea
                    id="reason_notes"
                    placeholder="Describe the return reason in detail..."
                    value={formData.reason_notes}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, reason_notes: e.target.value }))
                    }
                    rows={3}
                    className="resize-none text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="notes" className="text-xs">
                    Internal Notes
                  </Label>
                  <Textarea
                    id="notes"
                    placeholder="Optional internal notes..."
                    value={formData.notes}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, notes: e.target.value }))
                    }
                    rows={2}
                    className="resize-none text-sm"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-4 w-4 text-pink-600" />
                  Select Items to Return
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {!selectedGrnId ? (
                  <div className="flex flex-col items-center py-14 text-center text-sm text-gray-500">
                    <RotateCcw className="mb-3 h-10 w-10 text-gray-300" />
                    Select a goods receipt to view returnable items.
                  </div>
                ) : loadingItems ? (
                  <div className="flex items-center justify-center py-14">
                    <Loader2 className="h-6 w-6 animate-spin text-pink-600" />
                  </div>
                ) : returnableItems.length === 0 ? (
                  <div className="flex flex-col items-center px-4 py-14 text-center">
                    <AlertCircle className="mb-3 h-10 w-10 text-gray-300" />
                    <p className="text-sm text-gray-600">No returnable items found</p>
                    <p className="mt-1 max-w-md text-xs text-gray-500">
                      This goods receipt has no QC-posted quantity available to return, or all
                      quantities have already been returned.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto p-4">
                    <table className="w-full table-fixed border-collapse text-sm [&_td]:border [&_td]:border-gray-200/70 [&_th]:border [&_th]:border-gray-200/70">
                      <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="w-10 px-2 py-3 text-center font-semibold">
                            <Checkbox
                              checked={allSelected}
                              onCheckedChange={(checked) => toggleAllItems(checked === true)}
                              aria-label="Select all items"
                            />
                          </th>
                          <th className="px-4 py-3 text-left font-semibold">
                            {config.isProduct ? "Product" : "Raw Material"}
                          </th>
                          <th className="w-[88px] px-2 py-3 text-center font-semibold">Received</th>
                          <th className="w-[88px] px-2 py-3 text-center font-semibold">Returned</th>
                          <th className="w-[96px] px-2 py-3 text-center font-semibold">Available</th>
                          <th className="w-[112px] px-2 py-3 text-center font-semibold">
                            Return Qty
                          </th>
                          <th className="min-w-[140px] px-3 py-3 text-left font-semibold">
                            Condition
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {returnableItems.map((item) => {
                          const itemDisplay = config.itemName(item);
                          return (
                          <tr
                            key={item.grn_item_id}
                            className={`bg-white ${item.selected ? "bg-pink-50/40" : "hover:bg-gray-50/80"}`}
                          >
                            <td className="px-2 py-3 text-center align-middle">
                              <Checkbox
                                checked={item.selected}
                                onCheckedChange={() => toggleItem(item.grn_item_id)}
                                aria-label={`Select ${itemDisplay.nama}`}
                              />
                            </td>
                            <td className="px-4 py-3 align-top">
                              <div className="font-medium text-gray-900">
                                {itemDisplay.nama}
                              </div>
                              <div className="mt-0.5 text-xs text-gray-500">
                                {itemDisplay.kode}
                              </div>
                            </td>
                            <td className="px-2 py-3 text-center align-middle text-gray-700">
                              {formatQty(item.qty_diterima)}
                            </td>
                            <td className="px-2 py-3 text-center align-middle text-gray-500">
                              {formatQty(item.qty_returned)}
                            </td>
                            <td className="px-2 py-3 text-center align-middle font-semibold text-pink-700">
                              {formatQty(item.qty_available_to_return)}
                            </td>
                            <td className="px-1.5 py-1.5 align-middle">
                              <NumericInput
                                min={0}
                                max={item.qty_available_to_return}
                                value={item.selected ? item.qty_return : 0}
                                onValueChange={(value) =>
                                  updateQtyReturn(item.grn_item_id, value || 0)
                                }
                                decimalScale={4}
                                disabled={!item.selected}
                                className="h-9 w-full border-gray-200/80 bg-white px-2 text-center text-sm focus-visible:border-pink-300 focus-visible:ring-1 focus-visible:ring-pink-200/80 disabled:bg-gray-50"
                              />
                            </td>
                            <td className="px-1.5 py-1.5 align-middle">
                              <input
                                type="text"
                                value={item.condition_notes}
                                onChange={(e) =>
                                  updateConditionNotes(item.grn_item_id, e.target.value)
                                }
                                disabled={!item.selected}
                                placeholder="Item condition..."
                                className="h-9 w-full rounded-lg border border-gray-200/80 bg-white px-2 text-sm focus:border-pink-300 focus:outline-none focus:ring-1 focus:ring-pink-200/80 disabled:bg-gray-50"
                              />
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="xl:col-span-4">
            <Card className="border-gray-200/70 shadow-xs xl:sticky xl:top-6">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="text-base">Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <dl className="space-y-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-gray-500">Selected Items</dt>
                    <dd className="font-medium text-gray-900">{selectedCount}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-gray-500">Total Quantity</dt>
                    <dd className="font-medium text-gray-900">{formatQty(totalQty)}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3 border-t border-gray-200/70 pt-3">
                    <dt className="font-medium text-gray-900">Total Amount</dt>
                    <dd className="font-semibold text-pink-700">
                      {formatAmount(totalAmount)}
                    </dd>
                  </div>
                </dl>

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

                {selectedCount > 0 && (
                  <div className="rounded-xl border border-gray-200/70 bg-white p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
                      <Package className="h-4 w-4 text-pink-600" />
                      Item Preview
                    </div>
                    <ul className="space-y-2 text-xs text-gray-600">
                      {returnableItems
                        .filter((item) => item.selected && item.qty_return > 0)
                        .slice(0, 4)
                        .map((item) => {
                          const itemDisplay = config.itemName(item);
                          return (
                          <li
                            key={item.grn_item_id}
                            className="flex items-center justify-between gap-3"
                          >
                            <span className="truncate">{itemDisplay.nama}</span>
                            <span className="shrink-0 font-medium text-gray-900">
                              {formatQty(item.qty_return)}
                            </span>
                          </li>
                          );
                        })}
                      {selectedCount > 4 && (
                        <li className="text-gray-500">+{selectedCount - 4} more items</li>
                      )}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <PurchasingFormFooter
          onCancel={() => router.push(config.listRoute)}
          submitLabel="Submit Return"
          loading={isSubmitting}
          disabled={!selectedGrnId || selectedCount === 0 || totalQty <= 0}
          formId="purchase-return-form"
        />
      </form>
    </div>
  );
}
