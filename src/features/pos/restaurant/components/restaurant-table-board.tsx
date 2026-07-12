"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { floorLabel, floorSortKey } from "@/features/pos/tables/floor-options";
import { buildCashierHandoffUrl } from "@/features/pos/restaurant/nav";
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

const STATUS_TILE_CLASSES: Record<string, string> = {
  available:
    "border-gray-200/70 bg-white text-gray-800 hover:border-primary/50 hover:bg-primary/5",
  occupied:
    "border-emerald-200/70 bg-emerald-50 text-emerald-800 hover:border-emerald-300",
  reserved: "cursor-not-allowed border-blue-200/70 bg-blue-50 text-blue-800",
  maintenance:
    "cursor-not-allowed border-gray-200/70 bg-slate-50 text-slate-400",
};

const SELECTED_TILE_CLASS = "border-primary bg-primary/10 ring-1 ring-primary/40";

export interface RestaurantTableBoardProps {
  tables: PosTable[];
  isLoading?: boolean;
  error?: string | null;
  selectedTableId?: string | null;
  onSelectOccupied: (table: PosTable) => void;
  onOpenAvailable?: (table: PosTable) => void;
}

export function RestaurantTableBoard({
  tables,
  isLoading,
  error,
  selectedTableId,
  onSelectOccupied,
  onOpenAvailable,
}: RestaurantTableBoardProps) {
  const router = useRouter();
  const floors = groupTablesByFloor(tables);

  const handleAvailableClick = (table: PosTable) => {
    onOpenAvailable?.(table);
    router.push(buildCashierHandoffUrl({ tableId: table.id }));
  };

  const handleOccupiedDoubleClick = (table: PosTable) => {
    if (table.active_order?.id) {
      router.push(
        buildCashierHandoffUrl({ orderId: table.active_order.id, tableId: table.id })
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
          onClick={() => router.push(buildCashierHandoffUrl({ orderType: "dine_in" }))}
        >
          Without Table
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-gray-200/70 sm:flex-1"
          onClick={() => router.push(buildCashierHandoffUrl({ orderType: "takeaway" }))}
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
            <section key={group.floorKey || "__unassigned"} className="space-y-2">
              <div className="flex items-center justify-between gap-2 border-b border-gray-200/70 pb-1.5">
                <h3 className="text-sm font-semibold text-gray-900">{group.label}</h3>
                <span className="text-xs text-gray-500">
                  {group.tables.length} table{group.tables.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {group.tables.map((table) => {
                  const isSelected = selectedTableId === table.id;
                  const isAvailable = table.status === "available";
                  const isOccupied = table.status === "occupied";
                  const isActionable = isAvailable || isOccupied;
                  const tileClass =
                    STATUS_TILE_CLASSES[table.status] ?? STATUS_TILE_CLASSES.available;

                  return (
                    <button
                      key={table.id}
                      type="button"
                      disabled={!isActionable}
                      onClick={() => {
                        if (isAvailable) {
                          handleAvailableClick(table);
                        } else if (isOccupied) {
                          onSelectOccupied(table);
                        }
                      }}
                      onDoubleClick={() => {
                        if (isOccupied) handleOccupiedDoubleClick(table);
                      }}
                      className={`min-h-[84px] rounded-lg border px-3 py-3 text-left transition-all ${
                        isSelected ? SELECTED_TILE_CLASS : tileClass
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-bold">
                          {getTableDisplayName(table)}
                        </span>
                        <Users className="h-4 w-4 shrink-0 opacity-60" />
                      </div>
                      <div className="mt-2 text-[11px] font-medium opacity-70">
                        {table.capacity} seats
                        {table.area ? ` · ${table.area}` : ""}
                      </div>
                      {isOccupied && table.active_order?.order_number ? (
                        <div className="mt-1 truncate text-xs font-semibold opacity-80">
                          {table.active_order.order_number}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
