"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FileText, Loader2, Plus, ShoppingBasket, StickyNote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumericInput } from "@/components/ui/numeric-input";
import { DsDateTimePicker } from "@/components/design-system";
import { formatAmount } from "@/lib/purchasing/utils";
import { parseLocaleNumber } from "@/lib/purchasing/parse-locale-number";
import { toast } from "sonner";
import type { ProductPRFormInput, ProductPRFormProduct } from "@/features/purchasing/product-pr/types";

const productPrItemSchema = z.object({
  product_id: z.string().min(1, "Product is required"),
  satuan_id: z.string().optional(),
  description: z.string().min(1, "Description is required"),
  qty: z.preprocess(
    (value) => parseLocaleNumber(value) ?? value,
    z.number().min(1, "Minimum quantity is 1")
  ),
  unit: z.string().min(1, "Unit is required"),
  estimated_price: z.preprocess(
    (value) => parseLocaleNumber(value) ?? 0,
    z.number().min(0)
  ),
});

const productPrSchema = z.object({
  department_id: z.string().min(1, "Department is required"),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  required_date: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(productPrItemSchema).min(1, "At least one item is required"),
});

type ProductPRFormValues = z.infer<typeof productPrSchema>;

function firstErrorMessage(errors: unknown): string | null {
  if (!errors || typeof errors !== "object") return null;
  const node = errors as Record<string, unknown> & { message?: unknown };
  if (typeof node.message === "string" && node.message.length > 0) return node.message;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = firstErrorMessage(item);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      const found = firstErrorMessage(value);
      if (found) return found;
    }
  }
  return null;
}

interface ProductPRFormProps {
  departments: { id: string; name: string }[];
  products: ProductPRFormProduct[];
  units: { id: string; nama: string }[];
  onSubmit: (data: ProductPRFormInput, action: "draft" | "submit") => void | Promise<void>;
  isLoading?: boolean;
  initialData?: ProductPRFormInput;
  mode?: "create" | "edit";
  cancelHref?: string;
}

