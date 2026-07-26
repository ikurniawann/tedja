"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  allowClear?: boolean;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Pilih opsi...",
  searchPlaceholder = "Cari...",
  emptyMessage = "Tidak ditemukan.",
  disabled = false,
  className,
  allowClear = false,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState("");

  const selectedOption = React.useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  );

  const filteredOptions = React.useMemo(() => {
    if (!searchValue) return options;
    const search = searchValue.toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(search) ||
        opt.value.toLowerCase().includes(search) ||
        opt.description?.toLowerCase().includes(search)
    );
  }, [options, searchValue]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-slot="select-trigger"
        type="button"
        role="combobox"
        aria-expanded={open}
        className={cn(
          "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-gray-200/80 bg-transparent px-3 text-sm outline-none transition-colors hover:border-gray-300 hover:bg-muted focus-visible:border-pink-200 focus-visible:ring-1 focus-visible:ring-pink-100 disabled:pointer-events-none disabled:opacity-50",
          className
        )}
        disabled={disabled}
      >
        <span className={cn("min-w-0 truncate", !selectedOption && "text-muted-foreground")}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <div className="flex items-center gap-2">
          {allowClear && value && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange("");
                }
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </span>
          )}
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="z-[9999] w-(--anchor-width) min-w-(--anchor-width) border border-gray-200/80 bg-white p-0 shadow-xl ring-1 ring-gray-200/60"
        align="start"
        sideOffset={4}
      >
        <Command shouldFilter={false} className="bg-white">
          <div className="flex items-center border-b border-gray-200 px-3 py-2.5">
            <Search className="w-4 h-4 text-gray-400 mr-2 flex-shrink-0" />
            <input
              data-combobox-search="true"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full border-0! bg-transparent text-sm text-gray-900 shadow-none! outline-none! ring-0! placeholder:text-gray-400 focus:border-0! focus:shadow-none! focus:outline-none! focus:ring-0!"
              style={{ border: 0, boxShadow: "none", outline: "none" }}
            />
          </div>
          <CommandList className="max-h-[300px] overflow-y-auto bg-white p-1">
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => {
                    onChange(allowClear && option.value === value ? "" : option.value);
                    setOpen(false);
                    setSearchValue("");
                  }}
                  className="hover:bg-gray-100 data-[selected=true]:bg-gray-200 cursor-pointer py-2 px-3 bg-white rounded-sm"
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {option.description && (
                    <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
