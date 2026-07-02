"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
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
import { RM_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { useReturn, useReturnFormData } from "../queries";
import { useUpdateReturn } from "../mutations";
import { ReturnReasonType, ReturnableItem, ReturnStatus } from "@/types/purchasing";
import { formatAmount } from "@/lib/purchasing/utils";
import {
  AlertCircle,
  ArrowLeftIcon,
  ClipboardList,
  Loader2,
  Package,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

const EDITABLE_STATUSES: ReturnStatus[] = ["draft", "pending_approval"];

const RETURN_REASON_OPTIONS: { value: ReturnReasonType; label: string }[] = [
  { value: "damaged", label: "Damaged Goods" },
  { value: "wrong_item", label: "Wrong Item" },
  { value: "expired", label: "Expired" },
  { value: "overstock", label: "Overstock" },
  { value: "specification_mismatch", label: "Specification Mismatch" },
  { value: "other", label: "Other" },
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

export function EditReturnPage() {
  const router = useRouter();
  const params = useParams();
  const returnId = params.id as string;

  const detailQuery = useReturn(returnId);
  const existingReturn = detailQuery.data ?? null;

  const grnId = existingReturn?.grn_id || "";
  const formDataQuery = useReturnFormData(grnId || null, returnId);
  const loadingItems = Boolean(grnId) && formDataQuery.isLoading;

  const [returnableItems, setReturnableItems] = useState<ReturnItem[]>([]);
  const [formData, setFormData] = useState({
    return_date: "",
    reason_type: "" as ReturnReasonType | "",
    reason_notes: "",
    notes: "",
  });

  const itemsInitializedRef = useRef(false);
  const headerInitializedRef = useRef(false);

  const updateMutation = useUpdateReturn();
  const isSubmitting = updateMutation.isPending;

  useEffect(() => {
    if (!existingReturn || headerInitializedRef.current) return;
    headerInitializedRef.current = true;
    setFormData({
      return_date: existingReturn.return_date,
      reason_type: existingReturn.reason_type,
      reason_notes: existingReturn.reason_notes || "",
      notes: existingReturn.notes || "",
    });
  }, [existingReturn]);

  useEffect(() => {
    if (itemsInitializedRef.current || !existingReturn || !formDataQuery.data?.returnableItems) {
      return;
    }

    const existingByGrnItem = new Map(
      (existingReturn.items || [])
        .filter((item) => item.grn_item_id)
        .map((item) => [item.grn_item_id as string, item])
    );

    setReturnableItems(
      formDataQuery.data.returnableItems.map((item: ReturnableItem) => {
        const existing = existingByGrnItem.get(item.grn_item_id);
        if (existing) {
          return {
            ...item,
            unit_price: Number(existing.unit_cost) || item.unit_price,
            selected: true,
            qty_return: Number(existing.qty_returned),
            condition_notes: existing.condition_notes || "",
          };
        }
        return {
          ...item,
          selected: false,
          qty_return: 0,
          condition_notes: "",
        };
      })
    );
    itemsInitializedRef.current = true;
  }, [existingReturn, formDataQuery.data]);

  useEffect(() => {
    if (formDataQuery.isError) {
      toast.error("Failed to load returnable items");
    }
  }, [formDataQuery.isError]);

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

    if (!existingReturn?.grn_id || !existingReturn.supplier_id) {
      toast.error("Return data is incomplete");
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
        toast.error(`Return qty for ${item.raw_material_nama} exceeds available quantity`);
        return;
      }
    }

    try {
      await updateMutation.mutateAsync({
        id: returnId,
        data: {
          grn_id: existingReturn.grn_id,
          supplier_id: existingReturn.supplier_id,
          return_date: formData.return_date,
          reason_type: formData.reason_type as ReturnReasonType,
          reason_notes: formData.reason_notes,
          notes: formData.notes,
          items: selectedItems.map((item) => ({
            grn_item_id: item.grn_item_id,
            raw_material_id: item.raw_material_id,
            qty_returned: item.qty_return,
            unit_cost: item.unit_price,
            batch_number: item.batch_number,
            expiry_date: item.expiry_date,
            condition_notes: item.condition_notes,
          })),
        },
      });
      toast.success("Purchase return updated");
      router.push(RM_ROUTES.purchasingReturnsDetail(returnId));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to update purchase return"));
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

  if (detailQuery.isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-pink-600" />
      </div>
    );
  }

  if (detailQuery.isError || !existingReturn) {
    return (
      <div className="space-y-4">
        <Link href={RM_ROUTES.purchasingReturns}>
          <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
            <ArrowLeftIcon className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="py-12 text-center text-sm text-gray-500">
            Purchase return not found or could not be loaded.
          </CardContent>
        </Card>
      </div>
    );
  }

  const status = existingReturn.status as ReturnStatus;
  if (!EDITABLE_STATUSES.includes(status)) {
    return (
      <div className="space-y-4">
        <Link href={RM_ROUTES.purchasingReturnsDetail(returnId)}>
          <Button variant="ghost" size="sm" className="h-9 gap-2 text-pink-700">
            <ArrowLeftIcon className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="py-12 text-center text-sm text-gray-500">
            This purchase return can no longer be edited after approval.
          </CardContent>
        </Card>
      </div>
    );
  }

  const grnNumber =
    existingReturn.grn?.grn_number || existingReturn.grn?.nomor_grn || "-";

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={RM_ROUTES.purchasingReturnsDetail(returnId)}
        title={`Edit ${existingReturn.return_number}`}
        description="Update return details before approval. Stock is deducted from the receipt warehouse on approval."
      />

      <form id="purchase-return-edit-form" onSubmit={handleSubmit} className="space-y-6">
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
                <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200/70 bg-gray-50/60 p-4 text-sm md:grid-cols-2">
                  <div>
                    <p className="text-xs text-gray-500">Goods Receipt</p>
                    <p className="font-medium text-gray-900">{grnNumber}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Supplier</p>
                    <p className="font-medium text-gray-900">
                      {existingReturn.supplier?.nama_supplier || "-"}
                    </p>
                  </div>
                </div>

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
                  Items to Return
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loadingItems ? (
                  <div className="flex items-center justify-center py-14">
                    <Loader2 className="h-6 w-6 animate-spin text-pink-600" />
                  </div>
                ) : returnableItems.length === 0 ? (
                  <div className="flex flex-col items-center px-4 py-14 text-center">
                    <AlertCircle className="mb-3 h-10 w-10 text-gray-300" />
                    <p className="text-sm text-gray-600">No returnable items found</p>
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
                          <th className="px-4 py-3 text-left font-semibold">Raw Material</th>
                          <th className="w-[100px] px-2 py-3 text-center font-semibold">Warehouse</th>
                          <th className="w-[88px] px-2 py-3 text-center font-semibold">Available</th>
                          <th className="w-[112px] px-2 py-3 text-center font-semibold">Return Qty</th>
                          <th className="min-w-[140px] px-3 py-3 text-left font-semibold">
                            Condition
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {returnableItems.map((item) => (
                          <tr
                            key={item.grn_item_id}
                            className={`bg-white ${item.selected ? "bg-pink-50/40" : "hover:bg-gray-50/80"}`}
                          >
                            <td className="px-2 py-3 text-center align-middle">
                              <Checkbox
                                checked={item.selected}
                                onCheckedChange={() => toggleItem(item.grn_item_id)}
                                aria-label={`Select ${item.raw_material_nama}`}
                              />
                            </td>
                            <td className="px-4 py-3 align-top">
                              <div className="font-medium text-gray-900">
                                {item.raw_material_nama}
                              </div>
                              <div className="mt-0.5 text-xs text-gray-500">
                                {item.raw_material_kode}
                              </div>
                            </td>
                            <td className="px-2 py-3 text-center align-middle text-xs text-gray-600">
                              {item.warehouse_name || "-"}
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
                        ))}
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
                    <dd className="font-semibold text-pink-700">{formatAmount(totalAmount)}</dd>
                  </div>
                </dl>

                <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-4 text-xs text-amber-800">
                  <div className="flex items-start gap-2">
                    <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      On approval, stock will be reduced from the same warehouse where goods were
                      received during GRN QC posting.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <PurchasingFormFooter
          formId="purchase-return-edit-form"
          submitLabel={isSubmitting ? "Saving..." : "Save Changes"}
          isSubmitting={isSubmitting}
          onCancel={() => router.push(RM_ROUTES.purchasingReturnsDetail(returnId))}
        />
      </form>
    </div>
  );
}
