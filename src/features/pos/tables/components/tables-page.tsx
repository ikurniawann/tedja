"use client";

import { useEffect, useMemo, useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import { Loader2, Search, Table2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FormFieldLabel,
  formInputClassName,
} from "@/components/layout/form-field";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { MasterDeleteDialog } from "@/features/master-data/components/master-delete-dialog";
import { MasterTableActions } from "@/features/master-data/components/master-table-actions";
import { cn } from "@/lib/utils";
import { usePosTables } from "../queries";
import {
  useCreatePosTable,
  useDeletePosTable,
  useUpdatePosTable,
} from "../mutations";
import type { PosTablePayload, PosTableRow, PosTableStatus } from "../types";
import { TablesFloorPlan } from "./tables-floor-plan";

const EMPTY_FORM: PosTablePayload = {
  table_number: "",
  name: "",
  area: "",
  capacity: 4,
  status: "available",
  qr_code: "",
  notes: "",
  is_active: true,
};

const STATUS_OPTIONS: { value: PosTableStatus; label: string }[] = [
  { value: "available", label: "Tersedia" },
  { value: "reserved", label: "Reservasi" },
  { value: "maintenance", label: "Maintenance" },
  { value: "occupied", label: "Terisi" },
];

const STATUS_LABEL: Record<string, string> = {
  available: "Tersedia",
  occupied: "Terisi",
  reserved: "Reservasi",
  cleaning: "Dibersihkan",
  maintenance: "Maintenance",
  unavailable: "Tidak aktif",
};

function statusTone(status: string) {
  switch (status) {
    case "available":
      return "bg-emerald-50 text-emerald-700";
    case "occupied":
      return "bg-amber-50 text-amber-700";
    case "reserved":
      return "bg-blue-50 text-blue-700";
    case "maintenance":
      return "bg-slate-100 text-slate-600";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

export function TablesPage() {
  const { data: tables = [], isLoading, error } = usePosTables(true);
  const createMutation = useCreatePosTable();
  const updateMutation = useUpdatePosTable();
  const deleteMutation = useDeletePosTable();

  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<"add" | "edit" | null>(null);
  const [selected, setSelected] = useState<PosTableRow | null>(null);
  const [form, setForm] = useState<PosTablePayload>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDeleting = deleteMutation.isPending;

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchQuery.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const filtered = useMemo(() => {
    if (!search) return tables;
    const q = search.toLowerCase();
    return tables.filter((t) => {
      const haystack = [
        t.table_number,
        t.name,
        t.label,
        t.area,
        t.qr_code,
        t.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [tables, search]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setSelected(null);
    setDialog("add");
  }

  function openEdit(item: PosTableRow) {
    setSelected(item);
    setForm({
      table_number: item.table_number || "",
      name: item.name || "",
      area: item.area || "",
      capacity: item.capacity || 4,
      status: (["available", "occupied", "reserved", "maintenance"].includes(
        item.status
      )
        ? item.status
        : "available") as PosTableStatus,
      qr_code: item.qr_code || "",
      notes: item.notes || "",
      is_active: item.is_active !== false,
    });
    setDialog("edit");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;
    if (!form.table_number.trim()) {
      toast.error("Nomor meja wajib diisi");
      return;
    }
    try {
      if (dialog === "edit" && selected) {
        const res = await updateMutation.mutateAsync({
          id: selected.id,
          ...form,
        });
        toast.success(res.message || "Meja berhasil diperbarui");
      } else {
        const res = await createMutation.mutateAsync(form);
        toast.success(res.message || "Meja berhasil ditambahkan");
      }
      setDialog(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan meja");
    }
  }

  async function handleDelete() {
    if (!deleteId || isDeleting) return;
    try {
      const res = await deleteMutation.mutateAsync(deleteId);
      toast.success(res.message || "Meja dinonaktifkan");
      setDeleteId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus meja");
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Meja</h1>
          <p className="mt-1 text-sm text-gray-500">
            Master data meja dine-in — {tables.length} meja terdaftar
          </p>
        </div>
        <Button
          type="button"
          onClick={openAdd}
          className="h-10 w-full gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 sm:w-auto"
        >
          <PlusIcon className="h-4 w-4" />
          Tambah Meja
        </Button>
      </div>

      <Tabs defaultValue="list" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="denah">Denah</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-0">
          <PurchasingListSection
            icon={Table2}
            title="Daftar Meja"
            description="Kelola nomor, kapasitas, area, dan status meja untuk kasir."
            toolbar={
              <label className="relative w-full sm:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder="Cari nomor / area…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-10 bg-white pl-9 pr-9 text-sm focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                    aria-label="Hapus pencarian"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </label>
            }
          >
            {isLoading ? (
              <div className="py-14 text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                <p className="mt-2 text-sm text-gray-500">Memuat data meja…</p>
              </div>
            ) : error ? (
              <div className="py-14 text-center text-sm text-red-600">
                {error instanceof Error ? error.message : "Gagal memuat meja"}
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-14 text-center">
                <Table2 className="mx-auto mb-4 h-12 w-12 text-gray-300" />
                <p className="text-gray-500">
                  {search ? "Tidak ada meja yang cocok" : "Belum ada data meja"}
                </p>
                {!search ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={openAdd}
                    className="mt-4 h-10 rounded-lg border-primary/30 text-primary hover:bg-primary/10"
                  >
                    Tambah Meja Pertama
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="overflow-x-auto px-4 pb-4">
                <table className="w-full text-sm">
                  <thead>
                    <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                      <th className="px-4 py-3 text-left font-semibold">No. Meja</th>
                      <th className="px-4 py-3 text-left font-semibold">Nama</th>
                      <th className="px-4 py-3 text-left font-semibold">Area</th>
                      <th className="px-4 py-3 text-left font-semibold">Kapasitas</th>
                      <th className="px-4 py-3 text-left font-semibold">Status</th>
                      <th className="px-4 py-3 text-left font-semibold">Aktif</th>
                      <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                    </TableRow>
                  </thead>
                  <tbody className="divide-y divide-gray-200/50">
                    {filtered.map((table) => (
                      <tr
                        key={table.id}
                        className="border-b border-gray-200/70 last:border-0 hover:bg-gray-50/70"
                      >
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {table.table_number}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {table.name || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {table.area || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {table.capacity}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                              statusTone(table.status)
                            )}
                          >
                            {STATUS_LABEL[table.status] || table.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "text-xs font-medium",
                              table.is_active
                                ? "text-emerald-600"
                                : "text-gray-400"
                            )}
                          >
                            {table.is_active ? "Ya" : "Tidak"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <MasterTableActions
                            onEdit={() => openEdit(table)}
                            onDelete={() => setDeleteId(table.id)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PurchasingListSection>
        </TabsContent>

        <TabsContent value="denah" className="mt-0">
          {isLoading ? (
            <div className="py-14 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="mt-2 text-sm text-gray-500">Memuat denah…</p>
            </div>
          ) : error ? (
            <div className="py-14 text-center text-sm text-red-600">
              {error instanceof Error ? error.message : "Gagal memuat meja"}
            </div>
          ) : tables.length === 0 ? (
            <div className="rounded-xl border border-gray-200/70 bg-white py-14 text-center">
              <p className="text-gray-500">Belum ada data meja</p>
              <Button
                type="button"
                variant="outline"
                onClick={openAdd}
                className="mt-4"
              >
                Tambah Meja Pertama
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200/70 bg-white p-4">
              <TablesFloorPlan tables={tables} onEdit={openEdit} />
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => !open && !isSaving && setDialog(null)}
      >
        <DialogPanel size="sm">
          <DialogPanelForm onSubmit={handleSave}>
            <DialogPanelHeader>
              <DialogPanelTitle>
                {dialog === "edit" ? "Edit Meja" : "Tambah Meja"}
              </DialogPanelTitle>
              <DialogPanelDescription>
                Isi data meja untuk dipakai di kasir dan reservasi.
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <FormFieldLabel required>Nomor Meja</FormFieldLabel>
                  <Input
                    value={form.table_number}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, table_number: e.target.value }))
                    }
                    className={formInputClassName}
                    placeholder="T-01"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <FormFieldLabel>Nama</FormFieldLabel>
                  <Input
                    value={form.name ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    className={formInputClassName}
                    placeholder="Meja jendela"
                  />
                </div>
                <div className="space-y-1.5">
                  <FormFieldLabel>Area</FormFieldLabel>
                  <Input
                    value={form.area ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, area: e.target.value }))
                    }
                    className={formInputClassName}
                    placeholder="Indoor / Outdoor"
                  />
                </div>
                <div className="space-y-1.5">
                  <FormFieldLabel required>Kapasitas</FormFieldLabel>
                  <Input
                    type="number"
                    min={1}
                    value={form.capacity}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        capacity: Math.max(1, Number(e.target.value) || 1),
                      }))
                    }
                    className={formInputClassName}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <FormFieldLabel>Status</FormFieldLabel>
                  <Select
                    value={form.status}
                    onValueChange={(value) =>
                      setForm((f) => ({
                        ...f,
                        status: value as PosTableStatus,
                      }))
                    }
                  >
                    <SelectTrigger className={formInputClassName}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <FormFieldLabel>QR Code</FormFieldLabel>
                  <Input
                    value={form.qr_code ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, qr_code: e.target.value }))
                    }
                    className={formInputClassName}
                    placeholder="Opsional"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <FormFieldLabel>Catatan</FormFieldLabel>
                  <Input
                    value={form.notes ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, notes: e.target.value }))
                    }
                    className={formInputClassName}
                    placeholder="Opsional"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
                  <Checkbox
                    checked={form.is_active}
                    onCheckedChange={(checked) =>
                      setForm((f) => ({ ...f, is_active: checked === true }))
                    }
                  />
                  Aktif
                </label>
              </div>
            </DialogPanelBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialog(null)}
                disabled={isSaving}
              >
                Batal
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : dialog === "edit" ? (
                  "Simpan"
                ) : (
                  "Tambah"
                )}
              </Button>
            </DialogFooter>
          </DialogPanelForm>
        </DialogPanel>
      </Dialog>

      <MasterDeleteDialog
        open={Boolean(deleteId)}
        title="Nonaktifkan meja?"
        description="Meja akan dinonaktifkan (soft delete) agar riwayat order tetap aman. Meja dengan open bill tidak bisa dihapus."
        isDeleting={isDeleting}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
