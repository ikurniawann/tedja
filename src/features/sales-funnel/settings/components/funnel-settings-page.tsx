"use client";

import { useEffect, useState } from "react";
import { Cog6ToothIcon } from "@heroicons/react/24/outline";
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
import { useStages, useUpdateStage } from "../../pipeline/queries";
import type { SalesStage, StageUpdatePayload } from "../../pipeline/types";
import { RecipesSection } from "./recipes-section";
import { WaTemplatesSection } from "./wa-templates-section";

interface StageForm {
  name: string;
  sort_order: string;
  stuck_threshold_days: string;
  is_active: boolean;
}

export function FunnelSettingsPage() {
  const [editingStage, setEditingStage] = useState<SalesStage | null>(null);
  const [form, setForm] = useState<StageForm>({
    name: "",
    sort_order: "0",
    stuck_threshold_days: "7",
    is_active: true,
  });

  const stagesQuery = useStages(true);
  const stages = stagesQuery.data ?? [];
  const updateMutation = useUpdateStage(() => setEditingStage(null));

  useEffect(() => {
    if (!editingStage) return;
    setForm({
      name: editingStage.name,
      sort_order: String(editingStage.sort_order),
      stuck_threshold_days: String(editingStage.stuck_threshold_days),
      is_active: editingStage.is_active,
    });
  }, [editingStage]);

  const isClosing = editingStage?.is_won || editingStage?.is_lost;
  const canSubmit = form.name.trim() !== "";

  const handleSubmit = () => {
    if (!editingStage || !canSubmit || updateMutation.isPending) return;
    const values: StageUpdatePayload = {
      name: form.name.trim(),
      sort_order: Number(form.sort_order) || 0,
      stuck_threshold_days: Number(form.stuck_threshold_days) || 0,
      is_active: form.is_active,
    };
    updateMutation.mutate({ id: editingStage.id, values });
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Pengaturan Funnel</h1>
        <p className="mt-1 text-sm text-gray-500">
          Konfigurasi tahap pipeline: nama, urutan, dan ambang hari deal macet.
        </p>
      </div>

      <PurchasingListSection
        icon={Cog6ToothIcon}
        title="Tahap Pipeline"
        description="Tahap Menang/Kalah selalu aktif — nama & ambang tetap bisa diubah."
      >
        {stagesQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat tahap...</p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-4 py-3 text-left font-semibold">Urutan</th>
                  <th className="px-4 py-3 text-left font-semibold">Nama Tahap</th>
                  <th className="px-4 py-3 text-left font-semibold">Tipe</th>
                  <th className="px-4 py-3 text-left font-semibold">Ambang Macet</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {stages.map((stage) => (
                  <TableRow key={stage.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3 text-gray-500">{stage.sort_order}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {stage.name}
                      <span className="ml-2 font-mono text-xs text-gray-400">
                        {stage.code}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {stage.is_won ? (
                        <Badge className="border-0 bg-emerald-100 font-normal text-emerald-700">
                          Menang
                        </Badge>
                      ) : stage.is_lost ? (
                        <Badge className="border-0 bg-red-100 font-normal text-red-700">
                          Kalah
                        </Badge>
                      ) : (
                        <span className="text-gray-500">Berjalan</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {stage.stuck_threshold_days > 0
                        ? `> ${stage.stuck_threshold_days} hari`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {stage.is_active ? (
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
                          onClick={() => setEditingStage(stage)}
                          className="h-8 px-3 text-gray-600 hover:bg-gray-100 hover:text-pink-600"
                        >
                          Edit
                        </Button>
                      </div>
                    </td>
                  </TableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      <RecipesSection />

      <WaTemplatesSection />

      <Dialog
        open={editingStage !== null}
        onOpenChange={(open) => !open && setEditingStage(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Tahap: {editingStage?.name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="stage_name">Nama Tahap *</Label>
              <Input
                id="stage_name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="stage_sort">Urutan</Label>
                <Input
                  id="stage_sort"
                  type="number"
                  min={0}
                  value={form.sort_order}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, sort_order: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stage_stuck">Ambang Macet (hari)</Label>
                <Input
                  id="stage_stuck"
                  type="number"
                  min={0}
                  max={365}
                  value={form.stuck_threshold_days}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, stuck_threshold_days: e.target.value }))
                  }
                />
                <p className="text-xs text-gray-500">0 = tanpa badge macet</p>
              </div>
            </div>
            {!isClosing ? (
              <div className="flex items-center justify-between rounded-lg border border-gray-200/70 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-gray-900">Tahap aktif</p>
                  <p className="text-xs text-gray-500">
                    Nonaktif hanya bila tidak ada deal berjalan di tahap ini
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
            <Button
              variant="outline"
              onClick={() => setEditingStage(null)}
              disabled={updateMutation.isPending}
            >
              Batal
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || updateMutation.isPending}
            >
              {updateMutation.isPending ? "Menyimpan…" : "Simpan Perubahan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
