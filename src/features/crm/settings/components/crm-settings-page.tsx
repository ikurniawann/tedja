"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Coins,
  Crown,
  Gift,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import type { CrmTierConfig, CrmXpRuleConfig } from "../types";
import {
  getCrmSettings,
  listCrmTiers,
  listCrmXpRules,
  saveCrmTier,
  saveCrmXpRule,
  updateCrmSettings,
} from "../api";

const numberFormat = new Intl.NumberFormat("id-ID");

function formatNumber(value: number) {
  return numberFormat.format(value || 0);
}

const XP_MODE_LABELS: Record<CrmXpRuleConfig["xp_mode"], string> = {
  fixed: "Fixed",
  per_item: "Per item",
  per_amount: "Per nominal",
  multiplier: "Multiplier",
  percentage: "Persentase",
};

type TierForm = {
  code: string;
  name: string;
  rank: number;
  min_lifetime_xp: string;
  discount_percent: string;
  xp_multiplier: string;
  is_active: boolean;
};

type RuleForm = {
  code: string;
  name: string;
  source_type: string;
  xp_mode: CrmXpRuleConfig["xp_mode"];
  xp_value: string;
  amount_step: string;
  min_amount: string;
  max_xp_per_event: string;
  tier_multiplier_enabled: boolean;
  priority: string;
  is_active: boolean;
};

const emptyRuleForm: RuleForm = {
  code: "",
  name: "",
  source_type: "order_amount",
  xp_mode: "per_amount",
  xp_value: "1",
  amount_step: "1000",
  min_amount: "0",
  max_xp_per_event: "",
  tier_multiplier_enabled: true,
  priority: "100",
  is_active: true,
};

