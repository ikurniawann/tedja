"use client";

import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { assignGridPositions, clampPercent, isPlaced } from "../floor-layout";
import { usePatchPosTablePosition } from "../mutations";
import type { PosTableRow } from "../types";

const NODE_W = 88;
const NODE_H = 72;
const CLICK_THRESHOLD_PX = 4;

type Props = {
  tables: PosTableRow[];
  onEdit: (table: PosTableRow) => void;
};

type Point = { x: number; y: number };

type DragState = {
  id: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  moved: boolean;
};

function statusNodeTone(status: string) {
  switch (status) {
    case "available":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "occupied":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "reserved":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "maintenance":
      return "border-slate-200 bg-slate-100 text-slate-600";
    default:
      return "border-gray-200/70 bg-gray-100 text-gray-600";
  }
}

function clampToCanvas(x: number, y: number, rect: { width: number; height: number }): Point {
  const maxX = rect.width > 0 ? Math.max(0, 100 - (NODE_W / rect.width) * 100) : 100;
  const maxY = rect.height > 0 ? Math.max(0, 100 - (NODE_H / rect.height) * 100) : 100;
  return {
    x: clampPercent(Math.min(Math.max(x, 0), maxX)),
    y: clampPercent(Math.min(Math.max(y, 0), maxY)),
  };
}

export function TablesFloorPlan({ tables, onEdit }: Props) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState<Record<string, Point>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const positionMutation = usePatchPosTablePosition();

  const basePositions = useMemo(() => {
    const unplacedIds = tables
      .filter((t) => !isPlaced(t.pos_x, t.pos_y))
      .map((t) => t.id);
    const grid = assignGridPositions(unplacedIds);
    const map: Record<string, Point> = {};
    tables.forEach((t) => {
      if (isPlaced(t.pos_x, t.pos_y)) {
        map[t.id] = {
          x: clampPercent(t.pos_x as number),
          y: clampPercent(t.pos_y as number),
        };
      } else {
        const g = grid[t.id];
        map[t.id] = g ? { x: g.pos_x, y: g.pos_y } : { x: 4, y: 4 };
      }
    });
    return map;
  }, [tables]);

  function resolvePosition(id: string): Point {
    return dragging[id] ?? basePositions[id] ?? { x: 4, y: 4 };
  }

  function handlePointerDown(
    e: ReactPointerEvent<HTMLDivElement>,
    table: PosTableRow
  ) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = resolvePosition(table.id);
    dragStateRef.current = {
      id: table.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: start.x,
      startY: start.y,
      moved: false,
    };
  }

  function handlePointerMove(
    e: ReactPointerEvent<HTMLDivElement>,
    table: PosTableRow
  ) {
    const ds = dragStateRef.current;
    if (!ds || ds.id !== table.id || ds.pointerId !== e.pointerId) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;

    const dxPx = e.clientX - ds.startClientX;
    const dyPx = e.clientY - ds.startClientY;
    if (!ds.moved && Math.hypot(dxPx, dyPx) > CLICK_THRESHOLD_PX) {
      ds.moved = true;
    }

    const deltaXPercent = (dxPx / rect.width) * 100;
    const deltaYPercent = (dyPx / rect.height) * 100;
    const next = clampToCanvas(
      ds.startX + deltaXPercent,
      ds.startY + deltaYPercent,
      rect
    );
    setDragging((prev) => ({ ...prev, [table.id]: next }));
  }

  async function handlePointerUp(
    e: ReactPointerEvent<HTMLDivElement>,
    table: PosTableRow
  ) {
    const ds = dragStateRef.current;
    if (!ds || ds.id !== table.id || ds.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // pointer capture may already be released
    }
    dragStateRef.current = null;

    if (!ds.moved) {
      setDragging((prev) => {
        const { [table.id]: _omit, ...rest } = prev;
        return rest;
      });
      onEdit(table);
      return;
    }

    const finalPos = dragging[table.id] ?? { x: ds.startX, y: ds.startY };
    setSavingId(table.id);
    try {
      const res = await positionMutation.mutateAsync({
        id: table.id,
        pos_x: finalPos.x,
        pos_y: finalPos.y,
      });
      toast.success(res.message || "Posisi meja disimpan");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Gagal menyimpan posisi meja"
      );
    } finally {
      setSavingId(null);
      setDragging((prev) => {
        const { [table.id]: _omit, ...rest } = prev;
        return rest;
      });
    }
  }

  function handlePointerCancel(
    e: ReactPointerEvent<HTMLDivElement>,
    table: PosTableRow
  ) {
    const ds = dragStateRef.current;
    if (!ds || ds.id !== table.id || ds.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // pointer capture may already be released
    }
    dragStateRef.current = null;
    setDragging((prev) => {
      const { [table.id]: _omit, ...rest } = prev;
      return rest;
    });
  }

  return (
    <div
      ref={canvasRef}
      className="relative min-h-[480px] w-full overflow-hidden rounded-xl border border-gray-200/70 bg-gray-50"
    >
      {tables.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
          Belum ada meja untuk ditampilkan di denah
        </div>
      ) : null}
      {tables.map((table) => {
        const pos = resolvePosition(table.id);
        const isSaving = savingId === table.id;
        const isDragging = dragStateRef.current?.id === table.id;
        return (
          <div
            key={table.id}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (isSaving) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onEdit(table);
              }
            }}
            onPointerDown={(e) => handlePointerDown(e, table)}
            onPointerMove={(e) => handlePointerMove(e, table)}
            onPointerUp={(e) => handlePointerUp(e, table)}
            onPointerCancel={(e) => handlePointerCancel(e, table)}
            style={{
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              width: NODE_W,
              height: NODE_H,
              touchAction: "none",
            }}
            className={cn(
              "absolute flex select-none flex-col items-center justify-center gap-0.5 rounded-lg border shadow-sm transition-shadow",
              statusNodeTone(table.status),
              table.is_active ? "opacity-100" : "opacity-50",
              isDragging ? "cursor-grabbing shadow-md" : "cursor-grab",
              isSaving ? "ring-1 ring-primary/30" : null
            )}
          >
            {isSaving ? (
              <Loader2 className="absolute right-1 top-1 h-3.5 w-3.5 animate-spin text-primary" />
            ) : null}
            <span className="text-sm font-bold leading-tight">
              {table.table_number}
            </span>
            <span className="text-xs opacity-70">{table.capacity} org</span>
          </div>
        );
      })}
    </div>
  );
}
