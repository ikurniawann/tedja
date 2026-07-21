"use client";

import { useState } from "react";
import { TicketIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { useCreateTicketType, useTicketTypes, useUpdateTicketType } from "../queries";
import type { TicketType } from "../types";

interface TypeForm {
  code: string;
  name: string;
  rule_note: string;
  sort_order: string;
  is_active: boolean;
}

const EMPTY_FORM: TypeForm = {
  code: "",
  name: "",
  rule_note: "",
  sort_order: "0",
  is_active: true,
};

export function TicketTypesSection() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TicketType | null>(null);
  const [form, setForm] = useState<TypeForm>(EMPTY_FORM);

  const typesQuery = useTicketTypes();
  const types = typesQuery.data ?? [];
  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
  };
  const createMutation = useCreateTicketType(closeDialog);
  const updateMutation = useUpdateTicketType(closeDialog);
  const isPending = createMutation.isPending || updateMutation.isPending;

  const openDialog = (type: TicketType | null) => {
    setEditing(type);
    setForm(
      type
        ? {
            code: type.code,
            name: type.name,
            rule_note: type.rule_note ?? "",
            sort_order: String(type.sort_order),
            is_active: type.is_active,
          }
        : EMPTY_FORM
    );
    setDialogOpen(true);
  };

  const canSubmit =
    form.name.trim() !== "" && (editing !== null || form.code.trim() !== "");

  const handleSubmit = () => {
    if (!canSubmit || isPending) return;
    const shared = {
      name: form.name.trim(),
      rule_note: form.rule_note.trim() || null,
      sort_order: Number(form.sort_order) || 0,
    };
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        values: { ...shared, is_active: form.is_active },
      });
    } else {
      createMutation.mutate({ ...shared, code: form.code.trim().toLowerCase() });
    }
  };

  return (
    <PurchasingListSection
      icon={TicketIcon}
      title="Jenis Tiket"
      description="Kategori pengunjung (dewasa/anak, dst.) beserta aturan penentuannya di loket."
      toolbar={
        <Button
          size="sm"
          onClick={() => openDialog(null)}
        >
          Tambah Jenis
        </Button>
      }
    >
      {typesQuery.isLoading ? (
        <div className="py-14 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
          <p className="mt-2 text-sm text-gray-500">Memuat jenis tiket...</p>
        </div>
      ) : (
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full text-sm">
            <thead>
              <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                <th className="px-4 py-3 text-left font-semibold">Urutan</th>
                <th className="px-4 py-3 text-left font-semibold">Nama</th>
                <th className="px-4 py-3 text-left font-semibold">Aturan Kategori</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Aksi</th>
              </TableRow>
            </thead>
            <tbody className="divide-y divide-gray-200/50">
              {types.map((type) => (
                <TableRow key={type.id} className="hover:bg-gray-50/80">
                  <td className="px-4 py-3 text-gray-500">{type.sort_order}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {type.name}
                    <span className="ml-2 font-mono text-xs text-gray-400">
                      {type.code}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {type.rule_note || "—"}
                  </td>
                  <td className="px-4 py-3">
                    {type.is_active ? (
                      <Badge className="border-0 bg-emerald-100 font-normal text-emerald-700">
                        Aktif
                      </Badge>
                    ) : (
                      <Badge className="border-0 bg-gray-100 font-normal text-gray-500">
                        Nonaktif
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => openDialog(type)}
                        className="h-8 px-3 text-gray-600 hover:bg-gray-100 hover:text-pink-600"
                      >
                        Edit
                      </Button>
                    </div>
                  </td>
                </TableRow>
              ))}
              {types.length === 0 ? (
                <TableRow>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                    Belum ada jenis tiket.
                  </td>
                </TableRow>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit Jenis: ${editing.name}` : "Tambah Jenis Tiket"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {!editing ? (
              <div className="space-y-1.5">
                <Label htmlFor="type_code">Kode *</Label>
                <Input
                  id="type_code"
                  placeholder="mis. toddler"
                  value={form.code}
                  onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                />
                <p className="text-xs text-gray-500">
                  Huruf kecil/angka/tanda hubung — tidak bisa diubah setelah dibuat
                </p>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="type_name">Nama *</Label>
              <Input
                id="type_name"
                placeholder="mis. Balita"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="type_rule">Aturan Kategori</Label>
              <Input
                id="type_rule"
                placeholder="mis. usia 3–12 tahun / tinggi < 140 cm"
                value={form.rule_note}
                onChange={(e) => setForm((p) => ({ ...p, rule_note: e.target.value }))}
              />
              <p className="text-xs text-gray-500">
                Panduan petugas loket menentukan kategori pengunjung
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="type_sort">Urutan</Label>
              <Input
                id="type_sort"
                type="number"
                min={0}
                value={form.sort_order}
                onChange={(e) => setForm((p) => ({ ...p, sort_order: e.target.value }))}
              />
            </div>
            {editing ? (
              <div className="flex items-center justify-between rounded-lg border border-gray-200/70 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-gray-900">Jenis aktif</p>
                  <p className="text-xs text-gray-500">
                    Nonaktif = hilang dari registrasi & matriks harga
                  </p>
                </div>
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(checked) =>
                    setForm((p) => ({ ...p, is_active: checked }))
                  }
                />
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isPending}>
              Batal
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit || isPending}>
              {isPending ? "Menyimpan…" : editing ? "Simpan Perubahan" : "Tambah"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PurchasingListSection>
  );
}
