"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Calendar, Package, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { DsDateTimePicker } from "@/components/design-system";
import { NumericInput } from "@/components/ui/numeric-input";
import { SupplierPriceListFormData } from "@/types/purchasing";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/modules/purchasing/components/page/purchasing-page-header";
import { usePriceListFormData } from "../queries";
import { useCreatePriceList } from "../mutations";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function NewPriceListPage() {
  const router = useRouter();
  const formDataQuery = usePriceListFormData();
  const suppliers = formDataQuery.data?.suppliers ?? [];
  const materials = formDataQuery.data?.materials ?? [];
  const units = formDataQuery.data?.units ?? [];
  const loading = formDataQuery.isLoading;
  const createMutation = useCreatePriceList();
  const isSubmitting = createMutation.isPending;

  const [formData, setFormData] = useState<SupplierPriceListFormData>({
    supplier_id: "",
    bahan_baku_id: "",
    harga: 0,
    satuan_id: "",
    minimum_qty: 1,
    lead_time_days: 0,
    is_preferred: false,
    berlaku_dari: "",
    berlaku_sampai: "",
    catatan: "",
  });

  useEffect(() => {
    if (formDataQuery.isError) {
      console.error("Error loading data:", formDataQuery.error);
      toast.error("Failed to load form data.");
    }
  }, [formDataQuery.isError, formDataQuery.error]);

  const selectedUnitLabel =
    units.find((unit) => unit.id === formData.satuan_id)?.simbol ||
    units.find((unit) => unit.id === formData.satuan_id)?.nama ||
    "unit";
  const selectedMaterial = materials.find((material) => material.id === formData.bahan_baku_id);
  const convertedUnits =
    selectedMaterial?.unit_conversions?.filter((conversion) => conversion.is_active !== false) || [];
  const unitOptions =
    convertedUnits.length > 0
      ? convertedUnits.map((conversion) => {
          const unit = conversion.satuan || units.find((item) => item.id === conversion.satuan_id);
          return {
            value: conversion.satuan_id,
            label: unit?.nama || "Unit",
            description: conversion.is_base
              ? "Base unit"
              : `1 ${unit?.simbol || unit?.kode || unit?.nama || "unit"} = ${conversion.qty_in_base_unit}`,
          };
        })
      : units.map((u) => ({ value: u.id, label: u.nama, description: u.simbol }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.supplier_id) {
      toast.error("Supplier is required.");
      return;
    }
    if (!formData.bahan_baku_id) {
      toast.error("Raw material is required.");
      return;
    }
    if (!formData.satuan_id) {
      toast.error("Unit is required.");
      return;
    }

    const payload: SupplierPriceListFormData = {
      supplier_id: formData.supplier_id,
      bahan_baku_id: formData.bahan_baku_id,
      harga: Number(formData.harga),
      satuan_id: formData.satuan_id || undefined,
      minimum_qty: Number(formData.minimum_qty),
      lead_time_days: Number(formData.lead_time_days),
      is_preferred: formData.is_preferred,
    };

    if (formData.berlaku_dari) {
      const dateStr = formData.berlaku_dari;
      payload.berlaku_dari =
        dateStr.length === 10 ? dateStr : new Date(dateStr).toISOString().split("T")[0];
    }
    if (formData.berlaku_sampai) {
      const dateStr = formData.berlaku_sampai;
      payload.berlaku_sampai =
        dateStr.length === 10 ? dateStr : new Date(dateStr).toISOString().split("T")[0];
    }
    if (formData.catatan?.trim()) {
      payload.catatan = formData.catatan.trim();
    }

    try {
      await createMutation.mutateAsync(payload);
      toast.success("Price list created successfully.");
      router.push("/dashboard/purchasing/price-list");
    } catch (error: unknown) {
      console.error("Error creating price list:", error);
      toast.error(getErrorMessage(error, "Failed to create price list."));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-pink-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref="/dashboard/purchasing/price-list"
        title="Add Price List"
        description="Enter supplier pricing details for a raw material."
      />

      <form id="price-list-form" onSubmit={handleSubmit}>
        <div className="space-y-6">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4" />
                Supplier & Raw Material
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="supplier" className="text-xs">
                    Supplier <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={suppliers.map((s) => ({
                      value: s.id,
                      label: s.nama_supplier,
                      description: s.kota || undefined,
                    }))}
                    value={formData.supplier_id}
                    onChange={(v) => setFormData((prev) => ({ ...prev, supplier_id: v }))}
                    placeholder="Select supplier..."
                    searchPlaceholder="Search..."
                    emptyMessage="Supplier not found"
                    allowClear
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bahan_baku" className="text-xs">
                    Raw Material <span className="text-red-500">*</span>
                  </Label>
                  <Combobox
                    options={materials.map((m) => ({ value: m.id, label: m.nama, description: m.kode }))}
                    value={formData.bahan_baku_id}
                    onChange={(v) => {
                      const material = materials.find((item) => item.id === v);
                      const defaultUnitId =
                        material?.unit_conversions?.find((conversion) => conversion.is_base)?.satuan_id ||
                        material?.unit_conversions?.[0]?.satuan_id ||
                        "";
                      setFormData((prev) => ({ ...prev, bahan_baku_id: v, satuan_id: defaultUnitId }));
                    }}
                    placeholder="Select raw material..."
                    searchPlaceholder="Search..."
                    emptyMessage="Raw material not found"
                    allowClear
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="satuan" className="text-xs">
                  Unit <span className="text-red-500">*</span>
                </Label>
                <Combobox
                  options={unitOptions}
                  value={formData.satuan_id}
                  onChange={(v) => setFormData((prev) => ({ ...prev, satuan_id: v }))}
                  placeholder={formData.bahan_baku_id ? "Select unit..." : "Select raw material first"}
                  searchPlaceholder="Search..."
                  emptyMessage="No units configured for this raw material"
                  disabled={!formData.bahan_baku_id}
                  allowClear
                  className="h-9 text-sm"
                />
                <p className="text-xs text-gray-500">
                  Unit options are taken from the raw material conversion settings.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <DollarSign className="h-4 w-4" />
                Price & Terms
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="harga" className="text-xs">
                    Price per Unit <span className="text-red-500">*</span>
                  </Label>
                  <NumericInput
                    id="harga"
                    min="0"
                    step="0.01"
                    value={formData.harga}
                    onValueChange={(value) => setFormData((prev) => ({ ...prev, harga: value }))}
                    decimalScale={0}
                    className="h-9 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="minimum_qty" className="text-xs">Minimum Quantity</Label>
                  <div className="flex rounded-lg border border-gray-200/80 bg-white focus-within:border-pink-300 focus-within:ring-1 focus-within:ring-pink-100">
                    <NumericInput
                      id="minimum_qty"
                      min="1"
                      value={formData.minimum_qty}
                      onValueChange={(value) =>
                        setFormData((prev) => ({ ...prev, minimum_qty: value || 1 }))
                      }
                      decimalScale={4}
                      className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    <div className="flex min-w-14 items-center justify-center rounded-r-lg border-l border-gray-200/80 bg-gray-50 px-3 text-xs font-semibold uppercase text-gray-500">
                      {selectedUnitLabel}
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lead_time" className="text-xs">Lead Time (days)</Label>
                  <div className="flex rounded-lg border border-gray-200/80 bg-white focus-within:border-pink-300 focus-within:ring-1 focus-within:ring-pink-100">
                    <NumericInput
                      id="lead_time"
                      min="0"
                      value={formData.lead_time_days}
                      onValueChange={(value) =>
                        setFormData((prev) => ({ ...prev, lead_time_days: value }))
                      }
                      decimalScale={0}
                      className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    <div className="flex min-w-14 items-center justify-center rounded-r-lg border-l border-gray-200/80 bg-gray-50 px-3 text-xs font-semibold text-gray-500">
                      days
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="border-b border-gray-200/70 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="h-4 w-4" />
                Contract Validity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <DsDateTimePicker
                  label="Effective From"
                  value={formData.berlaku_dari}
                  onChange={(v) => setFormData((prev) => ({ ...prev, berlaku_dari: v }))}
                  placeholder="Select start date..."
                  dateOnly
                />
                <DsDateTimePicker
                  label="Effective Until"
                  value={formData.berlaku_sampai}
                  onChange={(v) => setFormData((prev) => ({ ...prev, berlaku_sampai: v }))}
                  placeholder="Select end date..."
                  dateOnly
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="catatan" className="text-xs">Notes</Label>
                <Textarea
                  id="catatan"
                  value={formData.catatan}
                  onChange={(e) => setFormData((prev) => ({ ...prev, catatan: e.target.value }))}
                  placeholder="Additional notes..."
                  rows={2}
                  className="resize-none text-sm"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <PurchasingFormFooter
          onCancel={() => router.back()}
          submitLabel="Save Price List"
          loading={isSubmitting}
          formId="price-list-form"
        />
      </form>
    </div>
  );
}
