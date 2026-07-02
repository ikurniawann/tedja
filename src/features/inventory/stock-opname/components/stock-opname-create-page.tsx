"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { DsDateTimePicker } from "@/components/design-system";
import {
  PurchasingFormHeader,
} from "@/modules/purchasing/components/page/purchasing-page-header";
import {
  baseQtyFromInput,
  convertQtyInputBetweenModes,
  displayQtyInputFromBase,
  toDisplayQty,
  type RawMaterialUnitInfo,
  type RawMaterialUnitMode,
} from "@/lib/inventory/raw-material-units";
import { RM_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { RawMaterialUnitSelect } from "./raw-material-unit-select";
import { useStockOpname, useStockOpnamePreview, useStockOpnameWarehouses } from "../queries";
import {
  useCompleteStockOpname,
  useCreateStockOpname,
  useUpdateStockOpname,
} from "../mutations";
import { toast } from "sonner";

function formatQty(value: number | null | undefined) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

type CountLine = {
  key: string;
  lineId?: string;
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  satuan: string | null;
  satuan_besar_nama: string | null;
  satuan_kecil_nama: string | null;
  konversi_factor: number | null;
  input_unit_mode: RawMaterialUnitMode;
  qty_system: number;
  qty_counted_input: string;
};

function lineUnitInfo(line: CountLine): RawMaterialUnitInfo {
  return {
    satuan: line.satuan,
    satuan_besar_nama: line.satuan_besar_nama,
    satuan_kecil_nama: line.satuan_kecil_nama,
    konversi_factor: line.konversi_factor,
  };
}

interface StockOpnameCreatePageProps {
  opnameId?: string;
}

export function StockOpnameCreatePage({ opnameId }: StockOpnameCreatePageProps) {
  const router = useRouter();
  const isContinue = Boolean(opnameId);

  const warehousesQuery = useStockOpnameWarehouses();
  const detailQuery = useStockOpname(opnameId || "");
  const createMutation = useCreateStockOpname();
  const updateMutation = useUpdateStockOpname();
  const completeMutation = useCompleteStockOpname();

  const [warehouseId, setWarehouseId] = useState("");
  const [opnameDate, setOpnameDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [lines, setLines] = useState<CountLine[]>([]);
  const [initialized, setInitialized] = useState(false);

  const previewQuery = useStockOpnamePreview(
    !isContinue && warehouseId ? warehouseId : ""
  );

  const detail = detailQuery.data;
  const isEditableContinue =
    isContinue &&
    (detail?.status === "draft" || detail?.status === "in_progress");

  const isBusy =
    createMutation.isPending || updateMutation.isPending || completeMutation.isPending;

  const warehouseOptions = (warehousesQuery.data || []).map((w) => ({
    value: w.id,
    label: w.name,
    description: w.code,
  }));

  const selectedWarehouse = warehouseOptions.find((w) => w.value === warehouseId);

  useEffect(() => {
    if (!isContinue || !detail || initialized) return;

    if (detail.status === "completed" || detail.status === "cancelled") {
      router.replace(RM_ROUTES.inventoryOpnameDetail(detail.id));
      return;
    }

    setWarehouseId(detail.warehouse_id || "");
    setOpnameDate(detail.opname_date?.slice(0, 10) || opnameDate);
    setNotes(detail.notes || "");
    setLines(
      (detail.lines || []).map((line) => ({
        key: line.id,
        lineId: line.id,
        raw_material_id: line.raw_material_id,
        material_kode: line.material_kode || "",
        material_nama: line.material_nama || "",
        satuan: line.satuan ?? null,
        satuan_besar_nama: line.satuan_besar_nama ?? line.satuan ?? null,
        satuan_kecil_nama: line.satuan_kecil_nama ?? null,
        konversi_factor: line.konversi_factor ?? null,
        input_unit_mode: "besar",
        qty_system: line.qty_system,
        qty_counted_input: displayQtyInputFromBase(line.qty_counted, "besar", {
          satuan: line.satuan,
          satuan_besar_nama: line.satuan_besar_nama ?? line.satuan,
          satuan_kecil_nama: line.satuan_kecil_nama,
          konversi_factor: line.konversi_factor,
        }),
      }))
    );
    setInitialized(true);
  }, [isContinue, detail, initialized, router, opnameDate]);

  useEffect(() => {
    if (isContinue || !warehouseId || previewQuery.isLoading) return;

    const items = previewQuery.data ?? [];
    setLines(
      items.map((item) => ({
        key: item.raw_material_id,
        raw_material_id: item.raw_material_id,
        material_kode: item.material_kode,
        material_nama: item.material_nama,
        satuan: item.satuan,
        satuan_besar_nama: item.satuan_besar_nama ?? item.satuan ?? null,
        satuan_kecil_nama: item.satuan_kecil_nama ?? null,
        konversi_factor: item.konversi_factor ?? null,
        input_unit_mode: "besar",
        qty_system: item.qty_system,
        qty_counted_input: "",
      }))
    );
  }, [isContinue, warehouseId, previewQuery.data, previewQuery.isLoading]);

  const filteredLines = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (line) =>
        line.material_nama.toLowerCase().includes(q) ||
        line.material_kode.toLowerCase().includes(q)
    );
  }, [lines, itemSearch]);

  const progress = useMemo(() => {
    const counted = lines.filter((line) => line.qty_counted_input !== "").length;
    const variance = lines.filter((line) => {
      if (line.qty_counted_input === "") return false;
      const base = baseQtyFromInput(
        line.qty_counted_input,
        line.input_unit_mode,
        lineUnitInfo(line)
      );
      return base !== null && base !== line.qty_system;
    }).length;
    return { counted, variance, total: lines.length };
  }, [lines]);

  const hasItems = lines.length > 0;
  const isPreviewLoading = !isContinue && !!warehouseId && previewQuery.isLoading;

  const handleWarehouseChange = (value: string) => {
    setWarehouseId(value);
    setItemSearch("");
    setLines([]);
  };

  const handleLineChange = (key: string, value: string) => {
    setLines((prev) =>
      prev.map((line) =>
        line.key === key ? { ...line, qty_counted_input: value } : line
      )
    );
  };

  const handleRowUnitModeChange = (key: string, next: RawMaterialUnitMode) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== key || line.input_unit_mode === next) return line;
        return {
          ...line,
          input_unit_mode: next,
          qty_counted_input: convertQtyInputBetweenModes(
            line.qty_counted_input,
            line.input_unit_mode,
            next,
            lineUnitInfo(line)
          ),
        };
      })
    );
  };

  const handleFillSystem = () => {
    setLines((prev) =>
      prev.map((line) => ({
        ...line,
        qty_counted_input: displayQtyInputFromBase(
          line.qty_system,
          line.input_unit_mode,
          lineUnitInfo(line)
        ),
      }))
    );
  };

  const resolveBaseQty = (line: CountLine): number | null =>
    baseQtyFromInput(line.qty_counted_input, line.input_unit_mode, lineUnitInfo(line));

  const validateQtyInputs = (requireAll: boolean) => {
    if (requireAll) {
      const uncounted = lines.filter((line) => line.qty_counted_input === "");
      if (uncounted.length > 0) {
        toast.error(`${uncounted.length} line(s) have not been counted yet`);
        return false;
      }
    }

    const invalid = lines.find((line) => {
      if (line.qty_counted_input === "") return false;
      const n = Number(line.qty_counted_input);
      return !Number.isFinite(n) || n < 0;
    });
    if (invalid) {
      toast.error("Physical quantity must be a number greater than or equal to zero");
      return false;
    }
    return true;
  };

  const buildLineUpdates = (lineRecords: { id: string; raw_material_id: string }[]) => {
    const byMaterial = new Map(lineRecords.map((l) => [l.raw_material_id, l.id]));
    return lines
      .filter((line) => line.qty_counted_input !== "")
      .map((line) => {
        const baseQty = resolveBaseQty(line);
        return {
          id: line.lineId || byMaterial.get(line.raw_material_id)!,
          qty_counted: baseQty ?? 0,
        };
      })
      .filter((line) => line.id);
  };

  const handleSaveDraft = async () => {
    if (!warehouseId) {
      toast.error("Please select a warehouse first");
      return;
    }
    if (!hasItems) {
      toast.error("No raw materials available for stock opname");
      return;
    }
    if (!validateQtyInputs(false)) return;

    try {
      if (isContinue && opnameId) {
        await updateMutation.mutateAsync({
          id: opnameId,
          input: {
            notes: notes.trim() || undefined,
            lines: lines.map((line) => ({
              id: line.lineId!,
              qty_counted: resolveBaseQty(line),
            })),
          },
        });
        toast.success("Stock opname draft saved");
        return;
      }

      const created = await createMutation.mutateAsync({
        warehouse_id: warehouseId,
        opname_date: opnameDate,
        notes: notes.trim() || undefined,
        reason: "stock_opname",
      });

      const updates = buildLineUpdates(
        (created.lines || []).map((l) => ({
          id: l.id,
          raw_material_id: l.raw_material_id,
        }))
      );

      if (updates.length > 0) {
        await updateMutation.mutateAsync({
          id: created.id,
          input: { lines: updates },
        });
      }

      toast.success("Stock opname draft saved");
      router.replace(RM_ROUTES.inventoryOpnameContinue(created.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save draft");
    }
  };

  const handleComplete = async () => {
    if (!warehouseId) {
      toast.error("Please select a warehouse first");
      return;
    }
    if (!hasItems) {
      toast.error("No raw materials available for stock opname");
      return;
    }
    if (!validateQtyInputs(true)) return;

    try {
      let sessionId = opnameId;

      if (!sessionId) {
        const created = await createMutation.mutateAsync({
          warehouse_id: warehouseId,
          opname_date: opnameDate,
          notes: notes.trim() || undefined,
          reason: "stock_opname",
        });
        sessionId = created.id;

        await updateMutation.mutateAsync({
          id: sessionId,
          input: {
            lines: lines.map((line) => {
              const createdLine = created.lines?.find(
                (l) => l.raw_material_id === line.raw_material_id
              );
              if (!createdLine) {
                throw new Error(`Line not found for ${line.material_kode}`);
              }
              return {
                id: createdLine.id,
                qty_counted: resolveBaseQty(line) ?? 0,
              };
            }),
          },
        });
      } else {
        await updateMutation.mutateAsync({
          id: sessionId,
          input: {
            notes: notes.trim() || undefined,
            lines: lines.map((line) => ({
              id: line.lineId!,
              qty_counted: resolveBaseQty(line) ?? 0,
            })),
          },
        });
      }

      await completeMutation.mutateAsync(sessionId);
      toast.success("Stock opname completed and inventory has been adjusted");
      router.push(RM_ROUTES.inventoryOpnameDetail(sessionId!));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to complete stock opname"
      );
    }
  };

  const handleCancel = async () => {
    if (!opnameId || !window.confirm("Cancel this stock opname session?")) return;
    try {
      await updateMutation.mutateAsync({
        id: opnameId,
        input: { status: "cancelled" },
      });
      toast.success("Stock opname cancelled");
      router.push(RM_ROUTES.inventoryOpname);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel session");
    }
  };

  if (isContinue && detailQuery.isLoading) {
    return (
      <div className="py-16 text-center text-sm text-gray-400">
        Loading stock opname session...
      </div>
    );
  }

  if (isContinue && !isEditableContinue && detail) {
    return null;
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={RM_ROUTES.inventoryOpname}
        title={isContinue ? "Continue Stock Opname" : "Create Stock Opname"}
        description="Select a warehouse, enter physical quantities, then save as draft or complete the opname"
        actions={
          hasItems ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="purchasing-secondary-button"
                onClick={handleFillSystem}
                disabled={isBusy}
              >
                Fill with System Stock
              </Button>
              {isContinue && (
                <Button
                  type="button"
                  variant="outline"
                  className="border-red-200/80 text-red-700"
                  onClick={handleCancel}
                  disabled={isBusy}
                >
                  Cancel Session
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="purchasing-secondary-button"
                onClick={handleSaveDraft}
                disabled={isBusy || !warehouseId}
              >
                {updateMutation.isPending && !completeMutation.isPending
                  ? "Saving..."
                  : "Save Draft"}
              </Button>
              <Button
                type="button"
                className="purchasing-main-button"
                onClick={handleComplete}
                disabled={isBusy || !warehouseId}
              >
                {completeMutation.isPending ? "Processing..." : "Complete Opname"}
              </Button>
            </>
          ) : undefined
        }
      />

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Opname Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="min-w-0 space-y-1.5 md:col-span-4">
              <Label className="text-xs">
                Warehouse <span className="text-red-500">*</span>
              </Label>
              <Combobox
                value={warehouseId}
                onChange={handleWarehouseChange}
                options={warehouseOptions}
                placeholder={
                  warehousesQuery.isLoading ? "Loading warehouses..." : "Select warehouse"
                }
                disabled={warehousesQuery.isLoading || isBusy || isContinue}
                className="w-full! h-9 border-gray-200/80 text-sm"
              />
            </div>

            <div className="min-w-0 md:col-span-3">
              <DsDateTimePicker
                label="Opname Date"
                value={opnameDate}
                onChange={setOpnameDate}
                placeholder="Select opname date..."
                dateOnly
                disabled={isBusy}
              />
            </div>

            <div className="min-w-0 space-y-1.5 md:col-span-5">
              <Label htmlFor="notes" className="text-xs">
                Notes
              </Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes (optional)..."
                disabled={isBusy}
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
                <p className="text-xs font-medium text-gray-500">Counted</p>
                <p className="text-lg font-bold text-amber-600">{progress.counted}</p>
              </div>
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-3 py-2">
                <p className="text-xs font-medium text-gray-500">With Variance</p>
                <p className="text-lg font-bold text-pink-600">{progress.variance}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {warehouseId && (
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-0">
            <div className="flex flex-col gap-3 border-b border-gray-200/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  Physical Stock Count
                  {selectedWarehouse ? ` — ${selectedWarehouse.label}` : ""}
                </h2>
                <p className="text-sm text-gray-500">
                  {isPreviewLoading
                    ? "Loading raw materials..."
                    : hasItems
                      ? "Enter physical quantities from the warehouse count"
                      : "No active raw materials in this warehouse branch"}
                </p>
              </div>
              {hasItems && (
                <div className="relative w-full sm:max-w-xs">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    value={itemSearch}
                    onChange={(e) => setItemSearch(e.target.value)}
                    placeholder="Search raw materials..."
                    className="h-10 border-gray-200/80 pl-9"
                    disabled={isBusy}
                  />
                </div>
              )}
            </div>

            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-3">Code</th>
                    <th className="px-3 py-3">Material Name</th>
                    <th className="px-3 py-3">Unit</th>
                    <th className="px-3 py-3 text-right">System Stock</th>
                    <th className="px-3 py-3 text-right">Physical Quantity</th>
                    <th className="px-3 py-3 text-right">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {isPreviewLoading ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-gray-400">
                        Loading items...
                      </td>
                    </tr>
                  ) : filteredLines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-gray-400">
                        {hasItems
                          ? "No items match your search"
                          : "Select a warehouse to load raw materials"}
                      </td>
                    </tr>
                  ) : (
                    filteredLines.map((line) => {
                      const unit = lineUnitInfo(line);
                      const displaySystem = toDisplayQty(
                        line.qty_system,
                        line.input_unit_mode,
                        unit
                      );
                      const counted =
                        line.qty_counted_input === ""
                          ? null
                          : Number(line.qty_counted_input);
                      const variance =
                        counted === null || !Number.isFinite(counted)
                          ? null
                          : counted - displaySystem;

                      return (
                        <tr
                          key={line.key}
                          className="border-b border-gray-200/70 hover:bg-gray-50/80"
                        >
                          <td className="px-3 py-3 font-mono text-xs text-gray-600">
                            {line.material_kode}
                          </td>
                          <td className="px-3 py-3 font-medium text-gray-900">
                            {line.material_nama}
                          </td>
                          <td className="px-3 py-3">
                            <RawMaterialUnitSelect
                              info={unit}
                              value={line.input_unit_mode}
                              onChange={(mode) => handleRowUnitModeChange(line.key, mode)}
                              disabled={isBusy}
                            />
                          </td>
                          <td className="px-3 py-3 text-right text-gray-700">
                            {formatQty(displaySystem)}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              value={line.qty_counted_input}
                              onChange={(e) =>
                                handleLineChange(line.key, e.target.value)
                              }
                              disabled={isBusy}
                              className="ml-auto h-9 w-28 border-gray-200/80 text-right"
                              placeholder="—"
                            />
                          </td>
                          <td className="px-3 py-3 text-right">
                            {variance === null ? (
                              <span className="text-gray-400">—</span>
                            ) : variance === 0 ? (
                              <span className="text-emerald-600">0</span>
                            ) : variance > 0 ? (
                              <span className="font-medium text-emerald-600">
                                +{formatQty(variance)}
                              </span>
                            ) : (
                              <span className="font-medium text-red-600">
                                {formatQty(variance)}
                              </span>
                            )}
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
      )}
    </div>
  );
}
