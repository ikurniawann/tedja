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
import { canPickMoveDestination } from "@/features/pos/restaurant/move-destination";
import type { PosTable } from "@/lib/pos-api";

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

export interface RestaurantTableBoardProps {
  tables: PosTable[];
  isLoading?: boolean;
  error?: string | null;
  selectedTableId?: string | null;
  immersive?: boolean;
  moveMode?: boolean;
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
  moveMode = false,
  moving = false,
  sourceTableId = null,
  onSelectOccupied,
  onOpenAvailable,
  onPickDestination,
}: RestaurantTableBoardProps) {
  const router = useRouter();
  const floors = groupTablesByFloor(tables);
  const tablesById = new Map(tables.map((table) => [table.id, table]));

  const handleAvailableClick = (table: PosTable) => {
    if (moveMode) {
      if (moving) return;
      if (!canPickMoveDestination(table, { sourceTableId })) {
        toast.message("Choose an available table.");
        return;
      }
      onPickDestination?.(table);
      return;
    }
    onOpenAvailable?.(table);
    router.push(buildCashierHandoffUrl({ tableId: table.id, immersive }));
  };

  const handleOccupiedDoubleClick = (table: PosTable) => {
    if (moveMode || moving) return;
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
          disabled={moveMode || moving}
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
          disabled={moveMode || moving}
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
                    {moveMode ? " · tap available to move" : ""}
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
                    if (moveMode) {
                      return (
                        moving ||
                        !canPickMoveDestination(table, { sourceTableId })
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
                    if (moveMode) {
                      handleAvailableClick(table);
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
                    if (moveMode || moving) return;
                    const table = tablesById.get(node.id);
                    if (
                      !table ||
                      (table.status !== "occupied" && table.status !== "billing")
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
