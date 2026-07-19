"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgePercent,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Copy,
  EyeOff,
  Gift,
  Image as ImageIcon,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Ticket,
  Trash2,
  Trophy,
  UserPlus,
  X,
} from "lucide-react";
import { QUOTA_PERIOD_LABELS, QUOTA_PERIODS } from "@/lib/crm/rewards";
import type { QuotaPeriod, Redemption, Reward, RewardForm } from "../types";
import { useClaimMembers, useRedemptionsList, useRewardsList } from "../queries";
import {
  useClaimRedemption,
  useDeleteReward,
  useSaveReward,
  useToggleReward,
  useUpdateRedemption,
} from "../mutations";

const numberFormat = new Intl.NumberFormat("id-ID");
const dateTimeFormat = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
});

const defaultForm: RewardForm = {
  id: "",
  code: "",
  name: "",
  reward_type: "discount",
  min_xp: 0,
  required_tier_id: "",
  stock_total: "",
  stock_redeemed: 0,
  max_redemptions_per_member: "",
  quota_period: "total",
  is_active: true,
};

function formatNumber(value: number) {
  return numberFormat.format(value || 0);
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : dateTimeFormat.format(date);
}

function rewardTypeLabel(type: Reward["reward_type"]) {
  const labels: Record<Reward["reward_type"], string> = {
    discount: "Discount",
    merchandise: "Merchandise",
    avatar: "Avatar",
    voucher: "Voucher",
    ark_coin: "ARK Coin",
    custom: "Custom",
  };
  return labels[type];
}

function rewardTypeIcon(type: Reward["reward_type"]) {
  if (type === "discount") return BadgePercent;
  if (type === "merchandise") return Boxes;
  if (type === "avatar") return ImageIcon;
  if (type === "voucher") return Ticket;
  return Gift;
}

function quotaLabel(reward: Reward) {
  if (reward.max_redemptions_per_member == null) return "Tanpa batas";
  const period = QUOTA_PERIOD_LABELS[reward.quota_period] ?? "Total";
  return `${reward.max_redemptions_per_member}x · ${period.toLowerCase()}`;
}

const STATUS_STYLES: Record<Redemption["status"], string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-sky-50 text-sky-700 border-sky-200",
  fulfilled: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
  expired: "bg-slate-100 text-slate-500 border-slate-200",
};

const STATUS_LABELS: Record<Redemption["status"], string> = {
  pending: "Menunggu",
  approved: "Disetujui",
  fulfilled: "Diserahkan",
  cancelled: "Dibatalkan",
  expired: "Kedaluwarsa",
};

