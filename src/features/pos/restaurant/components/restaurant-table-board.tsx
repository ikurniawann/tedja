"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  FloorPlanCanvas,
  type FloorPlanNode,
} from "@/features/pos/tables/components/floor-plan-canvas";
import { floorLabel, floorSortKey } from "@/features/pos/tables/floor-options";
import { buildCashierHandoffUrl } from "@/features/pos/restaurant/nav";
import {
  canPickMergeDestination,
  canPickSeatDestination,
  canPickTransferDestination,
} from "@/features/pos/restaurant/move-destination";
import type { PosTable } from "@/lib/pos-api";

export type RestaurantBoardMode =
  | "move"
  | "transfer"
  | "merge"
  | "seat"
  | null;

interface TableFloorGroup {
  floorKey: string;
  label: string;
  tables: PosTable[];
}

function getTableDisplayName(table: PosTable) {
  return table.label || table.table_number || table.name || "Table";
}

function groupTablesByFloor(tables: PosTable[]): TableFloorGroup[] {
  const map = new Map<string, PosTable[]>();
  for (const table of tables) {
    const key = String(table.floor ?? "").trim();
    const list = map.get(key) ?? [];
    list.push(table);
    map.set(key, list);
  }

  return [...map.entries()]
    .sort(([a], [b]) => floorSortKey(a) - floorSortKey(b))
    .map(([floorKey, groupTables]) => ({
      floorKey,
      label: floorLabel(floorKey),
      tables: [...groupTables].sort((a, b) =>
        getTableDisplayName(a).localeCompare(getTableDisplayName(b), undefined, {
          numeric: true,
        })
      ),
    }));
}

function toNode(table: PosTable): FloorPlanNode {
  return {
    id: table.id,
    table_number: getTableDisplayName(table),
    capacity: table.capacity,
    status: table.status,
    is_active: table.is_active,
    pos_x: table.pos_x,
    pos_y: table.pos_y,
  };
}

function canPickForMode(
  mode: RestaurantBoardMode,
  table: PosTable,
  sourceTableId?: string | null
) {
  const opts = { sourceTableId };
  if (mode === "move" || mode === "seat") {
    return canPickSeatDestination(table, opts);
  }
  if (mode === "transfer") return canPickTransferDestination(table, opts);
  if (mode === "merge") return canPickMergeDestination(table, opts);
  return false;
}

function modeHint(mode: RestaurantBoardMode) {
  if (mode === "move") return " · tap available to move";
  if (mode === "seat") return " · tap available to seat";
  if (mode === "transfer") return " · tap a table for items";
  if (mode === "merge") return " · tap occupied to merge";
  return "";
}

function pickBlockedMessage(mode: RestaurantBoardMode) {
  if (mode === "move" || mode === "seat") return "Choose an available table.";
  if (mode === "transfer") return "Choose an available or occupied table.";
  if (mode === "merge") return "Choose an occupied table.";
  return "Choose a destination table.";
}

export interface RestaurantTableBoardProps {
  tables: PosTable[];
  isLoading?: boolean;
  error?: string | null;
  selectedTableId?: string | null;
  immersive?: boolean;
  boardMode?: RestaurantBoardMode;
  /** @deprecated use boardMode */
  moveMode?: boolean;
  busy?: boolean;
  moving?: boolean;
  sourceTableId?: string | null;
  onSelectOccupied: (table: PosTable) => void;
  onOpenAvailable?: (table: PosTable) => void;
  onPickDestination?: (table: PosTable) => void;
}

export function RestaurantTableBoard({
  tables,
  isLoading,
  error,
  selectedTableId,
  immersive = false,
  boardMode = null,
  moveMode = false,
  busy = false,
  moving = false,
  sourceTableId = null,
  onSelectOccupied,
  onOpenAvailable,
  onPickDestination,
}: RestaurantTableBoardProps) {
  const router = useRouter();
  const floors = groupTablesByFloor(tables);
  const tablesById = new Map(tables.map((table) => [table.id, table]));
  const mode: RestaurantBoardMode = boardMode ?? (moveMode ? "move" : null);
  const isBusy = busy || moving;
  const inBoardMode = mode != null;

  const handlePick = (table: PosTable) => {
    if (!inBoardMode || isBusy) return;
    if (!canPickForMode(mode, table, sourceTableId)) {
      toast.message(pickBlockedMessage(mode));
      return;
    }
    onPickDestination?.(table);
  };

  const handleAvailableClick = (table: PosTable) => {
    if (inBoardMode) {
      handlePick(table);
      return;
    }
    onOpenAvailable?.(table);
    router.push(buildCashierHandoffUrl({ tableId: table.id, immersive }));
  };

  const handleOccupiedDoubleClick = (table: PosTable) => {
    if (inBoardMode || isBusy) return;
    if (table.active_order?.id) {
      router.push(
        buildCashierHandoffUrl({
          orderId: table.active_order.id,
          tableId: table.id,
          immersive,
        })
      );
      return;
    }
    toast.error("This table has no active order to open.");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          className="border-gray-200/70 sm:flex-1"
          disabled={inBoardMode || isBusy}
          onClick={() =>
            router.push(buildCashierHandoffUrl({ orderType: "dine_in", immersive }))
          }
        >
          Without Table
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-gray-200/70 sm:flex-1"
          disabled={inBoardMode || isBusy}
          onClick={() =>
            router.push(buildCashierHandoffUrl({ orderType: "takeaway", immersive }))
          }
        >
          Take Away
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200/70 bg-gray-50/80 p-4 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading tables...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200/80 bg-red-50 p-4 text-sm font-medium text-red-600">
          {error}
        </div>
      ) : floors.length === 0 ? (
        <div className="rounded-lg border border-gray-200/70 bg-gray-50/80 p-4 text-sm text-gray-500">
          No active tables found.
        </div>
      ) : (
        <div className="space-y-5">
          {floors.map((group) => (
            <section
              key={group.floorKey || "__unassigned"}
              className="overflow-hidden rounded-xl border border-gray-200/70 bg-white"
            >
              <div className="flex items-center justify-between gap-3 border-b border-gray-200/70 px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    {group.label}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {group.tables.length} table
                    {group.tables.length === 1 ? "" : "s"}
                    {modeHint(mode)}
                  </p>
                </div>
              </div>
              <div className="p-3">
                <FloorPlanCanvas
                  mode="operate"
                  tables={group.tables.map(toNode)}
                  selectedId={selectedTableId}
                  isDisabled={(node) => {
                    const table = tablesById.get(node.id);
                    if (!table) return true;
                    if (inBoardMode) {
                      return (
                        isBusy || !canPickForMode(mode, table, sourceTableId)
                      );
                    }
                    return (
                      table.status !== "available" &&
                      table.status !== "occupied" &&
                      table.status !== "billing"
                    );
                  }}
                  onActivate={(node) => {
                    const table = tablesById.get(node.id);
                    if (!table) return;
                    if (inBoardMode) {
                      handlePick(table);
                      return;
                    }
                    if (table.status === "available") {
                      handleAvailableClick(table);
                    } else if (
                      table.status === "occupied" ||
                      table.status === "billing"
                    ) {
                      onSelectOccupied(table);
                    }
                  }}
                  onDoubleClick={(node) => {
                    if (inBoardMode || isBusy) return;
                    const table = tablesById.get(node.id);
                    if (
                      !table ||
                      (table.status !== "occupied" &&
                        table.status !== "billing")
                    ) {
                      return;
                    }
                    handleOccupiedDoubleClick(table);
                  }}
                />
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