export function CrmSettingsPage() {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({ queryKey: ["crm", "settings"], queryFn: getCrmSettings });
  const tiersQuery = useQuery({ queryKey: ["crm", "settings", "tiers"], queryFn: listCrmTiers });
  const rulesQuery = useQuery({ queryKey: ["crm", "settings", "xp-rules"], queryFn: listCrmXpRules });

  const [bonusPercent, setBonusPercent] = useState("");
  const [freeXp, setFreeXp] = useState("");
  const [tierForm, setTierForm] = useState<TierForm | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm | null>(null);
  const [ruleFormIsNew, setRuleFormIsNew] = useState(false);

  useEffect(() => {
    if (settingsQuery.data) {
      setBonusPercent(String(settingsQuery.data.topup_bonus_percent));
      setFreeXp(String(settingsQuery.data.profile_completion_free_xp));
    }
  }, [settingsQuery.data]);

  const saveSettingsMutation = useMutation({
    mutationFn: updateCrmSettings,
    onSuccess: () => {
      toast.success("Konfigurasi loyalty berhasil disimpan");
      queryClient.invalidateQueries({ queryKey: ["crm", "settings"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan konfigurasi");
    },
  });

  const saveTierMutation = useMutation({
    mutationFn: saveCrmTier,
    onSuccess: () => {
      toast.success("Tier berhasil disimpan");
      setTierForm(null);
      queryClient.invalidateQueries({ queryKey: ["crm", "settings", "tiers"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan tier");
    },
  });

  const saveRuleMutation = useMutation({
    mutationFn: saveCrmXpRule,
    onSuccess: () => {
      toast.success("XP rule berhasil disimpan");
      setRuleForm(null);
      queryClient.invalidateQueries({ queryKey: ["crm", "settings", "xp-rules"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan XP rule");
    },
  });

  const tiers = tiersQuery.data ?? [];
  const rules = rulesQuery.data ?? [];
  const loading = settingsQuery.isLoading || tiersQuery.isLoading || rulesQuery.isLoading;

  function refetchAll() {
    void settingsQuery.refetch();
    void tiersQuery.refetch();
    void rulesQuery.refetch();
  }

  function editTier(tier: CrmTierConfig) {
    setTierForm({
      code: tier.code,
      name: tier.name,
      rank: Number(tier.rank) || 0,
      min_lifetime_xp: String(Number(tier.min_lifetime_xp) || 0),
      discount_percent: String(Number(tier.discount_percent) || 0),
      xp_multiplier: String(Number(tier.xp_multiplier) || 1),
      is_active: tier.is_active !== false,
    });
  }

  function submitTier() {
    if (!tierForm) return;
    const existing = tiers.find((tier) => tier.code === tierForm.code);
    saveTierMutation.mutate({
      code: tierForm.code,
      name: tierForm.name.trim(),
      rank: tierForm.rank,
      min_lifetime_xp: Number(tierForm.min_lifetime_xp) || 0,
      min_total_spend: Number(existing?.min_total_spend) || 0,
      xp_multiplier: Number(tierForm.xp_multiplier) || 1,
      discount_percent: Number(tierForm.discount_percent) || 0,
      display_color: existing?.display_color,
      is_active: tierForm.is_active,
    });
  }

  function editRule(rule: CrmXpRuleConfig) {
    setRuleFormIsNew(false);
    setRuleForm({
      code: rule.code,
      name: rule.name,
      source_type: rule.source_type,
      xp_mode: rule.xp_mode,
      xp_value: String(Number(rule.xp_value) || 0),
      amount_step: String(Number(rule.amount_step) || 1),
      min_amount: String(Number(rule.min_amount) || 0),
      max_xp_per_event: rule.max_xp_per_event == null ? "" : String(rule.max_xp_per_event),
      tier_multiplier_enabled: rule.tier_multiplier_enabled !== false,
      priority: String(Number(rule.priority) || 100),
      is_active: rule.is_active !== false,
    });
  }

  function submitRule() {
    if (!ruleForm) return;
    if (!ruleForm.code.trim() || !ruleForm.name.trim()) {
      toast.error("Code dan nama XP rule wajib diisi");
      return;
    }
    saveRuleMutation.mutate({
      code: ruleForm.code.trim().toLowerCase(),
      name: ruleForm.name.trim(),
      source_channel: "pos",
      source_type: ruleForm.source_type,
      xp_mode: ruleForm.xp_mode,
      xp_value: Number(ruleForm.xp_value) || 0,
      amount_step: Number(ruleForm.amount_step) || 1,
      min_amount: Number(ruleForm.min_amount) || 0,
      max_xp_per_event: ruleForm.max_xp_per_event === "" ? null : Number(ruleForm.max_xp_per_event) || 0,
      tier_multiplier_enabled: ruleForm.tier_multiplier_enabled,
      priority: Number(ruleForm.priority) || 100,
      is_active: ruleForm.is_active,
    });
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/dashboard/crm" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900">
              <ArrowLeft className="size-4" />
              CRM Dashboard
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">Konfigurasi Loyalty</h1>
            <p className="mt-1 text-sm text-slate-500">
              Tier, XP rules, bonus topup, dan Free XP — hanya Super Admin yang bisa menyimpan.
            </p>
          </div>
          <button
            type="button"
            onClick={refetchAll}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Loyalty settings */}
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
            <Settings2 className="size-4 text-slate-600" />
            <h2 className="text-base font-semibold text-slate-950">Bonus Topup & Free XP</h2>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <label className="block text-sm">
              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <Coins className="size-3.5" />
                Bonus topup ARK Coin (%)
              </span>
              <input
                type="number"
                min={0}
                max={100}
                value={bonusPercent}
                onChange={(event) => setBonusPercent(event.target.value)}
                disabled={settingsQuery.isLoading || saveSettingsMutation.isPending}
                className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-100"
              />
              <span className="mt-1 block text-xs text-slate-400">
                Contoh: 10% → topup 1jt mendapat saldo 1,1jt (bonus dicatat terpisah).
              </span>
            </label>
            <label className="block text-sm">
              <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <Sparkles className="size-3.5" />
                Free XP profil 100% komplit
              </span>
              <input
                type="number"
                min={0}
                value={freeXp}
                onChange={(event) => setFreeXp(event.target.value)}
                disabled={settingsQuery.isLoading || saveSettingsMutation.isPending}
                className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-100"
              />
              <span className="mt-1 block text-xs text-slate-400">
                Sekali seumur hidup per member, berlaku semua tipe member.
              </span>
            </label>
            <button
              type="button"
              onClick={() =>
                saveSettingsMutation.mutate({
                  topup_bonus_percent: Math.min(100, Math.max(0, Number(bonusPercent) || 0)),
                  profile_completion_free_xp: Math.max(0, Math.floor(Number(freeXp) || 0)),
                })
              }
              disabled={saveSettingsMutation.isPending || settingsQuery.isLoading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Save className="size-4" />
              {saveSettingsMutation.isPending ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </section>

        {/* Tiers */}
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <Crown className="size-4" />
              Membership Tiers
            </h2>
            <span className="text-xs text-slate-500">
              Tier ditentukan murni dari lifetime XP (ambang `min XP`).
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase text-slate-500">
                  <th className="px-4 py-3">Tier</th>
                  <th className="px-4 py-3 text-right">Min Lifetime XP</th>
                  <th className="px-4 py-3 text-right">Diskon (%)</th>
                  <th className="px-4 py-3 text-right">XP Multiplier</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tiersQuery.isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">Memuat tier...</td>
                  </tr>
                ) : tiers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">Belum ada tier.</td>
                  </tr>
                ) : (
                  tiers.map((tier) => (
                    <tr key={tier.code} className="transition hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-950">{tier.name}</div>
                        <div className="mt-0.5 text-xs text-slate-500">rank {tier.rank} · {tier.code}</div>
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">{formatNumber(Number(tier.min_lifetime_xp) || 0)}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-emerald-700">{Number(tier.discount_percent) || 0}%</td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">{Number(tier.xp_multiplier) || 1}x</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-sm px-2 py-1 text-xs font-medium ${tier.is_active !== false ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          {tier.is_active !== false ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => editTier(tier)}
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                        >
                          <Pencil className="size-3.5" />
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {tierForm && (
            <div className="border-t border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-950">Edit Tier: {tierForm.code}</h3>
                <button
                  type="button"
                  onClick={() => setTierForm(null)}
                  className="inline-flex size-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-200"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">Nama tier</span>
                  <input
                    value={tierForm.name}
                    onChange={(event) => setTierForm((current) => current && { ...current, name: event.target.value })}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">Min lifetime XP</span>
                  <input
                    type="number"
                    min={0}
                    value={tierForm.min_lifetime_xp}
                    onChange={(event) => setTierForm((current) => current && { ...current, min_lifetime_xp: event.target.value })}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">Diskon (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={tierForm.discount_percent}
                    onChange={(event) => setTierForm((current) => current && { ...current, discount_percent: event.target.value })}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">XP multiplier</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={tierForm.xp_multiplier}
                    onChange={(event) => setTierForm((current) => current && { ...current, xp_multiplier: event.target.value })}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  />
                </label>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={tierForm.is_active}
                    onChange={(event) => setTierForm((current) => current && { ...current, is_active: event.target.checked })}
                    className="size-4 rounded border-slate-300"
                  />
                  Tier aktif
                </label>
                <button
                  type="button"
                  onClick={submitTier}
                  disabled={saveTierMutation.isPending || !tierForm.name.trim()}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Save className="size-4" />
                  {saveTierMutation.isPending ? "Menyimpan..." : "Simpan Tier"}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* XP Rules */}
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <Gift className="size-4" />
              XP Rules (POS)
            </h2>
            <button
              type="button"
              onClick={() => {
                setRuleFormIsNew(true);
                setRuleForm(emptyRuleForm);
              }}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
            >
              <Plus className="size-3.5" />
              Rule baru
            </button>
          </div>
          <div className="px-4 py-3 text-xs text-slate-500">
            XP hanya diberikan untuk pembayaran penuh dengan ARK Coin (EPIC-011). Rules
            menentukan besaran XP per transaksi/produk.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase text-slate-500">
                  <th className="px-4 py-3">Rule</th>
                  <th className="px-4 py-3">Sumber</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3 text-right">Nilai XP</th>
                  <th className="px-4 py-3 text-right">Per Nominal</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rulesQuery.isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">Memuat XP rules...</td>
                  </tr>
                ) : rules.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                      Belum ada XP rule — tanpa rule, transaksi ARK Coin tidak menghasilkan XP.
                    </td>
                  </tr>
                ) : (
                  rules.map((rule) => (
                    <tr key={rule.code} className="transition hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-950">{rule.name}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{rule.code} · prio {rule.priority}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{rule.source_type}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{XP_MODE_LABELS[rule.xp_mode] ?? rule.xp_mode}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-emerald-700">{formatNumber(Number(rule.xp_value) || 0)}</td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">
                        {rule.xp_mode === "per_amount" ? `Rp ${formatNumber(Number(rule.amount_step) || 1)}` : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-sm px-2 py-1 text-xs font-medium ${rule.is_active !== false ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          {rule.is_active !== false ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => editRule(rule)}
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                        >
                          <Pencil className="size-3.5" />
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {ruleForm && (
            <div className="border-t border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-950">
                  {ruleFormIsNew ? "XP Rule Baru" : `Edit Rule: ${ruleForm.code}`}
                </h3>
                <button
                  type="button"
                  onClick={() => setRuleForm(null)}
                  className="inline-flex size-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-200"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">Code</span>
                  <input
                    value={ruleForm.code}
                    onChange={(event) => setRuleForm((current) => current && { ...current, code: event.target.value })}
                    disabled={!ruleFormIsNew}
                    placeholder="pos-order-amount"
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">Nama</span>
                  <input
                    value={ruleForm.name}
                    onChange={(event) => setRuleForm((current) => current && { ...current, name: event.target.value })}
                    placeholder="XP per belanja"
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">Sumber</span>
                  <select
                    value={ruleForm.source_type}
                    onChange={(event) => setRuleForm((current) => current && { ...current, source_type: event.target.value })}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  >
                    <option value="order_amount">Nominal order</option>
                    <option value="product">Produk</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">Mode</span>
                  <select
                    value={ruleForm.xp_mode}
                    onChange={(event) => setRuleForm((current) => current && { ...current, xp_mode: event.target.value as RuleForm["xp_mode"] })}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  >
                    {Object.entries(XP_MODE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">Nilai XP</span>
                  <input
                    type="number"
                    min={0}
                    value={ruleForm.xp_value}
                    onChange={(event) => setRuleForm((current) => current && { ...current, xp_value: event.target.value })}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">Step nominal (Rp)</span>
                  <input
                    type="number"
                    min={1}
                    value={ruleForm.amount_step}
                    onChange={(event) => setRuleForm((current) => current && { ...current, amount_step: event.target.value })}
                    disabled={ruleForm.xp_mode !== "per_amount"}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">Min transaksi (Rp)</span>
                  <input
                    type="number"
                    min={0}
                    value={ruleForm.min_amount}
                    onChange={(event) => setRuleForm((current) => current && { ...current, min_amount: event.target.value })}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">Max XP per transaksi</span>
                  <input
                    type="number"
                    min={0}
                    value={ruleForm.max_xp_per_event}
                    onChange={(event) => setRuleForm((current) => current && { ...current, max_xp_per_event: event.target.value })}
                    placeholder="Tanpa batas"
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={ruleForm.tier_multiplier_enabled}
                      onChange={(event) => setRuleForm((current) => current && { ...current, tier_multiplier_enabled: event.target.checked })}
                      className="size-4 rounded border-slate-300"
                    />
                    Kalikan multiplier tier
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={ruleForm.is_active}
                      onChange={(event) => setRuleForm((current) => current && { ...current, is_active: event.target.checked })}
                      className="size-4 rounded border-slate-300"
                    />
                    Rule aktif
                  </label>
                </div>
                <button
                  type="button"
                  onClick={submitRule}
                  disabled={saveRuleMutation.isPending || !ruleForm.code.trim() || !ruleForm.name.trim()}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Save className="size-4" />
                  {saveRuleMutation.isPending ? "Menyimpan..." : "Simpan Rule"}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
