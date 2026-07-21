"use client";

import { useEffect, useState } from "react";
import { ChatBubbleLeftRightIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { MasterTableActions } from "@/features/master-data/components/master-table-actions";
import {
  useCreateWaTemplate,
  useDeleteWaTemplate,
  useUpdateWaTemplate,
  useWaTemplates,
} from "../../activities/queries";
import type { WaTemplate } from "../../activities/types";

const PLACEHOLDER_HINT =
  "Placeholder: {pic} {instansi} {acara} {tanggal_acara} {venue}";

export function WaTemplatesSection() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WaTemplate | null>(null);
  const [deleting, setDeleting] = useState<WaTemplate | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");

  const templatesQuery = useWaTemplates();
  const templates = templatesQuery.data ?? [];

  const close = () => {
    setFormOpen(false);
    setEditing(null);
  };
  const createMutation = useCreateWaTemplate(close);
  const updateMutation = useUpdateWaTemplate(close);
  const deleteMutation = useDeleteWaTemplate();
  const isPending = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!formOpen) return;
    setName(editing?.name ?? "");
    setBody(editing?.body ?? "");
  }, [formOpen, editing]);

  const canSubmit = name.trim() !== "" && body.trim() !== "";

  const handleSubmit = () => {
    if (!canSubmit || isPending) return;
    const values = { name: name.trim(), body: body.trim() };
    if (editing) {
      updateMutation.mutate({ id: editing.id, values });
    } else {
      createMutation.mutate(values);
    }
  };

  return (
    <>
      <PurchasingListSection
        icon={ChatBubbleLeftRightIcon}
        title="Template Pesan WA"
        description={`Dipakai tombol kirim cepat di kartu deal. ${PLACEHOLDER_HINT}`}
        toolbar={
          <Button
            type="button"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="h-9 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white hover:bg-pink-700"
          >
            Tambah Template
          </Button>
        }
      >
        {templatesQuery.isLoading ? (
          <div className="py-10 text-center">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-pink-600" />
          </div>
        ) : templates.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">
            Belum ada template.
          </p>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-4 py-3 text-left font-semibold">Nama</th>
                  <th className="px-4 py-3 text-left font-semibold">Isi Pesan</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {templates.map((template) => (
                  <TableRow key={template.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {template.name}
                    </td>
                    <td className="max-w-md px-4 py-3 text-gray-600">
                      <p className="line-clamp-2">{template.body}</p>
                    </td>
                    <td className="px-4 py-3">
                      <MasterTableActions
                        onEdit={() => {
                          setEditing(template);
                          setFormOpen(true);
                        }}
                        onDelete={() => setDeleting(template)}
                      />
                    </td>
                  </TableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      <Dialog open={formOpen} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Template" : "Tambah Template"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tpl_name">Nama Template *</Label>
              <Input
                id="tpl_name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Follow-up Penawaran"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl_body">Isi Pesan *</Label>
              <Textarea
                id="tpl_body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                placeholder="Halo {pic}, ..."
              />
              <p className="text-xs text-gray-500">{PLACEHOLDER_HINT}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={isPending}>
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
        title="Nonaktifkan template?"
        description={`Template "${deleting?.name ?? ""}" tidak akan muncul lagi di pilihan kirim cepat.`}
        confirmLabel="Nonaktifkan"
        variant="danger"
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting.id);
          setDeleting(null);
        }}
      />
    </>
  );
}
