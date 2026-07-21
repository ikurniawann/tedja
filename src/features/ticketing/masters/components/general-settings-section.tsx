"use client";

import { useState } from "react";
import { Cog6ToothIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { useChannels, useTicketingSettings, useUpdateChannel, useUpdateSettings } from "../queries";
import type { PaymentMode, ReEntryPolicy } from "../types";

interface SettingsForm {
  re_entry_policy: ReEntryPolicy;
  default_credit_limit: string;
  default_payment_mode: PaymentMode;
}

export function GeneralSettingsSection() {
  const settingsQuery = useTicketingSettings();
  const channelsQuery = useChannels();
  const updateMutation = useUpdateSettings();
  const updateChannelMutation = useUpdateChannel();

  // Nilai server + edit lokal (belum disimpan) di-derive tiap render —
  // tanpa setState di effect, edit user tetap menang atas data server.
  const [edits, setEdits] = useState<Partial<SettingsForm>>({});
  const settings = settingsQuery.data;
  const form: SettingsForm | null = settings
    ? {
        re_entry_policy: edits.re_entry_policy ?? settings.re_entry_policy,
        default_credit_limit:
          edits.default_credit_limit ??
          String(Number(settings.default_credit_limit)),
        default_payment_mode:
          edits.default_payment_mode ?? settings.default_payment_mode,
      }
    : null;
  const setForm = (patch: Partial<SettingsForm>) =>
    setEdits((p) => ({ ...p, ...patch }));

  const handleSave = () => {
    if (!form || updateMutation.isPending) return;
    updateMutation.mutate({
      re_entry_policy: form.re_entry_policy,
      default_credit_limit: Number(form.default_credit_limit) || 0,
      default_payment_mode: form.default_payment_mode,
    });
  };

  return (
    <PurchasingListSection
      icon={Cog6ToothIcon}
      title="Kebijakan Operasional"
      description="Aturan re-entry, plafon tagihan postpaid, mode bayar default, dan kanal aktif."
      toolbar={
        <Button size="sm" onClick={handleSave} disabled={!form || updateMutation.isPending}>
          {updateMutation.isPending ? "Menyimpan…" : "Simpan Kebijakan"}
        </Button>
      }
    >
      {settingsQuery.isLoading || !form ? (
        <div className="py-14 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
          <p className="mt-2 text-sm text-gray-500">Memuat pengaturan...</p>
        </div>
      ) : (
        <div className="grid gap-6 px-5 py-4 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Default Re-entry Ticket Baru</Label>
              <Select
                value={form.re_entry_policy}
                onValueChange={(value) =>
                  setForm({ re_entry_policy: value as ReEntryPolicy })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sekali-masuk">
                    Sekali masuk — tap kedua ditolak
                  </SelectItem>
                  <SelectItem value="bebas-keluar-masuk">
                    Bebas keluar-masuk — tap ulang tidak men-charge
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Dipakai sebagai default saat membuat ticket baru — tiap ticket
                bisa mengubahnya di tab Kebijakan Operasional
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credit_limit">Plafon Tagihan Postpaid (Rp)</Label>
              <Input
                id="credit_limit"
                type="number"
                min={0}
                step={50000}
                value={form.default_credit_limit}
                onChange={(e) =>
                  setForm({ default_credit_limit: e.target.value })
                }
              />
              <p className="text-xs text-gray-500">
                Di atas plafon, pembelian F&B via gelang ditolak & diarahkan
                bayar parsial di kasir
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Mode Bayar Default di Loket</Label>
              <Select
                value={form.default_payment_mode}
                onValueChange={(value) =>
                  setForm({ default_payment_mode: value as PaymentMode })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="postpaid">
                    Postpaid — tagihan menumpuk, bayar saat keluar
                  </SelectItem>
                  <SelectItem value="prepaid">
                    Prepaid — top-up saldo dulu, sisa di-refund
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Petugas loket tetap bisa memilih mode lain per kunjungan
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <Label>Kanal Penjualan</Label>
            {(channelsQuery.data ?? []).map((channel) => (
              <div
                key={channel.id}
                className="flex items-center justify-between rounded-lg border border-gray-200/70 px-3 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {channel.name}
                    {channel.is_online ? (
                      <Badge className="ml-2 border-0 bg-blue-100 font-normal text-blue-700">
                        Online
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-gray-500">
                    {channel.is_online
                      ? "Bayar di muka — booking website (Fase D)"
                      : "Penjualan langsung di loket"}
                  </p>
                </div>
                <Switch
                  checked={channel.is_active}
                  disabled={updateChannelMutation.isPending}
                  onCheckedChange={(checked) =>
                    updateChannelMutation.mutate({
                      id: channel.id,
                      values: { is_active: checked },
                    })
                  }
                />
              </div>
            ))}
            <p className="text-xs text-gray-500">
              Kanal nonaktif hilang dari matriks harga & tidak menerima
              penjualan. Kanal OTA menyusul setelah MVP.
            </p>
          </div>
        </div>
      )}
    </PurchasingListSection>
  );
}
