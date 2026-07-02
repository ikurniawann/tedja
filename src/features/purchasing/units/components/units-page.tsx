"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormModal } from "@/components/ui/form-modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import {
  FormFieldLabel,
  formComboboxClassName,
  formInputClassName,
} from "@/components/layout/form-field";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingTablePagination } from "@/modules/purchasing/components/pagination/PurchasingTablePagination";
import { Loader2, Pencil, Plus, Scale, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useActivityLogger } from "@/hooks/useActivityLogger";
import { Unit, UnitFormData } from "@/types/purchasing";
import { useUnitList } from "../queries";
import { useCreateUnit, useUpdateUnit, useUpdateUnitStatus, useDeleteUnit } from "../mutations";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const TYPE_OPTIONS = [
  { value: "BESAR", label: "Large Unit" },
  { value: "KECIL", label: "Small Unit" },
  { value: "KONVERSI", label: "Conversion Unit" },
];

const TYPE_BADGE_STYLES: Record<string, string> = {
  BESAR: "border-blue-200 bg-blue-50 text-blue-700",
  KECIL: "border-emerald-200 bg-emerald-50 text-emerald-700",
  KONVERSI: "border-purple-200 bg-purple-50 text-purple-700",
};

const TYPE_LABELS: Record<string, string> = {
  BESAR: "Large Unit",
  KECIL: "Small Unit",
  KONVERSI: "Conversion Unit",
};

function normalizeUnitFormData(formData: UnitFormData): UnitFormData {
  return {
    kode: formData.kode.trim().toUpperCase(),
    nama: formData.nama.trim(),
    tipe: formData.tipe,
    deskripsi: formData.deskripsi?.trim() || undefined,
  };
}

