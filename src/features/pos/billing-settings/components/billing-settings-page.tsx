"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Receipt, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_BILLING_CHARGES,
  profileScopeLabel,
  type BillingCharge,
  type BillingProfile,
} from "@/lib/pos/billing-settings";
import { useBillingOptions } from "../queries";
import { useSaveBillingProfile } from "../mutations";

function emptyCharge(partial?: Partial<BillingCharge>): BillingCharge {
  return {
    code: "",
    name: "",
    charge_kind: "fee",
    calc_method: "fixed",
    rate: 0,
    amount: 0,
    apply_order: 50,
    is_enabled: true,
    is_optional: false,
    base: "subtotal_after_discount",
    ...partial,
  };
}

function cloneCharges(charges: BillingCharge[]) {
  return charges.map((charge) => ({ ...charge }));
}

function defaultProfileName(branchId: string, warehouseId: string) {
  if (warehouseId) return "Billing Stall";
  if (branchId) return "Billing Cabang";
  return "Default Sistem";
}

export function BillingSettingsPage() {
  const [branchId, setBranchId] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [profileName, setProfileName] = useState("Profil Billing");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [charges, setCharges] = useState<BillingCharge[]>(() =>
    cloneCharges(DEFAULT_BILLING_CHARGES)
  );

  const optionsQuery = useBillingOptions(branchId || null);
  const saveMutation = useSaveBillingProfile();

  const warehouses = useMemo(() => {
    const list = optionsQuery.data?.warehouses ?? [];
    if (!branchId) return list;
    return list.filter((row) => row.branch_id === branchId);
  }, [optionsQuery.data?.warehouses, branchId]);

  const matchingProfile = useMemo(() => {
    const profiles = optionsQuery.data?.profiles ?? [];
    const branch = branchId || null;
    const warehouse = warehouseId || null;

    if (warehouse && branch) {
      const stall = profiles.find(
        (p) => p.branch_id === branch && p.warehouse_id === warehouse
      );
      if (stall) return stall;
    }
    if (branch) {
      const branchProfile = profiles.find(
        (p) => p.branch_id === branch && !p.warehouse_id
      );
      if (branchProfile) return branchProfile;
    }
    return profiles.find((p) => !p.branch_id && !p.warehouse_id) ?? null;
  }, [optionsQuery.data?.profiles, branchId, warehouseId]);

  useEffect(() => {
    if (!matchingProfile) {
      setProfileId(null);
      setProfileName(defaultProfileName(branchId, warehouseId));
      setCharges(cloneCharges(DEFAULT_BILLING_CHARGES));
      return;
    }
    applyProfile(matchingProfile);
  }, [matchingProfile, branchId, warehouseId]);

  function applyProfile(profile: BillingProfile) {
    setProfileId(profile.id);
    setProfileName(profile.name);
    setCharges(
      profile.charges.length > 0
        ? cloneCharges(profile.charges)
        : cloneCharges(DEFAULT_BILLING_CHARGES)
    );
  }

  function patchCharge(index: number, patch: Partial<BillingCharge>) {
    setCharges((current) =>
      current.map((charge, i) => (i === index ? { ...charge, ...patch } : charge))
    );
  }

  function addFeeCharge() {
    setCharges((current) => [
      ...current,
      emptyCharge({
        code: `FEE${current.filter((c) => c.charge_kind === "fee").length + 1}`,
        name: "Biaya unik",
        charge_kind: "fee",
        calc_method: "fixed",
        apply_order: 50,
      }),
    ]);
  }

  function removeCharge(index: number) {
    setCharges((current) => current.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (charges.length === 0) {
      toast.error("Minimal satu baris biaya diperlukan");
      return;
    }
    const codes = charges.map((c) => c.code.trim().toUpperCase());
    if (codes.some((code) => !code)) {
      toast.error("Setiap biaya wajib punya uniqcode");
      return;
    }
    if (new Set(codes).size !== codes.length) {
      toast.error("Kode biaya harus unik");
      return;
    }

    try {
      const isEditingExactScope =
        matchingProfile &&
        (matchingProfile.branch_id || null) === (branchId || null) &&
        (matchingProfile.warehouse_id || null) === (warehouseId || null);

      const saved = await saveMutation.mutateAsync({
        id: isEditingExactScope ? profileId : null,
        branch_id: branchId || null,
        warehouse_id: warehouseId || null,
        name: profileName.trim() || "Profil Billing",
        charges: charges.map((charge) => ({
          code: charge.code.trim().toUpperCase(),
          name: charge.name.trim() || charge.code,
          charge_kind: charge.charge_kind,
          calc_method: charge.calc_method,
          rate: Number(charge.rate) || 0,
          amount: Number(charge.amount) || 0,
          apply_order: Number(charge.apply_order) || 0,
          is_enabled: charge.is_enabled,
          is_optional: charge.is_optional,
          base: charge.base,
        })),
      });
      applyProfile(saved);
      toast.success("Pengaturan billing berhasil disimpan");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan");
    }
  }

  const editingScopeLabel = warehouseId
    ? "Override stall"
    : branchId
      ? "Default cabang"
      : "Default sistem";

  return (
    <div className="w-full space-y-6">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <Receipt className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Konfigurasi Billing</h1>
          <p className="text-sm text-muted-foreground">
            Pajak, service charge, kode biaya unik, dan pembulatan — per cabang atau stall.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200/70 bg-card p-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Cabang</span>
            <Select
              value={branchId || "system"}
              onValueChange={(value) => {
                setBranchId(value === "system" ? "" : value);
                setWarehouseId("");
              }}
            >
              <SelectTrigger className="h-10 border-gray-200/80">
                <SelectValue placeholder="Default sistem" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">Default sistem</SelectItem>
                {(optionsQuery.data?.branches ?? []).map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-medium">Stall (opsional override)</span>
            <div className={!branchId ? "pointer-events-none opacity-50" : undefined}>
              <Select
                value={warehouseId || "all"}
                onValueChange={(value) => {
                  if (!branchId) return;
                  setWarehouseId(value === "all" ? "" : value);
                }}
              >
                <SelectTrigger className="h-10 border-gray-200/80">
                  <SelectValue placeholder="Semua stall di cabang" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua stall di cabang</SelectItem>
                  {warehouses.map((stall) => (
                    <SelectItem key={stall.id} value={stall.id}>
                      {stall.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-medium">Nama profil</span>
            <Input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="h-10 border-gray-200/80"
            />
          </label>
        </div>

        <div className="rounded-xl border border-gray-200/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Scope yang diedit:{" "}
          <span className="font-medium text-foreground">{editingScopeLabel}</span>
          {matchingProfile ? (
            <>
              {" "}
              · dimuat dari{" "}
              <span className="font-medium text-foreground">
                {profileScopeLabel(matchingProfile.scope)}
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200/70 bg-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200/70 px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Baris biaya</div>
            <div className="text-xs text-muted-foreground">
              Biaya dengan uniqcode akan ditagihkan ke customer di setiap transaksi.
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addFeeCharge}>
            <Plus className="mr-1.5 h-4 w-4" />
            Tambah kode biaya
          </Button>
        </div>

        {optionsQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="divide-y divide-gray-200/60">
            {charges.map((charge, index) => (
              <div key={`${charge.code}-${index}`} className="grid grid-cols-12 gap-3 p-4">
                <label className="col-span-12 space-y-1 sm:col-span-6 lg:col-span-2">
                  <span className="text-xs font-medium text-muted-foreground">Kode</span>
                  <Input
                    value={charge.code}
                    onChange={(e) =>
                      patchCharge(index, { code: e.target.value.toUpperCase() })
                    }
                    className="h-9 border-gray-200/80 font-mono"
                  />
                </label>
                <label className="col-span-12 space-y-1 sm:col-span-6 lg:col-span-2">
                  <span className="text-xs font-medium text-muted-foreground">Nama</span>
                  <Input
                    value={charge.name}
                    onChange={(e) => patchCharge(index, { name: e.target.value })}
                    className="h-9 border-gray-200/80"
                  />
                </label>
                <label className="col-span-12 space-y-1 sm:col-span-6 lg:col-span-2">
                  <span className="text-xs font-medium text-muted-foreground">Jenis</span>
                  <Select
                    value={charge.charge_kind}
                    onValueChange={(value) =>
                      patchCharge(index, {
                        charge_kind: value as BillingCharge["charge_kind"],
                      })
                    }
                  >
                    <SelectTrigger className="h-9 border-gray-200/80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tax">Pajak</SelectItem>
                      <SelectItem value="service">Service</SelectItem>
                      <SelectItem value="fee">Biaya (uniqcode)</SelectItem>
                      <SelectItem value="rounding">Pembulatan</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="col-span-12 space-y-1 sm:col-span-6 lg:col-span-2">
                  <span className="text-xs font-medium text-muted-foreground">Metode</span>
                  <Select
                    value={charge.calc_method}
                    onValueChange={(value) =>
                      patchCharge(index, {
                        calc_method: value as BillingCharge["calc_method"],
                      })
                    }
                  >
                    <SelectTrigger className="h-9 border-gray-200/80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">Persen</SelectItem>
                      <SelectItem value="fixed">Nominal tetap</SelectItem>
                      <SelectItem value="round_nearest">Bulatkan terdekat</SelectItem>
                      <SelectItem value="round_up">Bulatkan ke atas</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="col-span-6 space-y-1 lg:col-span-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {charge.calc_method === "percent"
                      ? "Tarif %"
                      : charge.charge_kind === "rounding"
                        ? "Kelipatan"
                        : "Nominal"}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    value={
                      charge.calc_method === "fixed" ? charge.amount : charge.rate
                    }
                    onChange={(e) => {
                      const value = Number(e.target.value) || 0;
                      if (charge.calc_method === "fixed") {
                        patchCharge(index, { amount: value });
                      } else {
                        patchCharge(index, { rate: value });
                      }
                    }}
                    className="h-9 border-gray-200/80"
                  />
                </label>
                <label className="col-span-6 space-y-1 lg:col-span-1">
                  <span className="text-xs font-medium text-muted-foreground">Urutan</span>
                  <Input
                    type="number"
                    value={charge.apply_order}
                    onChange={(e) =>
                      patchCharge(index, {
                        apply_order: Number.parseInt(e.target.value, 10) || 0,
                      })
                    }
                    className="h-9 border-gray-200/80"
                  />
                </label>
                <div className="col-span-12 flex flex-wrap items-end gap-3 lg:col-span-2">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={charge.is_enabled}
                      onChange={(e) =>
                        patchCharge(index, { is_enabled: e.target.checked })
                      }
                      className="accent-[hsl(var(--primary))]"
                    />
                    Aktif
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={charge.is_optional}
                      onChange={(e) =>
                        patchCharge(index, { is_optional: e.target.checked })
                      }
                      className="accent-[hsl(var(--primary))]"
                    />
                    Opsional
                  </label>
                  {charge.charge_kind === "fee" ? (
                    <button
                      type="button"
                      onClick={() => removeCharge(index)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                      aria-label={`Hapus ${charge.code}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={saveMutation.isPending || optionsQuery.isLoading}
          className="bg-primary hover:bg-primary/90"
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Menyimpan…
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Simpan pengaturan
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