export function ProductPRForm({
  departments,
  products,
  units,
  onSubmit,
  isLoading,
  initialData,
  mode = "create",
  cancelHref,
}: ProductPRFormProps) {
  const router = useRouter();
  const [submitAction, setSubmitAction] = useState<"draft" | "submit" | null>(null);
  const formId = "product-purchase-request-form";

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProductPRFormValues>({
    resolver: zodResolver(productPrSchema) as Resolver<ProductPRFormValues>,
    defaultValues: initialData || {
      priority: "medium",
      items: [{ product_id: "", satuan_id: "", description: "", qty: 1, unit: "", estimated_price: 0 }],
    },
  });

  register("priority");

  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  const selectedDepartment = watch("department_id");
  const requiredDate = watch("required_date");
  const items = watch("items");
  const totalAmount = items.reduce(
    (sum, item) => sum + (item.qty || 0) * (item.estimated_price || 0),
    0
  );

  function getUnitName(unitId?: string) {
    return units.find((unit) => unit.id === unitId)?.nama || "";
  }

  async function applyEstimatedPrice(index: number, productId: string, fallbackPrice = 0) {
    // Sama seperti RM / general: estimasi dari harga master, bukan price list vendor.
    void productId;
    setValue(`items.${index}.estimated_price`, Math.round(Number(fallbackPrice || 0)), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  async function handleSelectProduct(index: number, productId: string) {
    const product = products.find((item) => item.id === productId);
    const unitId = product?.satuan_id || "";
    const unitName = product?.satuan_nama || getUnitName(unitId);
    setValue(`items.${index}.product_id`, productId, { shouldValidate: true });
    setValue(`items.${index}.description`, product?.nama || "", { shouldValidate: true });
    setValue(`items.${index}.unit`, unitName, { shouldValidate: true });
    setValue(`items.${index}.satuan_id`, unitId);
    await applyEstimatedPrice(index, productId, Number(product?.harga_modal || 0));
  }

  const isSubmitting = isLoading || submitAction !== null;

  function submitWithAction(action: "draft" | "submit") {
    return handleSubmit(
      async (data) => {
        setSubmitAction(action);
        try {
          await onSubmit(data, action);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to save purchase request";
          if (!message.includes("NEXT_REDIRECT")) toast.error(message);
          throw error;
        } finally {
          setSubmitAction(null);
        }
      },
      (formErrors) => {
        const message = firstErrorMessage(formErrors);
        toast.error(
          message
            ? `Complete the form: ${message}`
            : "Please review the form — required fields are still missing"
        );
      }
    )();
  }

  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        submitWithAction("submit");
      }}
      className="space-y-6"
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Request Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <input type="hidden" {...register("department_id")} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs">
                    Department <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={departments.map((dept) => ({ value: dept.id, label: dept.name }))}
                    value={selectedDepartment}
                    onChange={(value) => setValue("department_id", value, { shouldValidate: true })}
                    placeholder="Select department..."
                    searchPlaceholder="Search department..."
                    emptyMessage="No department found"
                    allowClear
                    className="!w-full h-9 text-sm"
                  />
                  {errors.department_id && (
                    <p className="text-xs text-red-500">{errors.department_id.message}</p>
                  )}
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs">
                    Priority <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={[
                      { value: "low", label: "Low" },
                      { value: "medium", label: "Medium" },
                      { value: "high", label: "High" },
                      { value: "urgent", label: "Urgent" },
                    ]}
                    value={watch("priority")}
                    onChange={(value) =>
                      setValue("priority", value as ProductPRFormValues["priority"], {
                        shouldValidate: true,
                      })
                    }
                    placeholder="Select priority..."
                    searchPlaceholder="Search..."
                    emptyMessage="No priority found"
                    className="!w-full h-9 text-sm"
                  />
                </div>
              </div>
              <DsDateTimePicker
                label="Required Date"
                value={requiredDate}
                onChange={(value) => setValue("required_date", value)}
                placeholder="Select required date..."
                dateOnly
              />
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingBasket className="h-4 w-4" />
                Request Items
              </CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                onClick={() =>
                  append({
                    product_id: "",
                    satuan_id: "",
                    description: "",
                    qty: 1,
                    unit: "",
                    estimated_price: 0,
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Add Item
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {fields.map((field, index) => (
                <div key={field.id} className="rounded-xl border border-gray-200/70 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">Item {index + 1}</p>
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-red-500 hover:text-red-600"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                    <div className="min-w-0 space-y-1.5 lg:col-span-4">
                      <Label className="text-xs">
                        Product <span className="text-red-500">*</span>
                      </Label>
                      <Combobox
                        options={products.map((product) => ({
                          value: product.id,
                          label: product.nama,
                          description: product.kode,
                        }))}
                        value={items[index]?.product_id || ""}
                        onChange={(value) => handleSelectProduct(index, value)}
                        placeholder="Select product..."
                        searchPlaceholder="Search product..."
                        emptyMessage="No product found"
                        allowClear
                        className="!w-full h-9 text-sm"
                      />
                    </div>
                    <div className="min-w-0 space-y-1.5 lg:col-span-4">
                      <Label className="text-xs">Description</Label>
                      <input type="hidden" {...register(`items.${index}.description`)} />
                      <div className="flex h-9 w-full items-center rounded-lg border border-gray-200/80 bg-gray-50 px-2.5 text-sm text-gray-700">
                        {items[index]?.description || "Select a product first"}
                      </div>
                    </div>
                    <div className="min-w-0 space-y-1.5 lg:col-span-2">
                      <Label className="text-xs">Quantity</Label>
                      <NumericInput
                        value={items[index]?.qty || 0}
                        onValueChange={(value) =>
                          setValue(`items.${index}.qty`, value, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                        decimalScale={4}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="min-w-0 space-y-1.5 lg:col-span-2">
                      <Label className="text-xs">Unit</Label>
                      <input type="hidden" {...register(`items.${index}.unit`)} />
                      <input type="hidden" {...register(`items.${index}.satuan_id`)} />
                      <div className="flex h-9 items-center rounded-lg border border-gray-200/80 bg-gray-50 px-2.5 text-sm text-gray-700">
                        {items[index]?.unit || "-"}
                      </div>
                    </div>
                    <div className="min-w-0 space-y-1.5 lg:col-span-3">
                      <Label className="text-xs">Estimated Price</Label>
                      <NumericInput
                        value={items[index]?.estimated_price || 0}
                        onValueChange={(value) =>
                          setValue(`items.${index}.estimated_price`, value, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                        decimalScale={0}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="min-w-0 rounded-lg bg-gray-50/80 p-3 lg:col-span-3">
                      <p className="text-xs text-gray-500">Subtotal</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {formatAmount((items[index]?.qty || 0) * (items[index]?.estimated_price || 0))}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              {errors.items && <p className="text-sm text-red-500">{errors.items.message}</p>}
            </CardContent>
          </Card>
        </div>

        <div className="xl:col-span-4">
          <Card className="border-gray-200/70 shadow-xs xl:sticky xl:top-6">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <StickyNote className="h-4 w-4" />
                Notes & Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Notes</Label>
                <Textarea {...register("notes")} placeholder="Additional notes..." rows={4} className="resize-none text-sm" />
              </div>
              <div className="rounded-xl border border-gray-200/70 bg-gray-50/70 p-4">
                <p className="text-sm text-gray-500">Estimated Total</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{formatAmount(totalAmount)}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => (cancelHref ? router.push(cancelHref) : router.back())}
                  className="h-10"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => submitWithAction("draft")()}
                  className="h-10"
                >
                  {submitAction === "draft" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Draft
                </Button>
                <Button type="submit" disabled={isSubmitting} className="h-10 purchasing-main-button">
                  {submitAction === "submit" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {mode === "edit" ? "Save & Submit" : "Submit Purchase Request"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}