export function UnitsPage() {
  const logger = useActivityLogger();

  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const limit = 10;

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [deletingUnit, setDeletingUnit] = useState<Unit | null>(null);
  const [formData, setFormData] = useState<UnitFormData>({
    kode: "",
    nama: "",
    tipe: "BESAR",
    deskripsi: "",
  });
  const [statusDialog, setStatusDialog] = useState<{
    open: boolean;
    unit: Unit | null;
    nextStatus: boolean;
  }>({
    open: false,
    unit: null,
    nextStatus: true,
  });

  const listQuery = useUnitList({ search: search || undefined, page, limit });
  const units = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = listQuery.data?.pagination.total_pages ?? 1;
  const loading = listQuery.isLoading;

  const createMutation = useCreateUnit();
  const updateMutation = useUpdateUnit();
  const statusMutation = useUpdateUnitStatus();
  const deleteMutation = useDeleteUnit();
  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isDeleting = deleteMutation.isPending;
  const statusUpdatingId = statusMutation.isPending
    ? statusMutation.variables?.id ?? null
    : null;

  useEffect(() => {
    if (listQuery.isError) {
      console.error("Error loading units:", listQuery.error);
      toast.error(`Failed to load units: ${getErrorMessage(listQuery.error, "Unknown error")}`);
    }
  }, [listQuery.isError, listQuery.error]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const handleOpenAdd = () => {
    setEditingUnit(null);
    setFormData({
      kode: "",
      nama: "",
      tipe: "BESAR",
      deskripsi: "",
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (unit: Unit) => {
    setEditingUnit(unit);
    setFormData({
      kode: unit.kode,
      nama: unit.nama,
      tipe: unit.tipe,
      deskripsi: unit.deskripsi || "",
    });
    setIsDialogOpen(true);
  };

  const handleOpenDelete = (unit: Unit) => {
    setDeletingUnit(unit);
    setIsDeleteDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const payload = normalizeUnitFormData(formData);
    if (!payload.kode) {
      toast.error("Unit code is required");
      return;
    }
    if (!payload.nama) {
      toast.error("Unit name is required");
      return;
    }
    if (!payload.tipe) {
      toast.error("Unit type is required");
      return;
    }

    try {
      if (editingUnit) {
        await updateMutation.mutateAsync({ id: editingUnit.id, payload });
        logger.updateRawMaterial("Unit Updated", payload.kode || "N/A", `Updated ${payload.nama}`);
        toast.success("Unit updated successfully");
      } else {
        await createMutation.mutateAsync(payload);
        logger.createRawMaterial("Unit Created", payload.kode || "N/A", {
          nama: payload.nama,
          tipe: payload.tipe,
        });
        toast.success("Unit added successfully");
      }
      setIsDialogOpen(false);
    } catch (error: unknown) {
      console.error("Error saving unit:", error);
      toast.error(getErrorMessage(error, "Failed to save unit"));
    }
  };

  const handleDelete = async () => {
    if (!deletingUnit || isDeleting) return;

    try {
      await deleteMutation.mutateAsync(deletingUnit.id);
      toast.success("Unit deleted successfully");
      setIsDeleteDialogOpen(false);
      setDeletingUnit(null);
    } catch (error: unknown) {
      console.error("Error deleting unit:", error);
      toast.error(getErrorMessage(error, "Failed to delete unit"));
    }
  };

  const handleConfirmToggleStatus = async () => {
    const unit = statusDialog.unit;
    if (!unit || statusMutation.isPending) return;

    try {
      await statusMutation.mutateAsync({ id: unit.id, isActive: statusDialog.nextStatus });
      toast.success(`Unit ${statusDialog.nextStatus ? "activated" : "deactivated"} successfully`);
      setStatusDialog({ open: false, unit: null, nextStatus: true });
    } catch (error: unknown) {
      console.error("Error updating unit status:", error);
      toast.error(getErrorMessage(error, "Failed to update unit status"));
    }
  };

  const handleResetSearch = () => {
    setSearchQuery("");
    setSearch("");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Unit Master Data"
        description={`Manage measurement units for raw materials and products — ${total} total`}
        actions={
          <Button onClick={handleOpenAdd} className="purchasing-main-button w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4" />
            Add Unit
          </Button>
        }
      />

      <PurchasingListSection
        icon={Scale}
        title="Unit List"
        description="Review unit code, name, type, description, and active status."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search code or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-white pl-10 pr-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>
            {(search || page > 1) && (
              <Button variant="outline" onClick={handleResetSearch} className="h-10 shrink-0 rounded-lg">
                Reset
              </Button>
            )}
          </div>
        }
      >
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-gray-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
              Loading units...
            </div>
          ) : units.length === 0 ? (
            <div className="py-14 text-center">
              <Scale className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">
                {search ? "No units match the current search" : "No units yet"}
              </p>
              {!search && (
                <Button variant="outline" onClick={handleOpenAdd} className="purchasing-secondary-button mt-4">
                  Add First Unit
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto px-4">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200/70 text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-3 pr-4 text-left font-semibold">Code</th>
                      <th className="px-3 py-3 text-left font-semibold">Name</th>
                      <th className="px-3 py-3 text-left font-semibold">Type</th>
                      <th className="px-3 py-3 text-left font-semibold">Description</th>
                      <th className="px-3 py-3 text-center font-semibold">Active</th>
                      <th className="py-3 pl-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200/70">
                    {units.map((unit) => (
                      <tr key={unit.id} className="transition-colors hover:bg-gray-50/80">
                        <td className="py-3 pr-4">
                          <span className="font-medium text-gray-900">{unit.kode}</span>
                        </td>
                        <td className="px-3 py-3 text-gray-700">{unit.nama}</td>
                        <td className="px-3 py-3">
                          <Badge
                            variant="outline"
                            className={TYPE_BADGE_STYLES[unit.tipe] || "border-gray-200 bg-gray-50 text-gray-700"}
                          >
                            {TYPE_LABELS[unit.tipe] || unit.tipe}
                          </Badge>
                        </td>
                        <td className="max-w-[320px] truncate px-3 py-3 text-gray-600">
                          {unit.deskripsi || "-"}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex items-center justify-center">
                            <Switch
                              checked={unit.is_active}
                              disabled={statusUpdatingId === unit.id}
                              onCheckedChange={(checked) =>
                                setStatusDialog({ open: true, unit, nextStatus: checked })
                              }
                              aria-label={`Toggle active status for ${unit.nama}`}
                            />
                          </div>
                        </td>
                        <td className="py-3 pl-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="cursor-pointer"
                              title="Edit"
                              onClick={() => handleOpenEdit(unit)}
                            >
                              <Pencil className="h-4 w-4 text-gray-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="cursor-pointer text-red-500 hover:text-red-600"
                              title="Delete"
                              onClick={() => handleOpenDelete(unit)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <PurchasingTablePagination
                page={page}
                totalPages={totalPages}
                totalItems={total}
                pageSize={limit}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      </PurchasingListSection>

      <FormModal
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        title={editingUnit ? "Edit Unit" : "Add Unit"}
        description={
          editingUnit
            ? "Update the selected unit record"
            : "Add a new measurement unit for raw materials"
        }
        onSubmit={handleSubmit}
        loading={isSubmitting}
        submitLabel={editingUnit ? "Save Changes" : "Save"}
        cancelLabel="Cancel"
        loadingLabel="Saving..."
      >
        <div>
          <FormFieldLabel htmlFor="kode" required>
            Unit Code
          </FormFieldLabel>
          <Input
            id="kode"
            value={formData.kode}
            onChange={(e) => setFormData({ ...formData, kode: e.target.value })}
            placeholder="Example: KG"
            maxLength={10}
            required
            className={formInputClassName}
          />
        </div>
        <div>
          <FormFieldLabel htmlFor="nama" required>
            Unit Name
          </FormFieldLabel>
          <Input
            id="nama"
            value={formData.nama}
            onChange={(e) => setFormData({ ...formData, nama: e.target.value })}
            placeholder="Example: Kilogram"
            maxLength={50}
            required
            className={formInputClassName}
          />
        </div>
        <div>
          <FormFieldLabel htmlFor="tipe" required>
            Unit Type
          </FormFieldLabel>
          <Combobox
            options={TYPE_OPTIONS}
            value={formData.tipe}
            onChange={(value) =>
              setFormData({ ...formData, tipe: value as "BESAR" | "KECIL" | "KONVERSI" })
            }
            placeholder="Select unit type..."
            searchPlaceholder="Search unit type..."
            emptyMessage="No unit type found"
            className={formComboboxClassName}
          />
        </div>
        <div>
          <FormFieldLabel htmlFor="deskripsi">Description</FormFieldLabel>
          <Textarea
            id="deskripsi"
            value={formData.deskripsi}
            onChange={(e) => setFormData({ ...formData, deskripsi: e.target.value })}
            placeholder="Optional description"
            rows={3}
            className="min-h-24 resize-none bg-white text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
          />
        </div>
      </FormModal>

      <ConfirmDialog
        open={statusDialog.open}
        onOpenChange={(open) => {
          if (!open && !statusUpdatingId) {
            setStatusDialog({ open: false, unit: null, nextStatus: true });
          }
        }}
        variant="default"
        title={statusDialog.nextStatus ? "Activate Unit?" : "Deactivate Unit?"}
        description={`Are you sure you want to ${
          statusDialog.nextStatus ? "activate" : "deactivate"
        } unit "${statusDialog.unit?.nama ?? ""}"?`}
        confirmLabel={statusDialog.nextStatus ? "Activate" : "Deactivate"}
        cancelLabel="Cancel"
        loading={Boolean(statusUpdatingId)}
        onConfirm={handleConfirmToggleStatus}
      />

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Delete Unit?"
        description={`Are you sure you want to delete unit "${
          deletingUnit?.nama ?? ""
        }"? The record will be hidden from the list. Units already used by raw materials cannot be deleted.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loadingLabel="Deleting..."
        loading={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
