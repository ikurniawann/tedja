"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { NumericInput } from "@/components/ui/numeric-input";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PurchasingFormHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { RM_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { formatAmount } from "@/lib/purchasing/utils";
import { useRawMaterialBomEditorData } from "../queries";
import {
  createRawMaterialBomItem,
  deleteRawMaterialBomItem,
  updateRawMaterialBomItem,
} from "../api";
import type { RawMaterialWithStock } from "@/types/purchasing";

type BomDraft = {
  id: string;
  raw_material_id: string;
  qty_required: number;
  waste_factor: number;
  cost_per_unit: number;
  total_cost: number;
  persisted: boolean;
};

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function displayName(value?: string | null) {
  return (value || "-").replace(/\s+\d{8,}$/g, "").trim();
}

function getMaterialUnitCost(material?: RawMaterialWithStock) {
  const baseCost = toNumber(material?.avg_cost ?? material?.harga_avg ?? material?.harga_terakhir);
  const factor = toNumber(material?.konversi_factor);
  if (material?.satuan_kecil_id && factor > 0) return baseCost / factor;
  return baseCost;
}

function mapBomItem(item: {
  id: string;
  raw_material_id?: string;
  component_raw_material_id?: string;
  qty_required?: number;
  waste_factor?: number;
  cost_per_unit?: number;
  total_cost?: number;
}): BomDraft {
  const qtyRequired = toNumber(item.qty_required);
  const wasteFactor = toNumber(item.waste_factor);
  const costPerUnit = toNumber(item.cost_per_unit);
  return {
    id: item.id,
    raw_material_id: item.raw_material_id || item.component_raw_material_id || "",
    qty_required: qtyRequired,
    waste_factor: wasteFactor,
    cost_per_unit: costPerUnit,
    total_cost: toNumber(item.total_cost) || costPerUnit * qtyRequired * (1 + wasteFactor),
    persisted: true,
  };
}

