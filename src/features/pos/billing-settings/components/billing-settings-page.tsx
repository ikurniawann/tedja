"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Loader2,
  Percent,
  Plus,
  Receipt,
  Save,
  Trash2,
  Utensils,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { cn } from "@/lib/utils";
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

function defaultCharge(kind: "tax" | "service"): BillingCharge {
  const found = DEFAULT_BILLING_CHARGES.find((c) => c.charge_kind === kind);
  return cloneCharges([found ?? emptyCharge({ charge_kind: kind })])[0]!;
}

/** Pastikan TAX + SERVICE selalu ada di state UI. */
function ensureCoreCharges(charges: BillingCharge[]): BillingCharge[] {
  const next = cloneCharges(charges);
  if (!next.some((c) => c.charge_kind === "tax")) {
    next.push(defaultCharge("tax"));
  }
  if (!next.some((c) => c.charge_kind === "service")) {
    next.push(defaultCharge("service"));
  }
  return next;
}

function defaultProfileName(branchId: string, warehouseId: string) {
  if (warehouseId) return "Billing Stall";
  if (branchId) return "Billing Cabang";
  return "Default Sistem";
}

function CoreChargeCard({
  title,
  description,
  icon: Icon,
  charge,
  onChange,
}: {
  title: string;
  description: string;
  icon: typeof Percent;
  charge: BillingCharge;
  onChange: (patch: Partial<BillingCharge>) => void;
}) {
  return (
    <div className="rounded-2xl border border-gray-200/70 bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Aktif</span>
          <Switch
            checked={charge.is_enabled}
            onCheckedChange={(checked) => onChange({ is_enabled: checked })}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-sm font-medium">Label di kasir</span>
          <Input
            value={charge.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="h-10 border-gray-200/80"
            disabled={!charge.is_enabled}
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">Tarif (%)</span>
          <Input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={charge.rate}
            onChange={(e) =>
              onChange({
                calc_method: "percent",
                rate: Number(e.target.value) || 0,
              })
            }
            className="h-10 border-gray-200/80"
            disabled={!charge.is_enabled}
          />
        </label>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-xl border border-gray-200/70 bg-muted/30 px-3 py-2.5">
        <div>
          <div className="text-sm font-medium text-foreground">Opsional di kasir</div>
          <div className="text-xs text-muted-foreground">
            Kasir bisa centang/hilangkan per transaksi
          </div>
        </div>
        <Switch
          checked={charge.is_optional}
          onCheckedChange={(checked) => onChange({ is_optional: checked })}
          disabled={!charge.is_enabled}
        />
      </label>
    </div>
  );
}

export function BillingSettingsPage() {
  const [branchId, setBranchId] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [profileName, setProfileName] = useState("Profil Billing");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [charges, setCharges] = useState<BillingCharge[]>(() =>
    ensureCoreCharges(DEFAULT_BILLING_CHARGES)
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
      setCharges(ensureCoreCharges(DEFAULT_BILLING_CHARGES));
      return;
    }
    applyProfile(matchingProfile);
  }, [matchingProfile, branchId, warehouseId]);

  function applyProfile(profile: BillingProfile) {
    setProfileId(profile.id);
    setProfileName(profile.name);
    setCharges(
      ensureCoreCharges(
        profile.charges.length > 0
          ? cloneCharges(profile.charges)
          : cloneCharges(DEFAULT_BILLING_CHARGES)
      )
    );
  }

  function patchCharge(index: number, patch: Partial<BillingCharge>) {
    setCharges((current) =>
      current.map((charge, i) => (i === index ? { ...charge, ...patch } : charge))
    );
  }

  function patchByKind(kind: "tax" | "service", patch: Partial<BillingCharge>) {
    setCharges((current) => {
      const ensured = ensureCoreCharges(current);
      return ensured.map((charge) =>
        charge.charge_kind === kind ? { ...charge, ...patch } : charge
      );
    });
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
    setAdvancedOpen(true);
  }

  function removeCharge(index: number) {
    setCharges((current) => current.filter((_, i) => i !== index));
  }

  async function handleSave() {
    const ensured = ensureCoreCharges(charges);
    if (ensured.length === 0) {
      toast.error("Minimal satu baris biaya diperlukan");
      return;
    }
    const codes = ensured.map((c) => c.code.trim().toUpperCase());
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
        charges: ensured.map((charge) => ({
          code: charge.code.trim().toUpperCase(),
          name: charge.name.trim() || charge.code,
          charge_kind: charge.charge_kind,
          calc_method:
            charge.charge_kind === "tax" || charge.charge_kind === "service"
              ? "percent"
              : charge.calc_method,
          rate: Number(charge.rate) || 0,
          amount: Number(charge.amount) || 0,
          apply_order: Number(charge.apply_order) || 0,
          is_enabled: charge.is_enabled,
          is_optional: charge.is_optional,
          base: charge.base,
        })),
      });
      applyProfile(saved);
      toast.success("Tax & Service berhasil disimpan");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan");
    }
  }

  const editingScopeLabel = warehouseId
    ? "Override stall"
    : branchId
      ? "Default cabang"
      : "Default sistem";

  const taxCharge =
    charges.find((c) => c.charge_kind === "tax") ?? defaultCharge("tax");
  const serviceCharge =
    charges.find((c) => c.charge_kind === "service") ?? defaultCharge("service");
  const advancedCharges = charges
    .map((charge, index) => ({ charge, index }))
    .filter(
      ({ charge }) =>
        charge.charge_kind !== "tax" && charge.charge_kind !== "service"
    );

  return (
    <div className="w-full space-y-6">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <Receipt className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Tax & Service</h1>
          <p className="text-sm text-muted-foreground">
            Atur PPN dan service charge untuk kasir POS — per sistem, cabang, atau stall.
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

      {optionsQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <CoreChargeCard
              title="Tax"
              description="Pajak atas subtotal setelah diskon"
              icon={Percent}
              charge={taxCharge}
              onChange={(patch) => patchByKind("tax", patch)}
            />
            <CoreChargeCard
              title="Service Charge"
              description="Biaya layanan atas subtotal setelah diskon"
              icon={Utensils}
              charge={serviceCharge}
              onChange={(patch) => patchByKind("service", patch)}
            />
          </div>

          <div className="rounded-2xl border border-gray-200/70 bg-card overflow-hidden">
            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40"
            >
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Pengaturan lanjutan
                </div>
                <div className="text-xs text-muted-foreground">
                  Fee unik, rounding, dan baris biaya tambahan
                  {advancedCharges.length > 0
                    ? ` · ${advancedCharges.length} baris`
                    : ""}
                </div>
              </div>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  advancedOpen && "rotate-180"
                )}
              />
            </button>

            {advancedOpen ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200/70 px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    Biaya dengan uniqcode ditagihkan ke customer di setiap transaksi.
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={addFeeCharge}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    Tambah kode biaya
                  </Button>
                </div>

                <div className="divide-y divide-gray-200/60 border-t border-gray-200/70">
                  {advancedCharges.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Belum ada fee/rounding. Tambah bila perlu.
                    </div>
                  ) : (
                    advancedCharges.map(({ charge, index }) => (
                      <div
                        key={`${charge.code}-${index}`}
                        className="grid grid-cols-12 gap-3 p-4"
                      >
                        <label className="col-span-12 space-y-1 sm:col-span-6 lg:col-span-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            Kode
                          </span>
                          <Input
                            value={charge.code}
                            onChange={(e) =>
                              patchCharge(index, {
                                code: e.target.value.toUpperCase(),
                              })
                            }
                            className="h-9 border-gray-200/80 font-mono"
                          />
                        </label>
                        <label className="col-span-12 space-y-1 sm:col-span-6 lg:col-span-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            Nama
                          </span>
                          <Input
                            value={charge.name}
                            onChange={(e) =>
                              patchCharge(index, { name: e.target.value })
                            }
                            className="h-9 border-gray-200/80"
                          />
                        </label>
                        <label className="col-span-12 space-y-1 sm:col-span-6 lg:col-span-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            Jenis
                          </span>
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
                              <SelectItem value="fee">Biaya (uniqcode)</SelectItem>
                              <SelectItem value="rounding">Pembulatan</SelectItem>
                            </SelectContent>
                          </Select>
                        </label>
                        <label className="col-span-12 space-y-1 sm:col-span-6 lg:col-span-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            Metode
                          </span>
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
                              <SelectItem value="round_nearest">
                                Bulatkan terdekat
                              </SelectItem>
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
                              charge.calc_method === "fixed"
                                ? charge.amount
                                : charge.rate
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
                          <span className="text-xs font-medium text-muted-foreground">
                            Urutan
                          </span>
                          <Input
                            type="number"
                            value={charge.apply_order}
                            onChange={(e) =>
                              patchCharge(index, {
                                apply_order:
                                  Number.parseInt(e.target.value, 10) || 0,
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
                                patchCharge(index, {
                                  is_enabled: e.target.checked,
                                })
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
                                patchCharge(index, {
                                  is_optional: e.target.checked,
                                })
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
                    ))
                  )}
                </div>
              </>
            ) : null}
          </div>
        </>
      )}

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
              Simpan Tax & Service
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
