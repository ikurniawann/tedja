"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ITEMS_RAW_MATERIALS_PATH } from "@/modules/purchasing/constants/items-nav";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { AlertCircle, Edit, Trash2, Boxes, Banknote, Settings2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { RawMaterialWithStock } from "@/types/purchasing";
import {
  useRawMaterial,
  useRawMaterialCategoryOptions,
  useStorageConditionOptions,
} from "../queries";
import { useDeleteRawMaterial } from "../mutations";
import {
  buildLookupLabelMap,
  resolveCategoryLabel,
  resolveStorageLabel,
} from "../master-lookups";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatAmount } from "@/lib/purchasing/utils";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const STOCK_STATUS_STYLES: Record<string, string> = {
  AMAN: "border-emerald-200 bg-emerald-50 text-emerald-700",
  MENIPIS: "border-amber-200 bg-amber-50 text-amber-700",
  HABIS: "border-red-200 bg-red-50 text-red-700",
};

const STOCK_STATUS_LABELS: Record<string, string> = {
  AMAN: "Safe",
  MENIPIS: "Low Stock",
  HABIS: "Out of Stock",
};

export function RawMaterialDetailPage() {
  const params = useParams();
  const router = useRouter();
  const materialId = params.id as string;

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const materialQuery = useRawMaterial(materialId);
  const categoriesQuery = useRawMaterialCategoryOptions();
  const storageQuery = useStorageConditionOptions();
  const categoryMap = buildLookupLabelMap(categoriesQuery.data);
  const storageMap = buildLookupLabelMap(storageQuery.data);
  const material = materialQuery.data ?? null;
  const loading = materialQuery.isLoading;
  const deleteMutation = useDeleteRawMaterial();

  const handleDelete = async () => {
    if (!material || deleteMutation.isPending) return;
    try {
      await deleteMutation.mutateAsync(material.id);
      toast.success("Raw material deleted successfully");
      setIsDeleteDialogOpen(false);
      router.push(ITEMS_RAW_MATERIALS_PATH);
    } catch (error: unknown) {
      console.error("Error deleting material:", error);
      toast.error(getErrorMessage(error, "Failed to delete raw material"));
    }
  };

  const formatNumber = (num: number | undefined | null) => {
    if (num === undefined || num === null) return "0";
    return num.toLocaleString("en-US", { maximumFractionDigits: 4 });
  };

  const getStockStatusBadge = (status: string) => {
    const normalized = status || "AMAN";
    return (
      <Badge variant="outline" className={STOCK_STATUS_STYLES[normalized] || STOCK_STATUS_STYLES.AMAN}>
        {normalized === "MENIPIS" || normalized === "HABIS" ? (
          <AlertCircle className="mr-1 inline h-3 w-3" />
        ) : null}
        {STOCK_STATUS_LABELS[normalized] || normalized}
      </Badge>
    );
  };

  const getCategoryLabel = (category?: string) =>
    resolveCategoryLabel(category, categoryMap);

  const satuanBesarName = material?.satuan_besar_nama || material?.satuan_besar?.nama || "-";
  const satuanKecilName = material?.satuan_kecil_nama || "-";
  const storageLabel = resolveStorageLabel(material?.storage_condition, storageMap);
  const unitConversions = material?.unit_conversions?.filter((conversion) => conversion.is_active !== false) || [];
  const baseConversion = unitConversions.find((conversion) => conversion.is_base) || unitConversions[0];
  const baseUnitLabel =
    baseConversion?.satuan?.simbol ||
    baseConversion?.satuan?.kode ||
    baseConversion?.satuan?.nama ||
    (material?.satuan_kecil_id ? satuanKecilName : satuanBesarName);
  const alternativeConversions = unitConversions.filter((conversion) => !conversion.is_base);

  const getConversionUnitLabel = (conversion: NonNullable<RawMaterialWithStock["unit_conversions"]>[number]) =>
    conversion.satuan?.simbol || conversion.satuan?.kode || conversion.satuan?.nama || "-";

  const getConversionUnitName = (conversion: NonNullable<RawMaterialWithStock["unit_conversions"]>[number]) =>
    conversion.satuan?.nama || getConversionUnitLabel(conversion);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
        Loading raw material...
      </div>
    );
  }

  if (!material) {
    return (
      <div className="py-16 text-center text-red-500">Raw material not found</div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title={material.nama}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700">{material.kode}</span>
            <span className="text-gray-300">•</span>
            <span>{getCategoryLabel(material.kategori)}</span>
            <span className="text-gray-300">•</span>
            <span>{satuanBesarName}</span>
            <span className="ml-1">{getStockStatusBadge(material.status_stok || "")}</span>
          </span>
        }
        actions={
          <>
            <Link href={`${ITEMS_RAW_MATERIALS_PATH}/edit/${material.id}`}>
              <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(true)}
              className="h-10 w-full rounded-lg border-red-200/80 bg-white px-3 text-sm font-medium text-red-600 shadow-sm hover:!border-red-200 hover:!bg-red-50 hover:!text-red-700 sm:w-auto"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-pink-50 text-pink-600">
                <Boxes className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Quantity On Hand</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatNumber(material.qty_onhand)} {satuanBesarName}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <AlertCircle className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Minimum Stock</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatNumber(material.stok_minimum)} {satuanBesarName}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Settings2 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Maximum Stock</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatNumber(material.stok_maximum)} {satuanBesarName}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <Banknote className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-medium text-gray-500">Average Cost</p>
                <p className="text-lg font-bold text-gray-900">
                  {(material.avg_cost ?? 0) > 0 ? formatAmount(material.avg_cost) : "-"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="info" className="flex-col space-y-4">
        <TabsList
          variant="line"
          className="flex h-auto w-full justify-start gap-6 rounded-none border-b border-gray-200/70 bg-transparent p-0"
        >
          <TabsTrigger
            value="info"
            className="h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 text-sm font-semibold text-gray-500 shadow-none data-active:border-pink-600 data-active:!bg-transparent data-active:text-pink-700 data-active:shadow-none"
          >
            Information
          </TabsTrigger>
          <TabsTrigger
            value="stock"
            className="h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 text-sm font-semibold text-gray-500 shadow-none data-active:border-pink-600 data-active:!bg-transparent data-active:text-pink-700 data-active:shadow-none"
          >
            Stock and Price
          </TabsTrigger>
          <TabsTrigger
            value="conversions"
            className="h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 text-sm font-semibold text-gray-500 shadow-none data-active:border-pink-600 data-active:!bg-transparent data-active:text-pink-700 data-active:shadow-none"
          >
            Unit Conversions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="border-gray-200/70 shadow-xs lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Raw Material Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Code</p>
                    <p className="font-medium text-gray-900">{material.kode}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Category</p>
                    <p className="font-medium text-gray-900">{getCategoryLabel(material.kategori)}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Description</p>
                  <p className="text-gray-900">{material.deskripsi || "-"}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Large Unit</p>
                    <p className="font-medium text-gray-900">{satuanBesarName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Small Unit</p>
                    <p className="font-medium text-gray-900">{satuanKecilName}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Conversion</p>
                    <p className="font-medium text-gray-900">
                      {material.satuan_kecil_id
                        ? `1 ${satuanBesarName} = ${formatNumber(material.konversi_factor || 1)} ${satuanKecilName}`
                        : "No conversion"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Storage Condition</p>
                    <p className="font-medium text-gray-900">{storageLabel}</p>
                  </div>
                </div>
                {material.shelf_life_days && (
                  <div>
                    <p className="text-sm text-gray-500">Shelf Life</p>
                    <p className="font-medium text-gray-900">{material.shelf_life_days} days</p>
                  </div>
                )}
                {(material.coa_production || material.coa_rnd || material.coa_asset) && (
                  <div className="border-t border-gray-200/70 pt-4">
                    <p className="mb-2 text-sm text-gray-500">Chart of Accounts</p>
                    <div className="flex flex-wrap gap-2">
                      {material.coa_production && (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                          Production: {material.coa_production}
                        </Badge>
                      )}
                      {material.coa_rnd && (
                        <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
                          Research and Development: {material.coa_rnd}
                        </Badge>
                      )}
                      {material.coa_asset && (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                          Asset: {material.coa_asset}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Stock Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-gray-500">Minimum</span>
                  <span className="font-medium text-gray-900">
                    {formatNumber(material.stok_minimum)} {satuanBesarName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Maximum</span>
                  <span className="font-medium text-gray-900">
                    {formatNumber(material.stok_maximum)} {satuanBesarName}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="stock">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Real-time Stock and Price</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <p className="text-sm text-gray-500">Quantity On Hand</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatNumber(material.qty_onhand)} {satuanBesarName}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Quantity Reserved</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatNumber(material.qty_reserved)} {satuanBesarName}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Quantity On Order</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {formatNumber(material.qty_on_order)} {satuanBesarName}
                  </p>
                </div>
              </div>
              <div className="border-t border-gray-200/70 pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Average Cost</span>
                  <span className="text-xl font-semibold text-gray-900">
                    {(material.avg_cost ?? 0) > 0 ? formatAmount(material.avg_cost) : "-"}
                  </span>
                </div>
                {(material.harga_beli ?? 0) > 0 && (
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-gray-500">Purchase Price</span>
                    <span className="text-lg font-medium text-gray-900">
                      {formatAmount(material.harga_beli)} / {satuanBesarName}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversions" className="space-y-4">
          <Card className="border-gray-200/70 shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base">Unit Conversions</CardTitle>
                  <p className="mt-1 text-sm text-gray-500">
                    Units available for purchasing, price lists, and stock reference.
                  </p>
                </div>
                <Link href={`${ITEMS_RAW_MATERIALS_PATH}/edit/${material.id}`}>
                  <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
                    <Edit className="mr-2 h-4 w-4" />
                    Edit Conversions
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Base Stock Unit</p>
                  <p className="mt-2 text-lg font-bold text-gray-900">
                    {baseConversion ? getConversionUnitName(baseConversion) : baseUnitLabel}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    Base conversion value is always calculated as 1 {baseUnitLabel}.
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Primary Conversion</p>
                  <p className="mt-2 text-lg font-bold text-gray-900">
                    {material.satuan_kecil_id
                      ? `1 ${satuanBesarName} = ${formatNumber(material.konversi_factor || 1)} ${baseUnitLabel}`
                      : `1 ${satuanBesarName} = 1 ${baseUnitLabel}`}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    Derived from the large unit and primary conversion factor.
                  </p>
                </div>
              </div>

              {alternativeConversions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200/70 bg-white px-4 py-8 text-center">
                  <p className="text-sm font-medium text-gray-700">No alternative units yet</p>
                  <p className="mt-1 text-sm text-gray-500">
                    Add alternative units on the edit page when suppliers sell this material in different units.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto px-0">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200/70 text-xs uppercase tracking-wide text-gray-500">
                        <th className="px-4 py-3 text-left font-semibold">Unit</th>
                        <th className="px-4 py-3 text-left font-semibold">Quantity in Base Unit</th>
                        <th className="px-4 py-3 text-left font-semibold">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200/70">
                      {alternativeConversions.map((conversion) => (
                        <tr key={conversion.id || conversion.satuan_id} className="hover:bg-gray-50/80">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-gray-900">{getConversionUnitName(conversion)}</div>
                            <div className="text-xs text-gray-500">{getConversionUnitLabel(conversion)}</div>
                          </td>
                          <td className="px-4 py-3 font-mono font-semibold text-gray-900">
                            {formatNumber(conversion.qty_in_base_unit)} {baseUnitLabel}
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            1 {getConversionUnitLabel(conversion)} = {formatNumber(conversion.qty_in_base_unit)}{" "}
                            {baseUnitLabel}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Delete Raw Material?"
        description={`Are you sure you want to delete "${material.nama}"? The record will be hidden from the list. Materials with stock or active bill of materials usage cannot be deleted.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loadingLabel="Deleting..."
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