export function CrmRewardsPage() {
  const [tab, setTab] = useState<"catalog" | "requests">("catalog");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [claimSearch, setClaimSearch] = useState("");
  const [claimCustomerId, setClaimCustomerId] = useState("");
  const [claimRewardId, setClaimRewardId] = useState("");
  const [form, setForm] = useState<RewardForm>(defaultForm);
  const [feedback, setFeedback] = useState<{ error: string | null; message: string | null }>({
    error: null,
    message: null,
  });

  const { data, isLoading, isFetching, error, refetch } = useRewardsList({ reward_type: typeFilter });
  const redemptionsQuery = useRedemptionsList({ status: statusFilter });
  const saveMutation = useSaveReward();
  const toggleMutation = useToggleReward();
  const deleteMutation = useDeleteReward();
  const updateRedemptionMutation = useUpdateRedemption();
  const claimMutation = useClaimRedemption();
  const claimMembersQuery = useClaimMembers(
    tab === "requests" && !claimCustomerId ? claimSearch : ""
  );

  const rewards = data?.rewards ?? [];
  const tiers = data?.tiers ?? [];
  const redemptions = redemptionsQuery.data ?? [];
  const loading = isLoading || isFetching;
  const queryError = error instanceof Error ? error.message : null;
  const redemptionsError =
    redemptionsQuery.error instanceof Error ? redemptionsQuery.error.message : null;

  const filteredRewards = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rewards;

    return rewards.filter((reward) =>
      `${reward.code} ${reward.name} ${reward.reward_type}`.toLowerCase().includes(term)
    );
  }, [search, rewards]);

  const summary = useMemo(() => {
    return {
      active: rewards.filter((reward) => reward.is_active).length,
      stock: rewards.reduce((sum, reward) => sum + (reward.stock_total ?? 0), 0),
      redeemed: rewards.reduce((sum, reward) => sum + Number(reward.stock_redeemed ?? 0), 0),
    };
  }, [rewards]);

  const pendingCount = useMemo(
    () => redemptions.filter((item) => item.status === "pending").length,
    [redemptions]
  );

  async function saveReward() {
    setFeedback({ error: null, message: null });

    try {
      await saveMutation.mutateAsync({
        code: form.code,
        name: form.name,
        reward_type: form.reward_type,
        min_xp: Math.max(0, Number(form.min_xp) || 0),
        required_tier_id: form.required_tier_id || null,
        linked_avatar_id: null,
        stock_total: form.stock_total === "" ? null : Math.max(0, Number(form.stock_total) || 0),
        stock_redeemed: Math.max(0, Number(form.stock_redeemed) || 0),
        max_redemptions_per_member:
          form.max_redemptions_per_member === ""
            ? null
            : Math.max(1, Number(form.max_redemptions_per_member) || 1),
        quota_period: form.quota_period,
        image_url: null,
        reward_data: {},
        starts_at: null,
        ends_at: null,
        is_active: form.is_active,
      });

      setForm(defaultForm);
      setFeedback({ error: null, message: "Reward berhasil disimpan." });
    } catch (err) {
      setFeedback({
        error: err instanceof Error ? err.message : "Gagal menyimpan reward",
        message: null,
      });
    }
  }

  function editReward(reward: Reward) {
    setTab("catalog");
    setForm({
      id: reward.id,
      code: reward.code,
      name: reward.name,
      reward_type: reward.reward_type,
      min_xp: reward.min_xp,
      required_tier_id: reward.required_tier_id ?? "",
      stock_total: reward.stock_total == null ? "" : String(reward.stock_total),
      stock_redeemed: Number(reward.stock_redeemed ?? 0),
      max_redemptions_per_member:
        reward.max_redemptions_per_member == null ? "" : String(reward.max_redemptions_per_member),
      quota_period: reward.quota_period ?? "total",
      is_active: reward.is_active,
    });
  }

  async function toggleRewardActive(reward: Reward) {
    setFeedback({ error: null, message: null });

    try {
      await toggleMutation.mutateAsync(reward);
      if (form.id === reward.id) {
        setForm((current) => ({ ...current, is_active: !reward.is_active }));
      }
      setFeedback({
        error: null,
        message: `Reward ${reward.name} ${reward.is_active ? "disembunyikan dari member" : "dibuka untuk member"}.`,
      });
    } catch (err) {
      setFeedback({
        error: err instanceof Error ? err.message : "Gagal update status reward",
        message: null,
      });
    }
  }

  async function deleteRewardHandler(reward: Reward) {
    setFeedback({ error: null, message: null });

    try {
      await deleteMutation.mutateAsync(reward.id);
      if (form.id === reward.id) setForm(defaultForm);
      setFeedback({ error: null, message: `Reward ${reward.name} berhasil dihapus.` });
    } catch (err) {
      setFeedback({
        error: err instanceof Error ? err.message : "Gagal hapus reward",
        message: null,
      });
    }
  }

  function duplicateReward(reward: Reward) {
    setTab("catalog");
    setForm({
      id: "",
      code: `${reward.code}-copy`,
      name: `${reward.name} Copy`,
      reward_type: reward.reward_type,
      min_xp: reward.min_xp,
      required_tier_id: reward.required_tier_id ?? "",
      stock_total: reward.stock_total == null ? "" : String(reward.stock_total),
      stock_redeemed: 0,
      max_redemptions_per_member:
        reward.max_redemptions_per_member == null ? "" : String(reward.max_redemptions_per_member),
      quota_period: reward.quota_period ?? "total",
      is_active: false,
    });
  }

  async function handleClaim() {
    setFeedback({ error: null, message: null });

    try {
      await claimMutation.mutateAsync({
        customer_id: claimCustomerId,
        reward_id: claimRewardId,
      });
      const reward = rewards.find((item) => item.id === claimRewardId);
      setClaimSearch("");
      setClaimCustomerId("");
      setClaimRewardId("");
      setFeedback({
        error: null,
        message: `${reward?.name ?? "Reward"} berhasil diserahkan ke member.`,
      });
    } catch (err) {
      setFeedback({
        error: err instanceof Error ? err.message : "Gagal klaim reward",
        message: null,
      });
    }
  }

  async function handleRedemptionAction(
    redemption: Redemption,
    action: "approve" | "fulfill" | "cancel"
  ) {
    setFeedback({ error: null, message: null });

    try {
      await updateRedemptionMutation.mutateAsync({ id: redemption.id, action });
      const verb =
        action === "approve" ? "disetujui" : action === "fulfill" ? "diserahkan" : "dibatalkan";
      setFeedback({ error: null, message: `${redemption.redemption_number} ${verb}.` });
    } catch (err) {
      setFeedback({
        error: err instanceof Error ? err.message : "Gagal memperbarui permintaan redeem",
        message: null,
      });
    }
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
            <h1 className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">Rewards</h1>
            <p className="mt-1 text-sm text-slate-500">
              Atur reward mana yang bisa ditukar member dan berapa kali jatahnya.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void refetch();
              void redemptionsQuery.refetch();
            }}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        <div className="flex items-start gap-2.5 rounded-md border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          <Info className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong className="font-semibold">XP tidak dipotong saat redeem.</strong> Angka
            &ldquo;Min XP&rdquo; adalah syarat kelayakan — member dengan XP seumur hidup di atas ambang
            itu berhak menukar reward. Yang membatasi pengambilan berulang adalah kuota per member.
          </p>
        </div>

        {(queryError || redemptionsError || feedback.error || feedback.message) && (
          <div className={`rounded-md border px-4 py-3 text-sm ${
            queryError || redemptionsError || feedback.error
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}>
            {queryError || redemptionsError || feedback.error || feedback.message}
          </div>
        )}

        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Gift} label="Rewards" value={formatNumber(rewards.length)} />
          <MetricCard icon={CheckCircle2} label="Bisa di-redeem" value={formatNumber(summary.active)} />
          <MetricCard icon={Boxes} label="Stok" value={formatNumber(summary.stock)} />
          <MetricCard icon={ClipboardList} label="Menunggu approval" value={formatNumber(pendingCount)} />
        </section>

        <div className="flex gap-1 rounded-md border border-slate-200 bg-white p-1 shadow-sm">
          <TabButton active={tab === "catalog"} onClick={() => setTab("catalog")} icon={Gift}>
            Katalog Reward
          </TabButton>
          <TabButton active={tab === "requests"} onClick={() => setTab("requests")} icon={ClipboardList}>
            Permintaan Redeem
            {pendingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                {pendingCount}
              </span>
            )}
          </TabButton>
        </div>

        {tab === "catalog" ? (
          <section className="grid gap-4 xl:grid-cols-[420px_1fr]">
            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                  <Plus className="size-4" />
                  {form.id ? "Edit Reward" : "Reward Baru"}
                </h2>
                {form.id && <div className="mt-1 text-xs text-slate-500">Sedang mengubah {form.code}</div>}
              </div>
              <div className="space-y-4 p-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <TextField label="Kode" value={form.code} onChange={(value) => setForm((current) => ({ ...current, code: value }))} placeholder="voucher-kopi" />
                  <TextField label="Nama" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} placeholder="Voucher Kopi Gratis" />
                </div>

                <label className="space-y-1">
                  <span className="text-xs font-medium text-slate-500">Jenis</span>
                  <select
                    value={form.reward_type}
                    onChange={(event) => setForm((current) => ({ ...current, reward_type: event.target.value as Reward["reward_type"] }))}
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  >
                    <option value="discount">Discount</option>
                    <option value="merchandise">Merchandise</option>
                    <option value="voucher">Voucher</option>
                    <option value="ark_coin">ARK Coin</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>

                <fieldset className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Syarat kelayakan
                  </legend>
                  <TextField
                    label="Min XP (tidak dipotong)"
                    type="number"
                    value={String(form.min_xp)}
                    onChange={(value) => setForm((current) => ({ ...current, min_xp: Number(value) || 0 }))}
                    hint="Member harus punya XP seumur hidup minimal segini."
                  />
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-500">Tier minimum</span>
                    <select
                      value={form.required_tier_id}
                      onChange={(event) => setForm((current) => ({ ...current, required_tier_id: event.target.value }))}
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                    >
                      <option value="">Semua tier</option>
                      {tiers.map((tier) => (
                        <option key={tier.id} value={tier.id}>{tier.name}</option>
                      ))}
                    </select>
                  </label>
                </fieldset>

                <fieldset className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Batas pengambilan
                  </legend>
                  <TextField
                    label="Stok total"
                    type="number"
                    value={form.stock_total}
                    onChange={(value) => setForm((current) => ({ ...current, stock_total: value }))}
                    placeholder="Kosongkan = tanpa batas"
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextField
                      label="Maks. per member"
                      type="number"
                      value={form.max_redemptions_per_member}
                      onChange={(value) => setForm((current) => ({ ...current, max_redemptions_per_member: value }))}
                      placeholder="Kosong = bebas"
                    />
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-slate-500">Periode kuota</span>
                      <select
                        value={form.quota_period}
                        onChange={(event) => setForm((current) => ({ ...current, quota_period: event.target.value as QuotaPeriod }))}
                        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                      >
                        {QUOTA_PERIODS.map((period) => (
                          <option key={period} value={period}>{QUOTA_PERIOD_LABELS[period]}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </fieldset>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
                    className="size-4 rounded border-slate-300"
                  />
                  Tampilkan &amp; bisa di-redeem member
                </label>

                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setForm(defaultForm)}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                  >
                    {form.id ? (
                      <>
                        <X className="size-4" />
                        Batal
                      </>
                    ) : (
                      "Reset"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveReward()}
                    disabled={saveMutation.isPending || !form.code || !form.name}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                  >
                    <Save className="size-4" />
                    {form.id ? "Update" : "Simpan"}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-[1fr_180px]">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Cari reward..."
                    className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  />
                </label>
                <select
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value)}
                  className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                >
                  <option value="all">Semua jenis</option>
                  <option value="discount">Discount</option>
                  <option value="merchandise">Merchandise</option>
                  <option value="voucher">Voucher</option>
                  <option value="ark_coin">ARK Coin</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              {loading ? (
                <div className="px-4 py-12 text-center text-sm text-slate-500">Memuat rewards...</div>
              ) : filteredRewards.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-slate-500">Belum ada reward.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredRewards.map((reward) => {
                    const Icon = rewardTypeIcon(reward.reward_type);
                    const remainingStock =
                      reward.stock_total == null
                        ? null
                        : Math.max(0, reward.stock_total - reward.stock_redeemed);

                    return (
                      <div key={reward.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[1fr_150px_130px_220px] lg:items-center">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                            <Icon className="size-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-950">{reward.name}</div>
                            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
                              <span>{reward.code}</span>
                              <span>{rewardTypeLabel(reward.reward_type)}</span>
                              <span>{reward.required_tier?.name || "Semua tier"}</span>
                              <span className={reward.is_active ? "font-medium text-emerald-700" : "text-slate-400"}>
                                {reward.is_active ? "Bisa di-redeem" : "Disembunyikan"}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center gap-1.5 text-sm font-semibold text-violet-700">
                            <Trophy className="size-3.5" />
                            min {formatNumber(reward.min_xp)} XP
                          </div>
                          <div className="mt-0.5 text-xs text-slate-400">tidak dipotong</div>
                        </div>

                        <div className="text-sm text-slate-600">
                          {remainingStock == null ? "Stok bebas" : `${formatNumber(remainingStock)} sisa`}
                          <div className="mt-0.5 text-xs text-slate-400">Jatah: {quotaLabel(reward)}</div>
                        </div>

                        <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                          <IconButton onClick={() => editReward(reward)} icon={Pencil}>Edit</IconButton>
                          <IconButton onClick={() => duplicateReward(reward)} icon={Copy}>Salin</IconButton>
                          <IconButton
                            onClick={() => void toggleRewardActive(reward)}
                            disabled={toggleMutation.isPending && toggleMutation.variables?.id === reward.id}
                            icon={reward.is_active ? EyeOff : CheckCircle2}
                          >
                            {reward.is_active ? "Sembunyikan" : "Aktifkan"}
                          </IconButton>
                          <IconButton
                            onClick={() => void deleteRewardHandler(reward)}
                            disabled={deleteMutation.isPending && deleteMutation.variables === reward.id}
                            icon={Trash2}
                            tone="danger"
                          >
                            Hapus
                          </IconButton>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        ) : (
          <>
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                <UserPlus className="size-4" />
                Klaim Reward di Venue
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Untuk member yang datang langsung — reward ditandai diserahkan seketika.
              </p>
            </div>
            <div className="grid gap-3 p-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-500">Cari member</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={claimSearch}
                    onChange={(event) => {
                      setClaimSearch(event.target.value);
                      setClaimCustomerId("");
                    }}
                    placeholder="Nama atau nomor HP..."
                    className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  />
                </div>
                {claimSearch.trim().length > 0 && !claimCustomerId && (
                  <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200">
                    {claimMembersQuery.isLoading ? (
                      <div className="px-3 py-2 text-xs text-slate-500">Mencari...</div>
                    ) : (claimMembersQuery.data ?? []).length === 0 ? (
                      <div className="px-3 py-2 text-xs text-slate-500">Member tidak ditemukan.</div>
                    ) : (
                      (claimMembersQuery.data ?? []).map((option) => (
                        <button
                          key={option.customer_id}
                          type="button"
                          onClick={() => {
                            setClaimCustomerId(option.customer_id);
                            setClaimSearch(`${option.name} · ${option.phone}`);
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition hover:bg-slate-50"
                        >
                          <span className="truncate font-medium text-slate-800">{option.name}</span>
                          <span className="shrink-0 text-slate-500">
                            {option.phone} · {formatNumber(option.total_xp)} XP
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-500">Reward</span>
                <select
                  value={claimRewardId}
                  onChange={(event) => setClaimRewardId(event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                >
                  <option value="">Pilih reward...</option>
                  {rewards
                    .filter((reward) => reward.is_active)
                    .map((reward) => (
                      <option key={reward.id} value={reward.id}>
                        {reward.name} — min {formatNumber(reward.min_xp)} XP
                      </option>
                    ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => void handleClaim()}
                disabled={!claimCustomerId || !claimRewardId || claimMutation.isPending}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                <Gift className="size-4" />
                Klaim
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Permintaan Redeem</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Permintaan dari portal member perlu disetujui lalu diserahkan di venue.
                </p>
              </div>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100 sm:w-48"
              >
                <option value="pending">Menunggu</option>
                <option value="approved">Disetujui</option>
                <option value="fulfilled">Diserahkan</option>
                <option value="cancelled">Dibatalkan</option>
                <option value="all">Semua status</option>
              </select>
            </div>

            {redemptionsQuery.isLoading ? (
              <div className="px-4 py-12 text-center text-sm text-slate-500">Memuat permintaan...</div>
            ) : redemptions.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-slate-500">
                Tidak ada permintaan pada status ini.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {redemptions.map((redemption) => {
                  const busy =
                    updateRedemptionMutation.isPending &&
                    updateRedemptionMutation.variables?.id === redemption.id;

                  return (
                    <div key={redemption.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[1fr_200px_240px] lg:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-950">
                            {redemption.reward_name}
                          </span>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[redemption.status]}`}>
                            {STATUS_LABELS[redemption.status]}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                            {redemption.channel === "portal" ? "Portal member" : "Kasir"}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
                          <span className="font-mono">{redemption.redemption_number}</span>
                          <span>{formatDateTime(redemption.requested_at)}</span>
                        </div>
                      </div>

                      <div className="text-sm">
                        <div className="font-medium text-slate-800">
                          {redemption.customer_name || "Member"}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {redemption.customer_phone || "-"}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-400">
                          {formatNumber(Number(redemption.total_xp_at_redeem ?? 0))} XP saat ajukan
                          {" · syarat "}
                          {formatNumber(redemption.min_xp_at_redeem)}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        {redemption.status === "pending" && (
                          <IconButton
                            onClick={() => void handleRedemptionAction(redemption, "approve")}
                            disabled={busy}
                            icon={CheckCircle2}
                          >
                            Setujui
                          </IconButton>
                        )}
                        {(redemption.status === "pending" || redemption.status === "approved") && (
                          <>
                            <IconButton
                              onClick={() => void handleRedemptionAction(redemption, "fulfill")}
                              disabled={busy}
                              icon={Gift}
                              tone="primary"
                            >
                              Serahkan
                            </IconButton>
                            <IconButton
                              onClick={() => void handleRedemptionAction(redemption, "cancel")}
                              disabled={busy}
                              icon={X}
                              tone="danger"
                            >
                              Batalkan
                            </IconButton>
                          </>
                        )}
                        {redemption.status === "fulfilled" && (
                          <span className="text-xs text-slate-400">
                            Diserahkan {formatDateTime(redemption.fulfilled_at)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          </>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Gift;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition ${
        active ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      <Icon className="size-4" />
      {children}
    </button>
  );
}

function IconButton({
  onClick,
  icon: Icon,
  children,
  disabled,
  tone = "default",
}: {
  onClick: () => void;
  icon: typeof Gift;
  children: React.ReactNode;
  disabled?: boolean;
  tone?: "default" | "danger" | "primary";
}) {
  const tones = {
    default: "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
    danger: "border-red-200 bg-white text-red-700 hover:bg-red-50",
    primary: "border-slate-950 bg-slate-950 text-white hover:bg-slate-800",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium transition disabled:opacity-50 ${tones[tone]}`}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Gift;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex size-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
        <Icon className="size-5" />
      </div>
      <div className="text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
      />
      {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}