export function RawMaterialBomEditorPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const materialId = id as string;
  const fromProduction = searchParams.get("from") === "production";

  const [bomItems, setBomItems] = useState<BomDraft[]>([]);
  const [savingAll, setSavingAll] = useState(false);

  const editorQuery = useRawMaterialBomEditorData(materialId);
  const material = editorQuery.data?.material ?? null;
  const materials = useMemo<RawMaterialWithStock[]>(
    () => editorQuery.data?.materials ?? [],
    [editorQuery.data]
  );

  const materialMap = useMemo(
    () => new Map(materials.map((item) => [item.id, item])),
    [materials]
  );

  const totalHpp = bomItems.reduce((sum, item) => sum + item.total_cost, 0);

  useEffect(() => {
    if (editorQuery.isError) {
      toast.error(
        editorQuery.error instanceof Error
          ? editorQuery.error.message
          : "Failed to load bill of materials"
      );
    }
  }, [editorQuery.isError, editorQuery.error]);

  useEffect(() => {
    const bomData = editorQuery.data?.bom;
    if (!bomData) return;
    setBomItems(bomData.map((item) => recalculate(mapBomItem(item))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorQuery.data]);

  function recalculate(item: BomDraft, componentId = item.raw_material_id) {
    const component = materialMap.get(componentId);
    const costPerUnit = getMaterialUnitCost(component);
    return {
      ...item,
      raw_material_id: componentId,
      cost_per_unit: costPerUnit,
      total_cost: costPerUnit * item.qty_required * (1 + item.waste_factor),
    };
  }

  function addItem() {
    setBomItems((items) => [
      ...items,
      recalculate({
        id: crypto.randomUUID(),
        raw_material_id: "",
        qty_required: 1,
        waste_factor: 0,
        cost_per_unit: 0,
        total_cost: 0,
        persisted: false,
      }),
    ]);
  }

  function updateItem(id: string, changes: Partial<BomDraft>) {
    setBomItems((items) =>
      items.map((item) =>
        item.id === id ? recalculate({ ...item, ...changes }, changes.raw_material_id) : item
      )
    );
  }

  async function saveItem(item: BomDraft, options?: { silent?: boolean }) {
    if (!item.raw_material_id) throw new Error("Component raw material is required");
    if (item.qty_required <= 0) throw new Error("Quantity must be greater than 0");

    if (item.persisted) {
      await updateRawMaterialBomItem(item.id, {
        qty_required: item.qty_required,
        waste_factor: item.waste_factor,
      });
    } else {
      const created = await createRawMaterialBomItem(materialId, {
        component_raw_material_id: item.raw_material_id,
        qty_required: item.qty_required,
        waste_factor: item.waste_factor,
      });
      setBomItems((items) =>
        items.map((current) => (current.id === item.id ? mapBomItem(created) : current))
      );
    }

    if (!options?.silent) {
      toast.success("Bill of materials saved");
      await editorQuery.refetch();
    }
  }

  async function removeItem(item: BomDraft) {
    if (!item.persisted) {
      setBomItems((items) => items.filter((current) => current.id !== item.id));
      return;
    }

    await deleteRawMaterialBomItem(item.id);
    setBomItems((items) => items.filter((current) => current.id !== item.id));
    toast.success("Component removed");
  }

  async function saveAll() {
    if (bomItems.length === 0) return;
    setSavingAll(true);
    try {
      for (const item of bomItems) {
        await saveItem(item, { silent: true });
      }
      toast.success("Bill of materials saved");
      await editorQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save bill of materials");
    } finally {
      setSavingAll(false);
    }
  }

  if (editorQuery.isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading bill of materials...
      </div>
    );
  }

  const backHref = fromProduction
    ? RM_ROUTES.productionRecipes
    : RM_ROUTES.materialsDetail(materialId);

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={backHref}
        title="Raw Material Bill of Materials"
        description={
          <>
            {displayName(material?.nama)} · Total estimated COGS {formatAmount(totalHpp)}
          </>
        }
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => editorQuery.refetch()}
            disabled={editorQuery.isFetching}
            className="purchasing-secondary-button w-full sm:w-auto"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${editorQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="flex flex-row items-start justify-between border-b border-gray-200/70 pb-3">
          <div>
            <CardTitle className="text-base">Component Materials</CardTitle>
            <p className="mt-1 text-xs text-gray-500">
              Define which raw materials are consumed to produce this output material.
            </p>
          </div>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addItem}
              className="border-pink-200 text-pink-700 hover:bg-pink-50"
            >
              <Plus className="mr-1 h-4 w-4" />
              Add Component
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="overflow-x-auto rounded-lg border border-gray-200/70">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Component</th>
                  <th className="w-[170px] px-4 py-3 text-left font-semibold">Qty</th>
                  <th className="w-[140px] px-4 py-3 text-left font-semibold">Waste (%)</th>
                  <th className="w-[140px] px-4 py-3 text-right font-semibold">Unit Cost</th>
                  <th className="w-[140px] px-4 py-3 text-right font-semibold">Subtotal</th>
                  <th className="w-[56px] px-4 py-3" aria-label="Remove" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bomItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-gray-400">
                      No components yet. Click &quot;Add Component&quot; to get started.
                    </td>
                  </tr>
                ) : (
                  bomItems.map((item) => {
                    const options = materials.map((component) => ({
                      value: component.id,
                      label: `${displayName(component.nama)} (${component.kode || "-"})`,
                    }));

                    return (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-gray-500">Component</Label>
                            <Combobox
                              options={options}
                              value={item.raw_material_id}
                              onChange={(value) => updateItem(item.id, { raw_material_id: value })}
                              placeholder="Select component..."
                              searchPlaceholder="Search raw material..."
                              emptyMessage="No raw material found"
                              className="w-full! h-9 text-sm"
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 align-bottom">
                          <NumericInput
                            value={item.qty_required}
                            onValueChange={(value) =>
                              updateItem(item.id, { qty_required: toNumber(value) })
                            }
                            className="h-9 text-sm"
                          />
                        </td>
                        <td className="px-4 py-3 align-bottom">
                          <NumericInput
                            value={item.waste_factor * 100}
                            onValueChange={(value) =>
                              updateItem(item.id, { waste_factor: toNumber(value) / 100 })
                            }
                            className="h-9 text-sm"
                          />
                        </td>
                        <td className="px-4 py-3 text-right align-bottom font-medium">
                          {formatAmount(item.cost_per_unit)}
                        </td>
                        <td className="px-4 py-3 text-right align-bottom font-semibold text-pink-700">
                          {formatAmount(item.total_cost)}
                        </td>
                        <td className="px-4 py-3 text-right align-bottom">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeItem(item)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={saveAll}
              disabled={savingAll || bomItems.length === 0}
              className="purchasing-main-button"
            >
              {savingAll ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Bill of Materials"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
