"use client";

import { useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { FormFieldLabel } from "@/components/layout/form-field";

export type StallOption = {
  id: string;
  name: string;
  code: string;
};

interface StallAssignmentPickerProps {
  stalls: StallOption[];
  selectedIds: string[];
  required?: boolean;
  onChange: (warehouseIds: string[]) => void;
}

export function StallAssignmentPicker({
  stalls,
  selectedIds,
  required = false,
  onChange,
}: StallAssignmentPickerProps) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  function toggleStall(warehouseId: string, checked: boolean) {
    if (checked) {
      onChange([...selectedIds, warehouseId]);
      return;
    }
    onChange(selectedIds.filter((id) => id !== warehouseId));
  }

  return (
    <div className="space-y-3">
      <div>
        <FormFieldLabel required={required}>Active Stalls</FormFieldLabel>
        <p className="mt-1 text-xs text-gray-500">
          Select stalls where this user can operate data (POS, warehouse, QC, etc.).
        </p>
      </div>

      {stalls.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200/70 py-4 text-center text-xs text-gray-400">
          No stalls found for this branch
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {stalls.map((stall) => {
            const checked = selectedSet.has(stall.id);
            return (
              <label
                key={stall.id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200/70 bg-white p-3 transition-colors hover:bg-gray-50/80"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(value) => toggleStall(stall.id, value === true)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900">{stall.name}</span>
                  <span className="block font-mono text-[11px] text-gray-400">{stall.code}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
