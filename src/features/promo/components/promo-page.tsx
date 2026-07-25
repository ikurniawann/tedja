"use client";

// EPIC-032 A3 — halaman admin Engine Promosi: daftar campaign + buat
// campaign (opsional langsung dgn kode publik). Detail kode/voucher/
// riwayat di dialog terpisah (campaign-detail-dialog).

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { useCampaigns, useCreateCampaign, useUpdateCampaign } from "../queries";
import {
  PROMO_SCOPE_LABELS,
  type PromoCampaign,
  type PromoDiscountType,
  type PromoScope,
} from "../types";
import { CampaignDetailDialog } from "./campaign-detail-dialog";

const formatRp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

const formatDiscount = (c: PromoCampaign) =>
  c.discount_type === "percent"
    ? `${Number(c.value)}%${c.max_discount ? ` (maks ${formatRp(Number(c.max_discount))})` : ""}`
    : formatRp(Number(c.value));

const formatWindow = (c: PromoCampaign) => {
  if (!c.valid_from && !c.valid_until) return "Tanpa batas waktu";
  return `${c.valid_from ?? "…"} s/d ${c.valid_until ?? "…"}`;
};

interface CampaignForm {
  name: string;
  discount_type: PromoDiscountType;
  value: string;
  max_discount: string;
  min_purchase: string;
  valid_from: string;
  valid_until: string;
  usage_limit: string;
  per_phone_limit: string;
  scope: PromoScope;
  public_code: string;
}

const EMPTY_FORM: CampaignForm = {
  name: "",
  discount_type: "percent",
  value: "",
  max_discount: "",
  min_purchase: "",
  valid_from: "",
  valid_until: "",
  usage_limit: "",
  per_phone_limit: "1",
  scope: "ticketing_online",
  public_code: "",
};

