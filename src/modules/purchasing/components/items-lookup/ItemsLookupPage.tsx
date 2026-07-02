"use client";

import { useEffect, useState } from "react";
import type { ComponentType, FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { FormModal } from "@/components/ui/form-modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormFieldLabel, formInputClassName } from "@/components/layout/form-field";
import { BreadcrumbNav } from "@/modules/purchasing/components/breadcrumb/BreadcrumbNav";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { FolderOpen, Loader2, Pencil, Plus, Search, Tags, Trash2, Warehouse, X } from "lucide-react";
import { toast } from "sonner";
import type { ItemsLookupRecord, ItemsLookupType } from "@/lib/purchasing/items-lookup";
import { ITEMS_LOOKUP_CONFIG } from "@/lib/purchasing/items-lookup";
import { useItemsLookupList } from "@/features/purchasing/items/queries";
import { useSaveItemsLookup, useDeleteItemsLookup } from "@/features/purchasing/items/mutations";

const LOOKUP_ICONS: Record<ItemsLookupType, ComponentType<{ className?: string }>> = {
  "raw-material-categories": Tags,
  "storage-conditions": Warehouse,
  "product-categories": FolderOpen,
};

interface ItemsLookupPageProps {
  lookupType: ItemsLookupType;
  breadcrumbs?: { label: string; href?: string }[];
  listTitle?: string;
  listDescription?: string;
  addButtonLabel?: string;
}

const EMPTY_FORM = {
  code: "",
  nama: "",
  deskripsi: "",
  is_active: true,
};

export function ItemsLookupPage({
  lookupType,
  breadcrumbs = [],
  listTitle,
  listDescription,
  addButtonLabel = "Add Record",
}: ItemsLookupPageProps) {
  const config = ITEMS_LOOKUP_CONFIG[lookupType];
  const Icon = LOOKUP_ICONS[lookupType] ?? Search;

  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ItemsLookupRecord | null>(null);
  const [deleting, setDeleting] = useState<ItemsLookupRecord | null>(null);
  const [formData, setFormData] = useState(EMPTY_FORM);

  const listQuery = useItemsLookupList(lookupType, search);
  const records = listQuery.data ?? [];
  const loading = listQuery.isLoading;
  const total = records.length;

  const saveMutation = useSaveItemsLookup(lookupType);
  const deleteMutation = useDeleteItemsLookup(lookupType);
  const isSubmitting = saveMutation.isPending;
  const isDeleting = deleteMutation.isPending;

  useEffect(() => {
    if (listQuery.isError) {
      toast.error(
        listQuery.error instanceof Error ? listQuery.error.message : "Failed to load records"
      );
    }
  }, [listQuery.isError, listQuery.error]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const handleOpenAdd = () => {
    setEditing(null);
    setFormData(EMPTY_FORM);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (record: ItemsLookupRecord) => {
    setEditing(record);
    setFormData({
      code: record.code,
      nama: record.nama,
      deskripsi: record.deskripsi || "",
      is_active: record.is_active,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    try {
      const json = await saveMutation.mutateAsync({ payload: formData, id: editing?.id });
      toast.success(json.message || "Record saved successfully");
      setIsDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save record");
    }
  };

  const handleDelete = async () => {
    if (!deleting || isDeleting) return;
    try {
      const json = await deleteMutation.mutateAsync(deleting.id);
      toast.success(json.message || "Record deleted successfully");
      setIsDeleteDialogOpen(false);
      setDeleting(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete record");
    }
  };

  const handleResetSearch = () => {
    setSearchQuery("");
    setSearch("");
  };

  return (
    <div className="space-y-6">
      {breadcrumbs.length > 0 ? <BreadcrumbNav items={breadcrumbs} /> : null}

      <PurchasingPageHeader
        title={config.title}
        description={`${config.description} — ${total} total`}
        actions={
          <Button onClick={handleOpenAdd} className="purchasing-main-button w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4" />
            {addButtonLabel}
          </Button>
        }
      />

      <PurchasingListSection
        icon={Icon}
        title={listTitle || `${config.title} List`}
        description={
          listDescription ||
          "Review code, name, description, and active status for each record."
        }
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search code or name..."
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
            {search && (
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
              Loading records...
            </div>
          ) : records.length === 0 ? (
            <div className="py-14 text-center">
              <Icon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">
                {search ? "No records match the current search" : "No records yet"}
              </p>
              {!search && (
                <Button variant="outline" onClick={handleOpenAdd} className="purchasing-secondary-button mt-4">
                  {addButtonLabel}
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto px-4">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200/70 text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-3 pr-4 text-left font-semibold">Code</th>
                    <th className="px-3 py-3 text-left font-semibold">Name</th>
                    <th className="px-3 py-3 text-left font-semibold">Description</th>
                    <th className="px-3 py-3 text-center font-semibold">Status</th>
                    <th className="py-3 pl-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200/70">
                  {records.map((record) => (
                    <tr key={record.id} className="transition-colors hover:bg-gray-50/80">
                      <td className="py-3 pr-4 font-mono text-xs text-gray-700">{record.code}</td>
                      <td className="px-3 py-3 font-medium text-gray-900">{record.nama}</td>
                      <td className="px-3 py-3 text-gray-600">{record.deskripsi || "-"}</td>
                      <td className="px-3 py-3 text-center">
                        <Badge
                          variant="outline"
                          className={
                            record.is_active
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-gray-200 bg-gray-50 text-gray-600"
                          }
                        >
                          {record.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="py-3 pl-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="cursor-pointer"
                            title="Edit"
                            onClick={() => handleOpenEdit(record)}
                          >
                            <Pencil className="h-4 w-4 text-gray-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="cursor-pointer text-red-500 hover:text-red-600"
                            title="Delete"
                            onClick={() => {
                              setDeleting(record);
                              setIsDeleteDialogOpen(true);
                            }}
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
          )}
        </div>
      </PurchasingListSection>

      <FormModal
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        title={editing ? `Edit ${config.title}` : `Add ${config.title}`}
        description={editing ? "Update the selected record" : "Complete the information below"}
        onSubmit={handleSubmit}
        loading={isSubmitting}
        submitDisabled={!formData.code || !formData.nama}
        submitLabel={editing ? "Save Changes" : "Save"}
        cancelLabel="Cancel"
        loadingLabel="Saving..."
      >
        <div>
          <FormFieldLabel htmlFor="code" required>
            Code
          </FormFieldLabel>
          <Input
            id="code"
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
            placeholder="EXAMPLE_CODE"
            maxLength={30}
            required
            className={formInputClassName}
          />
        </div>
        <div>
          <FormFieldLabel htmlFor="nama" required>
            Name
          </FormFieldLabel>
          <Input
            id="nama"
            value={formData.nama}
            onChange={(e) => setFormData({ ...formData, nama: e.target.value })}
            placeholder="Name"
            maxLength={100}
            required
            className={formInputClassName}
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
        <div className="flex items-center justify-between rounded-lg border border-gray-200/70 px-3 py-2.5">
          <FormFieldLabel htmlFor="is_active" className="mb-0">
            Active status
          </FormFieldLabel>
          <Switch
            id="is_active"
            checked={formData.is_active}
            onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
          />
        </div>
      </FormModal>

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Delete Record?"
        description={`Are you sure you want to delete "${deleting?.nama ?? ""}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loadingLabel="Deleting..."
        loading={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
