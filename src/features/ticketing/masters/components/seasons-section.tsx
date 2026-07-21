"use client";

import { useState } from "react";
import { CalendarIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { useCreateSeason, useDeleteSeason, useSeasons, useUpdateSeason } from "../queries";
import type { TicketSeason } from "../types";

interface SeasonForm {
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

const EMPTY_FORM: SeasonForm = {
  name: "",
  start_date: "",
  end_date: "",
  is_active: true,
};

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function SeasonsSection() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TicketSeason | null>(null);
  const [deleting, setDeleting] = useState<TicketSeason | null>(null);
  const [form, setForm] = useState<SeasonForm>(EMPTY_FORM);

  const seasonsQuery = useSeasons();
  const seasons = seasonsQuery.data ?? [];
  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
  };
  const createMutation = useCreateSeason(closeDialog);
  const updateMutation = useUpdateSeason(closeDialog);
  const deleteMutation = useDeleteSeason();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const openDialog = (season: TicketSeason | null) => {
    setEditing(season);
    setForm(
      season
        ? {
            name: season.name,
            start_date: season.start_date,
            end_date: season.end_date,
            is_active: season.is_active,
          }
        : EMPTY_FORM
    );
    setDialogOpen(true);
  };

  const canSubmit =
    form.name.trim() !== "" &&
    form.start_date !== "" &&
    form.end_date !== "" &&
    form.end_date >= form.start_date;

  const handleSubmit = () => {
    if (!canSubmit || isPending) return;
    const values = {
      name: form.name.trim(),
      start_date: form.start_date,
      end_date: form.end_date,
    };
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        values: { ...values, is_active: form.is_active },
      });
    } else {
      createMutation.mutate(values);
    }
  };

  return (
    <PurchasingListSection
      icon={CalendarIcon}
      title="Kalender High Season"
      description="Rentang tanggal high season (libur sekolah, lebaran, dst.). Tanggal di luar rentang otomatis regular."
      toolbar={
        <Button
          size="sm"
          onClick={() => openDialog(null)}
        >
          Tambah Musim
        </Button>
      }
    >
      {seasonsQuery.isLoading ? (
        <div className="py-14 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
          <p className="mt-2 text-sm text-gray-500">Memuat kalender musim...</p>
        </div>
      ) : (
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full text-sm">
            <thead>
              <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                <th className="px-4 py-3 text-left font-semibold">Nama Musim</th>
                <th className="px-4 py-3 text-left font-semibold">Rentang</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Aksi</th>
              </TableRow>
            </thead>
            <tbody className="divide-y divide-gray-200/50">
              {seasons.map((s) => (
                <TableRow key={s.id} className="hover:bg-gray-50/80">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatDate(s.start_date)} – {formatDate(s.end_date)}
                  </td>
                  <td className="px-4 py-3">
                    {s.is_active ? (
                      <Badge className="border-0 bg-amber-100 font-normal text-amber-700">
                        High Season
                      </Badge>
                    ) : (
                      <Badge className="border-0 bg-gray-100 font-normal text-gray-500">
                        Nonaktif
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => openDialog(s)}
                        className="h-8 px-3 text-gray-600 hover:bg-gray-100 hover:text-pink-600"
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleting(s)}
                        className="h-8 px-3 text-gray-600 hover:bg-red-50 hover:text-red-600"
                      >
                        Hapus
                      </Button>
                    </div>
                  </td>
                </TableRow>
              ))}
              {seasons.length === 0 ? (
                <TableRow>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-500">
                    Belum ada rentang high season — semua tanggal dihitung regular.
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
              {editing ? `Edit Musim: ${editing.name}` : "Tambah High Season"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="season_name">Nama Musim *</Label>
              <Input
                id="season_name"
                placeholder="mis. Libur Lebaran 2027"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="season_start">Mulai *</Label>
                <Input
                  id="season_start"
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="season_end">Selesai *</Label>
                <Input
                  id="season_end"
                  type="date"
                  min={form.start_date || undefined}
                  value={form.end_date}
                  onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))}
                />
              </div>
            </div>
            {form.start_date && form.end_date && form.end_date < form.start_date ? (
              <p className="text-xs text-red-600">
                Tanggal selesai harus sama atau setelah tanggal mulai.
              </p>
            ) : null}
            {editing ? (
              <div className="flex items-center justify-between rounded-lg border border-gray-200/70 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-gray-900">Musim aktif</p>
                  <p className="text-xs text-gray-500">
                    Nonaktif = rentang diabaikan saat resolve harga
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

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Hapus musim "${deleting?.name}"?`}
        description="Tanggal dalam rentang ini akan kembali dihitung regular."
        confirmLabel="Hapus"
        loading={deleteMutation.isPending}
        variant="danger"
        onConfirm={() => {
          if (!deleting) return;
          deleteMutation.mutate(deleting.id, {
            onSuccess: () => setDeleting(null),
          });
        }}
      />
    </PurchasingListSection>
  );
}