export function PromoPage() {
  const campaignsQuery = useCampaigns();
  const updateMutation = useUpdateCampaign();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CampaignForm>(EMPTY_FORM);
  const [detailCampaign, setDetailCampaign] = useState<PromoCampaign | null>(null);
  const createMutation = useCreateCampaign(() => {
    setCreateOpen(false);
    setForm(EMPTY_FORM);
  });

  const set = (patch: Partial<CampaignForm>) =>
    setForm((current) => ({ ...current, ...patch }));

  const valueNum = Number(form.value);
  const formInvalid =
    form.name.trim().length < 2 ||
    form.value.trim() === "" ||
    Number.isNaN(valueNum) ||
    valueNum <= 0 ||
    (form.discount_type === "percent" && valueNum > 100) ||
    (form.valid_from !== "" &&
      form.valid_until !== "" &&
      form.valid_until < form.valid_from);

  const handleCreate = () => {
    if (formInvalid || createMutation.isPending) return;
    createMutation.mutate({
      name: form.name.trim(),
      discount_type: form.discount_type,
      value: valueNum,
      max_discount:
        form.discount_type === "percent" && form.max_discount.trim() !== ""
          ? Number(form.max_discount)
          : null,
      min_purchase: Number(form.min_purchase) || 0,
      valid_from: form.valid_from || null,
      valid_until: form.valid_until || null,
      usage_limit: form.usage_limit.trim() === "" ? null : Number(form.usage_limit),
      per_phone_limit:
        form.per_phone_limit.trim() === "" ? null : Number(form.per_phone_limit),
      scope: form.scope,
      ...(form.public_code.trim() !== ""
        ? { public_code: form.public_code.trim() }
        : {}),
    });
  };

  const campaigns = campaignsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Engine Promosi</h1>
        <p className="mt-1 text-sm text-gray-500">
          Promo code, voucher batch, dan diskon lintas kanal — booking online
          tiket dulu, kasir POS menyusul. Pemakaian tercatat per kode.
        </p>
      </div>

      <PurchasingListSection
        icon={TicketIcon}
        title="Campaign Promo"
        description="Satu campaign = satu aturan diskon; kodenya bisa satu kode publik atau ribuan voucher sekali pakai."
        toolbar={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Buat Campaign
          </Button>
        }
      >
        {campaignsQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
            <p className="mt-2 text-sm text-gray-500">Memuat campaign...</p>
          </div>
        ) : campaigns.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-500">
            Belum ada campaign — mulai dari &quot;Buat Campaign&quot;.
          </p>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-4 py-3 text-left font-semibold">Campaign</th>
                  <th className="px-4 py-3 text-left font-semibold">Diskon</th>
                  <th className="px-4 py-3 text-left font-semibold">Kanal</th>
                  <th className="px-4 py-3 text-left font-semibold">Periode</th>
                  <th className="px-4 py-3 text-right font-semibold">Terpakai</th>
                  <th className="px-4 py-3 text-left font-semibold">Aktif</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {campaigns.map((campaign) => (
                  <TableRow key={campaign.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{campaign.name}</p>
                      <p className="text-xs text-gray-500">
                        {campaign.codes_count} kode
                        {Number(campaign.min_purchase) > 0
                          ? ` · min ${formatRp(Number(campaign.min_purchase))}`
                          : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {formatDiscount(campaign)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className="border-0 bg-blue-100 font-normal text-blue-700">
                        {PROMO_SCOPE_LABELS[campaign.scope]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {formatWindow(campaign)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <p className="font-medium text-gray-900">
                        {campaign.captured_count}
                        {campaign.usage_limit !== null
                          ? `/${campaign.usage_limit}`
                          : ""}
                      </p>
                      <p className="text-xs text-gray-500">
                        {Number(campaign.held_count) > 0
                          ? `${campaign.held_count} menunggu bayar · `
                          : ""}
                        {formatRp(Number(campaign.discount_captured))}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={campaign.is_active}
                        disabled={updateMutation.isPending}
                        onCheckedChange={(checked) =>
                          updateMutation.mutate({
                            id: campaign.id,
                            values: { is_active: checked },
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-3"
                          onClick={() => setDetailCampaign(campaign)}
                        >
                          Kode & Riwayat
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

      {/* Dialog buat campaign */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Buat Campaign Promo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="promo_name">Nama Campaign</Label>
              <Input
                id="promo_name"
                placeholder="mis. Promo Kemerdekaan"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Jenis Diskon</Label>
                <Select
                  value={form.discount_type}
                  onValueChange={(v) =>
                    set({ discount_type: v as PromoDiscountType })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Persen (%)</SelectItem>
                    <SelectItem value="fixed">Nominal (Rp)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo_value">
                  {form.discount_type === "percent" ? "Persen" : "Nominal (Rp)"}
                </Label>
                <Input
                  id="promo_value"
                  type="number"
                  min={1}
                  max={form.discount_type === "percent" ? 100 : undefined}
                  value={form.value}
                  onChange={(e) => set({ value: e.target.value })}
                />
              </div>
            </div>
            {form.discount_type === "percent" && (
              <div className="space-y-1.5">
                <Label htmlFor="promo_cap">Maks. Potongan (Rp, opsional)</Label>
                <Input
                  id="promo_cap"
                  type="number"
                  min={1}
                  placeholder="kosong = tanpa batas potongan"
                  value={form.max_discount}
                  onChange={(e) => set({ max_discount: e.target.value })}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="promo_min">Min. Pembelian (Rp)</Label>
                <Input
                  id="promo_min"
                  type="number"
                  min={0}
                  placeholder="0"
                  value={form.min_purchase}
                  onChange={(e) => set({ min_purchase: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Kanal Berlaku</Label>
                <Select
                  value={form.scope}
                  onValueChange={(v) => set({ scope: v as PromoScope })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.entries(PROMO_SCOPE_LABELS) as [PromoScope, string][]
                    ).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="promo_from">Mulai (opsional)</Label>
                <Input
                  id="promo_from"
                  type="date"
                  value={form.valid_from}
                  onChange={(e) => set({ valid_from: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo_until">Berakhir (opsional)</Label>
                <Input
                  id="promo_until"
                  type="date"
                  value={form.valid_until}
                  onChange={(e) => set({ valid_until: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="promo_limit">Kuota Total (opsional)</Label>
                <Input
                  id="promo_limit"
                  type="number"
                  min={1}
                  placeholder="kosong = tanpa batas"
                  value={form.usage_limit}
                  onChange={(e) => set({ usage_limit: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo_phone_limit">Batas per Nomor WA</Label>
                <Input
                  id="promo_phone_limit"
                  type="number"
                  min={1}
                  placeholder="kosong = bebas"
                  value={form.per_phone_limit}
                  onChange={(e) => set({ per_phone_limit: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="promo_code">Kode Publik (opsional)</Label>
              <Input
                id="promo_code"
                placeholder="mis. MERDEKA45 — bisa ditambah nanti"
                value={form.public_code}
                onChange={(e) =>
                  set({ public_code: e.target.value.toUpperCase() })
                }
              />
              <p className="text-xs text-gray-500">
                Kosongkan bila mau generate batch voucher sekali-pakai dari
                menu Kode & Riwayat.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={handleCreate}
              disabled={formInvalid || createMutation.isPending}
            >
              {createMutation.isPending ? "Menyimpan…" : "Buat Campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CampaignDetailDialog
        campaign={detailCampaign}
        onOpenChange={(open) => !open && setDetailCampaign(null)}
      />
    </div>
  );
}
