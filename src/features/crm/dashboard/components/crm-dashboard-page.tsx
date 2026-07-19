"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Award,
  CheckCircle2,
  Coins,
  Gift,
  Package,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Trophy,
  UserRound,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import type {
  CrmCustomer,
  CrmTier,
  PosProduct,
  TierConfigState,
  XpConfigState,
} from "../types";
import { toNumber } from "../api";
import { useCrmDashboard, useCrmTierConfig, useCrmXpConfig } from "../queries";
import { useSaveGlobalPosRule, useSaveTierConfig, useUpdateProductXp } from "../mutations";

const numberFormat = new Intl.NumberFormat("id-ID");
const currencyFormat = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

function formatNumber(value: number) {
  return numberFormat.format(value || 0);
}

function formatCurrency(value: number) {
  return currencyFormat.format(value || 0);
}

function tierLabel(tier: string) {
  return tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : "Bronze";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function CrmDashboardPage() {
  const dashboardQuery = useCrmDashboard();
  const xpQuery = useCrmXpConfig();
  const tierQuery = useCrmTierConfig();
  const saveTierMutation = useSaveTierConfig();
  const saveGlobalRuleMutation = useSaveGlobalPosRule();
  const updateProductXpMutation = useUpdateProductXp();

  const [xpConfig, setXpConfig] = useState<XpConfigState>({
    loading: true,
    savingKey: null,
    message: null,
    error: null,
    rules: [],
    products: [],
    productDraft: {},
    globalRuleDraft: {
      xp_value: 2,
      amount_step: 10000,
      tier_multiplier_enabled: true,
    },
  });
  const [tierConfig, setTierConfig] = useState<TierConfigState>({
    loading: true,
    savingCode: null,
    message: null,
    error: null,
    tiers: [],
    draft: {},
  });

  useEffect(() => {
    if (!xpQuery.data) return;
    setXpConfig((current) => ({
      ...current,
      loading: xpQuery.isLoading,
      rules: xpQuery.data.rules,
      products: xpQuery.data.products,
      productDraft: xpQuery.data.productDraft,
      globalRuleDraft: xpQuery.data.globalRuleDraft,
    }));
  }, [xpQuery.data, xpQuery.isLoading]);

  useEffect(() => {
    if (!tierQuery.data) return;
    setTierConfig((current) => ({
      ...current,
      loading: tierQuery.isLoading,
      tiers: tierQuery.data.tiers,
      draft: tierQuery.data.draft,
    }));
  }, [tierQuery.data, tierQuery.isLoading]);

  const dashboardData = dashboardQuery.data?.data ?? null;
  const schemaReady = dashboardQuery.data?.schemaReady ?? false;
  const dashboardLoading = dashboardQuery.isLoading || dashboardQuery.isFetching;
  const dashboardError = dashboardQuery.error instanceof Error ? dashboardQuery.error.message : null;

  async function saveTierConfigHandler(tierCode: string) {
    const draft = tierConfig.draft[tierCode];
    if (!draft) return;

    setTierConfig((current) => ({ ...current, savingCode: tierCode, error: null, message: null }));

    try {
      await saveTierMutation.mutateAsync(draft);
      setTierConfig((current) => ({ ...current, savingCode: null, message: `Tier ${draft.name} tersimpan.` }));
    } catch (err) {
      setTierConfig((current) => ({
        ...current,
        savingCode: null,
        error: err instanceof Error ? err.message : "Gagal menyimpan tier CRM",
      }));
    }
  }

  async function saveGlobalPosRule() {
    setXpConfig((current) => ({ ...current, savingKey: "global", error: null, message: null }));

    try {
      await saveGlobalRuleMutation.mutateAsync(xpConfig.globalRuleDraft);
      setXpConfig((current) => ({ ...current, savingKey: null, message: "Rule XP transaksi tersimpan." }));
    } catch (err) {
      setXpConfig((current) => ({
        ...current,
        savingKey: null,
        error: err instanceof Error ? err.message : "Gagal menyimpan rule XP transaksi",
      }));
    }
  }

  async function saveProductXp(product: PosProduct) {
    const xp = Math.max(0, toNumber(xpConfig.productDraft[product.id]));
    setXpConfig((current) => ({ ...current, savingKey: product.id, error: null, message: null }));

    try {
      await updateProductXpMutation.mutateAsync({ productId: product.id, xp });
      setXpConfig((current) => ({ ...current, savingKey: null, message: `XP ${product.name} tersimpan.` }));
    } catch (err) {
      setXpConfig((current) => ({
        ...current,
        savingKey: null,
        error: err instanceof Error ? err.message : "Gagal menyimpan XP produk",
      }));
    }
  }

  function refreshAll() {
    void dashboardQuery.refetch();
    void xpQuery.refetch();
    void tierQuery.refetch();
  }

  const stats = dashboardData?.stats;
  const statCards = useMemo(
    () => [
      { label: "Customers", value: stats?.totalCustomers ?? 0, icon: UsersRound, tone: "text-sky-700 bg-sky-50" },
      { label: "Members", value: stats?.totalMembers ?? 0, icon: UserRound, tone: "text-emerald-700 bg-emerald-50" },
      { label: "XP Rules", value: stats?.xpRuleCount ?? 0, icon: Sparkles, tone: "text-violet-700 bg-violet-50" },
      { label: "Rewards", value: stats?.rewardCount ?? 0, icon: Gift, tone: "text-rose-700 bg-rose-50" },
      { label: "Avatars", value: stats?.avatarCount ?? 0, icon: Award, tone: "text-amber-700 bg-amber-50" },
      { label: "Partner Events", value: stats?.externalEventCount ?? 0, icon: Trophy, tone: "text-cyan-700 bg-cyan-50" },
    ],
    [stats]
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">CRM</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">Membership & Loyalty</h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link
              href="/dashboard/crm/members"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
            >
              <UsersRound className="size-4" />
              Members
            </Link>
            <Link
              href="/dashboard/crm/rewards"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              <Gift className="size-4" />
              Rewards
            </Link>
            <Link
              href="/dashboard/crm/avatars"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              <Award className="size-4" />
              Avatars
            </Link>
            <Link
              href="/dashboard/crm/settings"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              <Settings2 className="size-4" />
              Konfigurasi
            </Link>
            <button
              type="button"
              onClick={refreshAll}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-60"
              disabled={dashboardLoading}
            >
              <RefreshCw className={`size-4 ${dashboardLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {!schemaReady && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            CRM schema belum aktif di database. Dashboard saat ini membaca data awal dari POS customer.
          </div>
        )}

        {dashboardError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {dashboardError}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {statCards.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className={`mb-3 flex size-10 items-center justify-center rounded-md ${item.tone}`}>
                  <Icon className="size-5" />
                </div>
                <div className="text-2xl font-semibold text-slate-950">{formatNumber(item.value)}</div>
                <div className="mt-1 text-sm text-slate-500">{item.label}</div>
              </div>
            );
          })}
        </section>

        <TierConfigurationPanel
          config={tierConfig}
          onReload={() => void tierQuery.refetch()}
          onDraftChange={(tierCode, draft) =>
            setTierConfig((current) => ({
              ...current,
              draft: {
                ...current.draft,
                [tierCode]: {
                  ...current.draft[tierCode],
                  ...draft,
                },
              },
            }))
          }
          onSave={(tierCode) => void saveTierConfigHandler(tierCode)}
        />

        <XpConfigurationPanel
          config={xpConfig}
          onReload={() => void xpQuery.refetch()}
          onSaveGlobal={() => void saveGlobalPosRule()}
          onGlobalDraftChange={(draft) =>
            setXpConfig((current) => ({
              ...current,
              globalRuleDraft: { ...current.globalRuleDraft, ...draft },
            }))
          }
          onProductDraftChange={(productId, value) =>
            setXpConfig((current) => ({
              ...current,
              productDraft: { ...current.productDraft, [productId]: value },
            }))
          }
          onSaveProduct={(product) => void saveProductXp(product)}
        />

        <section className="grid gap-4 xl:grid-cols-3">
          <LeaderboardTable
            title="Member Paling Loyal"
            valueLabel="XP"
            rows={dashboardData?.topLoyalMembers ?? []}
            getValue={(customer) => formatNumber(customer.total_xp)}
          />
          <LeaderboardTable
            title="Top Spender Transaksi"
            valueLabel="Spend"
            rows={dashboardData?.topTransactionSpenders ?? []}
            getValue={(customer) => formatCurrency(customer.total_spent)}
          />
          <ArkCoinsTable rows={dashboardData?.topArkSpenders ?? []} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-semibold text-slate-950">XP Activity</h2>
              <span className="text-xs text-slate-500">{formatNumber(dashboardData?.recentXpActivity.length ?? 0)} records</span>
            </div>
            <div className="p-4">
              {schemaReady && (dashboardData?.recentXpActivity.length ?? 0) > 0 ? (
                <div className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200">
                  {dashboardData?.recentXpActivity.map((activity) => (
                    <div key={activity.id} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {activity.description || `${activity.source_channel} ${activity.source_type}`}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {activity.member?.member_code || "Member"} · {formatDateTime(activity.created_at)}
                        </div>
                      </div>
                      <div className={`text-sm font-semibold ${activity.xp_delta >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {activity.xp_delta >= 0 ? "+" : ""}
                        {formatNumber(activity.xp_delta)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : schemaReady ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  Belum ada aktivitas XP ledger.
                </div>
              ) : (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  XP ledger akan muncul setelah migration CRM aktif dan POS checkout terhubung di Phase 2.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">Foundation Status</h2>
            <div className="mt-4 space-y-3">
              <StatusRow label="Membership tiers" value={stats?.tierCount ?? 0} ready={schemaReady} />
              <StatusRow label="XP rule config" value={stats?.xpRuleCount ?? 0} ready={schemaReady} />
              <StatusRow label="Reward catalog" value={stats?.rewardCount ?? 0} ready={schemaReady} />
              <StatusRow label="Avatar catalog" value={stats?.avatarCount ?? 0} ready={schemaReady} />
              <StatusRow label="Partner event audit" value={stats?.externalEventCount ?? 0} ready={schemaReady} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function XpConfigurationPanel({
  config,
  onReload,
  onSaveGlobal,
  onGlobalDraftChange,
  onProductDraftChange,
  onSaveProduct,
}: {
  config: XpConfigState;
  onReload: () => void;
  onSaveGlobal: () => void;
  onGlobalDraftChange: (draft: Partial<XpConfigState["globalRuleDraft"]>) => void;
  onProductDraftChange: (productId: string, value: number) => void;
  onSaveProduct: (product: PosProduct) => void;
}) {
  const productPreview = config.products.slice(0, 8);
  const configuredProductCount = config.products.filter((product) => toNumber(product.xp ?? product.xp_points) > 0).length;

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Konfigurasi XP POS</h2>
          <p className="mt-1 text-sm text-slate-500">Atur XP transaksi dan XP produk yang dipakai cashier.</p>
        </div>
        <button
          type="button"
          onClick={onReload}
          disabled={config.loading}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
        >
          <RefreshCw className={`size-4 ${config.loading ? "animate-spin" : ""}`} />
          Reload
        </button>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-md border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Sparkles className="size-4 text-violet-600" />
            Rule Transaksi
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-500">XP per step</span>
              <input
                type="number"
                min="0"
                value={config.globalRuleDraft.xp_value}
                onChange={(event) => onGlobalDraftChange({ xp_value: Number(event.target.value) || 0 })}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-500">Amount step</span>
              <input
                type="number"
                min="1"
                value={config.globalRuleDraft.amount_step}
                onChange={(event) => onGlobalDraftChange({ amount_step: Number(event.target.value) || 1 })}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
              />
            </label>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={config.globalRuleDraft.tier_multiplier_enabled}
              onChange={(event) => onGlobalDraftChange({ tier_multiplier_enabled: event.target.checked })}
              className="size-4 rounded border-slate-300 text-violet-600"
            />
            Tier multiplier aktif
          </label>
          <div className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Preview: {formatNumber(config.globalRuleDraft.xp_value)} XP setiap {formatCurrency(config.globalRuleDraft.amount_step)} transaksi.
          </div>
          <button
            type="button"
            onClick={onSaveGlobal}
            disabled={config.savingKey === "global"}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            <Save className="size-4" />
            Simpan Rule
          </button>
        </div>

        <div className="rounded-md border border-slate-200">
          <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Package className="size-4 text-sky-600" />
              XP Produk
            </div>
            <span className="text-xs text-slate-500">{configuredProductCount} produk configured</span>
          </div>

          {config.loading ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">Memuat konfigurasi XP...</div>
          ) : productPreview.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">Belum ada produk POS.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {productPreview.map((product) => {
                const draftValue = config.productDraft[product.id] ?? 0;
                const currentValue = toNumber(product.xp ?? product.xp_points);
                const isDirty = draftValue !== currentValue;
                return (
                  <div key={product.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_120px_92px] sm:items-center">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">{product.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{product.sku}</span>
                        <span>{product.category?.name || "Uncategorized"}</span>
                        <span>{formatCurrency(product.base_price)}</span>
                      </div>
                    </div>
                    <input
                      type="number"
                      min="0"
                      value={draftValue}
                      onChange={(event) => onProductDraftChange(product.id, Number(event.target.value) || 0)}
                      className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                      aria-label={`XP ${product.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => onSaveProduct(product)}
                      disabled={!isDirty || config.savingKey === product.id}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                    >
                      {isDirty ? <Save className="size-4" /> : <CheckCircle2 className="size-4 text-emerald-600" />}
                      Save
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {(config.error || config.message) && (
        <div className={`mx-4 mb-4 rounded-md border px-4 py-3 text-sm ${
          config.error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
        }`}>
          {config.error || config.message}
        </div>
      )}
    </section>
  );
}

function TierConfigurationPanel({
  config,
  onReload,
  onDraftChange,
  onSave,
}: {
  config: TierConfigState;
  onReload: () => void;
  onDraftChange: (tierCode: string, draft: Partial<CrmTier>) => void;
  onSave: (tierCode: string) => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Konfigurasi Tier Membership</h2>
          <p className="mt-1 text-sm text-slate-500">Atur threshold XP, spend, multiplier, discount, dan status tier.</p>
        </div>
        <button
          type="button"
          onClick={onReload}
          disabled={config.loading}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
        >
          <RefreshCw className={`size-4 ${config.loading ? "animate-spin" : ""}`} />
          Reload
        </button>
      </div>

      {config.loading ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">Memuat konfigurasi tier...</div>
      ) : config.tiers.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">Belum ada tier membership.</div>
      ) : (
        <div className="grid gap-4 p-4 xl:grid-cols-3">
          {config.tiers.map((tier) => {
            const draft = config.draft[tier.code] ?? tier;
            return (
              <div key={tier.code} className="rounded-md border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="size-4 rounded-full border border-slate-200"
                      style={{ backgroundColor: draft.display_color }}
                    />
                    <div>
                      <div className="text-sm font-semibold text-slate-950">{draft.name}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{draft.code}</div>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                    <input
                      type="checkbox"
                      checked={draft.is_active}
                      onChange={(event) => onDraftChange(tier.code, { is_active: event.target.checked })}
                      className="size-4 rounded border-slate-300"
                    />
                    Active
                  </label>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-500">Name</span>
                    <input
                      value={draft.name}
                      onChange={(event) => onDraftChange(tier.code, { name: event.target.value })}
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-500">Rank</span>
                    <input
                      type="number"
                      min="1"
                      value={draft.rank}
                      onChange={(event) => onDraftChange(tier.code, { rank: Number(event.target.value) || 1 })}
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-500">Min Lifetime XP</span>
                    <input
                      type="number"
                      min="0"
                      value={draft.min_lifetime_xp}
                      onChange={(event) => onDraftChange(tier.code, { min_lifetime_xp: Number(event.target.value) || 0 })}
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-500">Min Spend</span>
                    <input
                      type="number"
                      min="0"
                      value={draft.min_total_spend}
                      onChange={(event) => onDraftChange(tier.code, { min_total_spend: Number(event.target.value) || 0 })}
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-500">XP Multiplier</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={draft.xp_multiplier}
                      onChange={(event) => onDraftChange(tier.code, { xp_multiplier: Number(event.target.value) || 0 })}
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-500">Discount %</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={draft.discount_percent}
                      onChange={(event) => onDraftChange(tier.code, { discount_percent: Number(event.target.value) || 0 })}
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-500">Color</span>
                    <input
                      type="color"
                      value={draft.display_color}
                      onChange={(event) => onDraftChange(tier.code, { display_color: event.target.value })}
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-2 py-1 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                    />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => onSave(tier.code)}
                  disabled={config.savingCode === tier.code || !draft.name.trim()}
                  className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  <Save className="size-4" />
                  {config.savingCode === tier.code ? "Menyimpan..." : "Simpan Tier"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {(config.error || config.message) && (
        <div className={`mx-4 mb-4 rounded-md border px-4 py-3 text-sm ${
          config.error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
        }`}>
          {config.error || config.message}
        </div>
      )}
    </section>
  );
}

function LeaderboardTable({
  title,
  valueLabel,
  rows,
  getValue,
}: {
  title: string;
  valueLabel: string;
  rows: CrmCustomer[];
  getValue: (customer: CrmCustomer) => string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <span className="text-xs text-slate-500">{valueLabel}</span>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">Belum ada data</div>
        ) : (
          rows.map((customer, index) => (
            <div key={customer.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-3">
              <div className="flex size-7 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">
                {index + 1}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">{customer.name || "Customer"}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  <span>{customer.phone || "-"}</span>
                  <span className="rounded-sm bg-slate-100 px-1.5 py-0.5">{tierLabel(customer.membership_tier)}</span>
                </div>
              </div>
              <div className="text-right text-sm font-semibold text-slate-950">{getValue(customer)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ArkCoinsTable({ rows }: { rows: { customer: CrmCustomer | null; ark_coins_used: number }[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-950">Top Spender ARK Coins</h2>
        <Coins className="size-4 text-amber-600" />
      </div>
      <div className="divide-y divide-slate-100">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">Belum ada penggunaan ARK Coins</div>
        ) : (
          rows.map((row, index) => (
            <div key={row.customer?.id ?? index} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-3">
              <div className="flex size-7 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">
                {index + 1}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">{row.customer?.name || "Customer"}</div>
                <div className="mt-0.5 text-xs text-slate-500">{row.customer?.phone || "-"}</div>
              </div>
              <div className="text-right text-sm font-semibold text-slate-950">{formatNumber(row.ark_coins_used)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function StatusRow({ label, value, ready }: { label: string; value: number; ready: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`rounded-sm px-2 py-1 text-xs font-medium ${ready ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
        {ready ? formatNumber(value) : "Pending"}
      </span>
    </div>
  );
}
