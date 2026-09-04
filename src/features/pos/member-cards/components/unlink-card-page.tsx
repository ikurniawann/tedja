"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Ban, CheckCircle2, CreditCard, HandCoins, Loader2, Lock, Nfc, Search, Unlink,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToastContainer, useToast } from "@/components/ui/toast";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  CARD_UNLINK_REASONS,
  CARD_UNLINK_REASON_LABELS,
  type CardUnlinkReason,
} from "@/lib/pos/card-unlink";
import { REFUND_STATUS_LABELS, type RefundStatus } from "@/lib/pos/member-refund";
import { POS_NFC_CARD_EVENT, normalizeNfcUid, usePosNfcOptional } from "@/features/pos/nfc";

/**
 * POS → Member → Unlink Card (permintaan owner 2026-09-01): daftar member
 * berkartu, bisa dicari atau langsung di-tap kartunya lewat pembaca NFC,
 * lalu kartunya dilepas (hilang / dikembalikan) TANPA mereset saldo.
 *
 * Refund (owner 2026-09-04): tombol "Refund" di samping Unlink = kartu
 * dilepas + permintaan refund dicatat untuk Finance. Setelah Finance
 * mengonfirmasi uang sudah dikembalikan, permintaan ditandai "Refund
 * Completed" (PIN supervisor) dan saldo member di-nol-kan.
 * Dirancang ramah tablet kasir: kartu besar, tombol alasan besar.
 */

interface MemberCardRow {
  id: string;
  name: string | null;
  phone: string;
  membership_tier: string | null;
  member_type: string | null;
  ark_coin_balance: number | string | null;
  total_xp: number | string | null;
  nfc_uid: string;
  card_issued_at: string | null;
}
interface UnlinkLogRow {
  id: string;
  name: string | null;
  phone: string;
  nfc_uid: string;
  reason: CardUnlinkReason;
  notes: string | null;
  balance_at_unlink: number | string | null;
  unlinked_by_name: string | null;
  created_at: string;
}
interface RefundRequestRow {
  id: string;
  customer_id: string;
  name: string | null;
  phone: string;
  current_balance: number | string | null;
  status: RefundStatus;
  requested_amount: number | string | null;
  refunded_amount: number | string | null;
  notes: string | null;
  requested_by_name: string | null;
  requested_at: string;
  completed_by_name: string | null;
  approved_by_name: string | null;
  completed_at: string | null;
  completion_notes: string | null;
  cancelled_by_name: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}
interface PageData {
  members: MemberCardRow[];
  recent_unlinks: UnlinkLogRow[];
  refund_requests: RefundRequestRow[];
}

type Dialog =
  | { kind: "unlink"; member: MemberCardRow }
  | { kind: "refund"; member: MemberCardRow }
  | { kind: "complete"; request: RefundRequestRow }
  | { kind: "cancel"; request: RefundRequestRow }
  | null;

const rupiah = (v: number | string | null | undefined) =>
  `Rp ${Math.round(Number(v) || 0).toLocaleString("id-ID")}`;
const tanggal = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("id-ID", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
      })
    : "—";

const STATUS_CLASS: Record<RefundStatus, string> = {
  requested: "border-amber-300 bg-amber-50 text-amber-800",
  completed: "border-emerald-300 bg-emerald-50 text-emerald-800",
  cancelled: "border-gray-300 bg-gray-50 text-gray-600",
};

export function UnlinkCardPage() {
  const { toasts, showToast, removeToast } = useToast();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [data, setData] = useState<PageData | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState<CardUnlinkReason | null>(null);
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  const load = useCallback((q: string) => {
    apiGet<{ data: PageData }>(`/api/pos/member-cards?search=${encodeURIComponent(q)}`)
      .then((res) => setData(res.data))
      .catch((err) => showToast(err instanceof Error ? err.message : "Gagal memuat", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load(applied);
  }, [applied, load]);

  // Tap kartu NFC → langsung buka member pemilik kartu itu. paymentNfcActive
  // memberi tahu listener global agar scan dikirim ke halaman ini, bukan
  // dialihkan ke halaman Topup.
  const posNfc = usePosNfcOptional();
  const setPaymentNfcActive = posNfc?.setPaymentNfcActive;
  useEffect(() => {
    setPaymentNfcActive?.(true);
    return () => setPaymentNfcActive?.(false);
  }, [setPaymentNfcActive]);

  useEffect(() => {
    async function onCard(event: Event) {
      const raw = (event as CustomEvent<{ card?: string }>).detail?.card;
      const uid = normalizeNfcUid(raw ?? "");
      if (!uid) return;
      setScanning(true);
      try {
        const res = await apiGet<{ data: PageData }>(
          `/api/pos/member-cards?nfc_uid=${encodeURIComponent(uid)}`
        );
        const found = res.data.members[0];
        if (!found) {
          showToast(`Kartu ${uid} tidak terdaftar atau sudah dilepas`, "error");
          return;
        }
        openDialog("unlink", found);
        showToast(`Kartu milik ${found.name || found.phone} terbaca`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Gagal membaca kartu", "error");
      } finally {
        setScanning(false);
      }
    }
    window.addEventListener(POS_NFC_CARD_EVENT, onCard);
    return () => window.removeEventListener(POS_NFC_CARD_EVENT, onCard);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openDialog(kind: "unlink" | "refund", member: MemberCardRow) {
    setDialog({ kind, member });
    setReason(null);
    setNotes("");
    setPin("");
  }
  function openRequestDialog(kind: "complete" | "cancel", request: RefundRequestRow) {
    setDialog({ kind, request });
    setNotes("");
    setPin("");
  }
  function closeDialog() {
    if (!busy) setDialog(null);
  }

  async function submit(url: string, body: unknown, fallback: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiPost<{ message: string }>(url, body);
      showToast(res.message ?? "Berhasil");
      setDialog(null);
      load(applied);
    } catch (err) {
      showToast(err instanceof Error ? err.message : fallback, "error");
    } finally {
      setBusy(false);
    }
  }

  const confirmUnlink = () => {
    if (dialog?.kind !== "unlink" || !reason) return;
    submit(`/api/pos/member-cards/${dialog.member.id}/unlink`, { reason, notes }, "Gagal melepas kartu");
  };
  const confirmRefund = () => {
    if (dialog?.kind !== "refund") return;
    submit(`/api/pos/member-cards/${dialog.member.id}/refund`, { notes }, "Gagal mengajukan refund");
  };
  const confirmComplete = () => {
    if (dialog?.kind !== "complete") return;
    submit(`/api/pos/member-refunds/${dialog.request.id}/complete`, { supervisor_pin: pin, notes }, "Gagal menyelesaikan refund");
  };
  const confirmCancel = () => {
    if (dialog?.kind !== "cancel") return;
    submit(`/api/pos/member-refunds/${dialog.request.id}/cancel`, { reason: notes }, "Gagal membatalkan");
  };

  const canConfirmUnlink = Boolean(reason) && (reason !== "other" || notes.trim().length >= 3);
  const openRequests = data?.refund_requests.filter((r) => r.status === "requested") ?? [];
  const pastRequests = data?.refund_requests.filter((r) => r.status !== "requested") ?? [];

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <CreditCard className="h-6 w-6 text-primary" />
          Unlink Card
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Lepaskan kartu NFC dari member — kartu hilang atau dikembalikan. Saldo
          ARK dan XP member <span className="font-semibold text-gray-700">tetap utuh</span>;
          hanya tautan kartunya yang dilepas. Pilih <span className="font-semibold text-gray-700">Refund</span> bila
          member ingin saldonya dikembalikan: kartu dilepas dan permintaan diteruskan ke Finance.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setData(null);
              setApplied(search.trim());
            }}
          >
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama / no. HP / UID kartu…"
              className="h-11"
            />
            <Button type="submit" className="h-11 gap-2">
              <Search className="h-4 w-4" /> Cari
            </Button>
          </form>
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-sm text-primary">
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Nfc className="h-4 w-4" />}
            {scanning ? "Membaca kartu…" : "Atau tap kartu NFC untuk langsung membuka member"}
          </div>
        </CardContent>
      </Card>

      {openRequests.length > 0 ? (
        <div>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-amber-700">
            <HandCoins className="h-4 w-4" /> Permintaan refund menunggu Finance ({openRequests.length})
          </h2>
          <Card className="border-amber-200">
            <CardContent className="divide-y p-0">
              {openRequests.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{r.name || r.phone}</p>
                    <p className="text-xs text-gray-500">
                      {r.phone} · diajukan {r.requested_by_name || "—"} · {tanggal(r.requested_at)}
                      {r.notes ? <> · “{r.notes}”</> : null}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Saldo saat ini</p>
                    <p className="font-semibold text-emerald-700">{rupiah(r.current_balance)}</p>
                    {Number(r.current_balance) !== Number(r.requested_amount) ? (
                      <p className="text-[11px] text-amber-700">saat diajukan {rupiah(r.requested_amount)}</p>
                    ) : null}
                  </div>
                  <div className="ml-auto flex gap-2">
                    <Button
                      variant="outline"
                      className="h-10 gap-1.5 text-gray-600"
                      onClick={() => openRequestDialog("cancel", r)}
                    >
                      <Ban className="h-4 w-4" /> Batalkan
                    </Button>
                    <Button
                      className="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => openRequestDialog("complete", r)}
                    >
                      <CheckCircle2 className="h-4 w-4" /> Refund Completed
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {data === null ? (
        <Card>
          <CardContent className="flex items-center gap-2 p-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat member berkartu…
          </CardContent>
        </Card>
      ) : data.members.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-gray-500">
            {applied ? `Tidak ada member berkartu yang cocok dengan “${applied}”.` : "Belum ada member yang punya kartu tertaut."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.members.map((m) => (
            <Card key={m.id}>
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-gray-900">{m.name || "—"}</p>
                    <p className="truncate text-sm text-gray-500">{m.phone}</p>
                  </div>
                  {m.membership_tier ? <Badge variant="outline">{m.membership_tier}</Badge> : null}
                </div>
                <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">UID kartu</span>
                    <span className="font-mono font-medium text-gray-800">{m.nfc_uid}</span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span className="text-gray-500">Saldo ARK</span>
                    <span className="font-semibold text-emerald-700">{rupiah(m.ark_coin_balance)}</span>
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-gray-400">
                    <span>Kartu aktif sejak</span>
                    <span>{tanggal(m.card_issued_at)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    className="h-11 gap-2 border-red-200 text-red-700 hover:bg-red-50"
                    onClick={() => openDialog("unlink", m)}
                  >
                    <Unlink className="h-4 w-4" /> Unlink
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 gap-2 border-amber-300 text-amber-800 hover:bg-amber-50"
                    onClick={() => openDialog("refund", m)}
                  >
                    <HandCoins className="h-4 w-4" /> Refund
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {pastRequests.length > 0 ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Riwayat refund
          </h2>
          <Card>
            <CardContent className="divide-y p-0">
              {pastRequests.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                  <span className="font-medium text-gray-900">{r.name || r.phone}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[r.status]}`}>
                    {REFUND_STATUS_LABELS[r.status]}
                  </span>
                  <span className="font-semibold text-gray-800">
                    {rupiah(r.status === "completed" ? r.refunded_amount : r.requested_amount)}
                  </span>
                  {r.status === "completed" && r.completion_notes ? <span className="text-gray-600">“{r.completion_notes}”</span> : null}
                  {r.status === "cancelled" && r.cancel_reason ? <span className="text-gray-600">“{r.cancel_reason}”</span> : null}
                  <span className="ml-auto text-xs text-gray-400">
                    {r.status === "completed"
                      ? `selesai ${tanggal(r.completed_at)} · ${r.completed_by_name || "—"} · PIN ${r.approved_by_name || "supervisor"}`
                      : `dibatalkan ${tanggal(r.cancelled_at)} · ${r.cancelled_by_name || "—"}`}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {data && data.recent_unlinks.length > 0 ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Riwayat unlink terakhir
          </h2>
          <Card>
            <CardContent className="divide-y p-0">
              {data.recent_unlinks.map((log) => (
                <div key={log.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                  <span className="font-medium text-gray-900">{log.name || log.phone}</span>
                  <span className="font-mono text-xs text-gray-500">{log.nfc_uid}</span>
                  <Badge variant="outline">{CARD_UNLINK_REASON_LABELS[log.reason] ?? log.reason}</Badge>
                  {log.notes ? <span className="text-gray-600">“{log.notes}”</span> : null}
                  <span className="ml-auto text-xs text-gray-400">
                    saldo saat unlink {rupiah(log.balance_at_unlink)} · {log.unlinked_by_name || "—"} · {tanggal(log.created_at)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Dialog Unlink */}
      <Dialog open={dialog?.kind === "unlink"} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Unlink kartu — {dialog?.kind === "unlink" ? dialog.member.name || dialog.member.phone : ""}</DialogTitle>
          </DialogHeader>
          {dialog?.kind === "unlink" ? (
            <div className="space-y-4">
              <MemberSummary member={dialog.member} />
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Saldo & XP member <strong>tidak berubah</strong>. Setelah dilepas, kartu ini
                tidak bisa dipakai lagi; member bisa dipasangkan ke kartu baru kapan saja.
              </p>

              <div>
                <p className="mb-2 text-sm font-semibold text-gray-700">Alasan unlink</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {CARD_UNLINK_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setReason(r)}
                      className={`min-h-[52px] rounded-xl border-2 px-3 text-sm font-medium transition-colors ${
                        reason === r
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-gray-200 bg-white text-gray-700 active:bg-gray-50"
                      }`}
                    >
                      {CARD_UNLINK_REASON_LABELS[r]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1 text-sm font-semibold text-gray-700">
                  Keterangan {reason === "other" ? <span className="text-red-600">(wajib)</span> : "(opsional)"}
                </p>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder={
                    reason === "returned"
                      ? "mis. kartu dikembalikan ke kasir, member pindah ke aplikasi"
                      : reason === "lost"
                        ? "mis. dilaporkan hilang tanggal …"
                        : "Tuliskan alasannya"
                  }
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={busy} onClick={closeDialog}>Batal</Button>
                <Button
                  className="gap-2 bg-red-600 text-white hover:bg-red-700"
                  disabled={!canConfirmUnlink || busy}
                  onClick={confirmUnlink}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
                  Lepas Kartu
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Dialog Refund (unlink + ajukan refund) */}
      <Dialog open={dialog?.kind === "refund"} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Refund saldo — {dialog?.kind === "refund" ? dialog.member.name || dialog.member.phone : ""}</DialogTitle>
          </DialogHeader>
          {dialog?.kind === "refund" ? (
            <div className="space-y-4">
              <MemberSummary member={dialog.member} />
              <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p><strong>1.</strong> Kartu <span className="font-mono">{dialog.member.nfc_uid}</span> dilepas sekarang.</p>
                <p><strong>2.</strong> Permintaan refund <strong>{rupiah(dialog.member.ark_coin_balance)}</strong> dicatat untuk Finance — saldo member <strong>belum</strong> berubah.</p>
                <p><strong>3.</strong> Setelah Finance mengembalikan uangnya, tandai <strong>Refund Completed</strong> (PIN supervisor) di daftar permintaan; saldo member menjadi Rp 0.</p>
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-700">Keterangan (opsional)</p>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="mis. rekening tujuan, alasan member berhenti"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={busy} onClick={closeDialog}>Batal</Button>
                <Button
                  className="gap-2 bg-amber-600 text-white hover:bg-amber-700"
                  disabled={busy}
                  onClick={confirmRefund}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />}
                  Lepas Kartu & Ajukan Refund
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Dialog Refund Completed (PIN supervisor) */}
      <Dialog open={dialog?.kind === "complete"} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Refund Completed — {dialog?.kind === "complete" ? dialog.request.name || dialog.request.phone : ""}</DialogTitle>
          </DialogHeader>
          {dialog?.kind === "complete" ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Saldo member saat ini</span>
                  <span className="font-semibold text-emerald-700">{rupiah(dialog.request.current_balance)}</span>
                </div>
                <div className="mt-1 flex justify-between text-xs text-gray-500">
                  <span>Diajukan {tanggal(dialog.request.requested_at)}</span>
                  <span>oleh {dialog.request.requested_by_name || "—"}</span>
                </div>
              </div>
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Tandai hanya bila Finance sudah mengonfirmasi uang <strong>{rupiah(dialog.request.current_balance)}</strong> dikembalikan
                ke member. Saldo ARK member akan menjadi <strong>Rp 0</strong> dan tercatat sebagai transaksi refund. XP tidak berubah.
              </p>
              <div>
                <p className="mb-1 text-sm font-semibold text-gray-700">Catatan Finance (opsional)</p>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="mis. transfer BCA 4 Sep, ref 123456"
                />
              </div>
              <div>
                <p className="mb-1 flex items-center gap-1 text-sm font-semibold text-gray-700"><Lock className="h-3.5 w-3.5" /> PIN supervisor</p>
                <Input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="Masukkan PIN supervisor"
                  className="h-11 tracking-[0.3em]"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={busy} onClick={closeDialog}>Batal</Button>
                <Button
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                  disabled={busy || pin.length < 4}
                  onClick={confirmComplete}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Tandai Refund Completed
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Dialog batalkan permintaan */}
      <Dialog open={dialog?.kind === "cancel"} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Batalkan permintaan refund — {dialog?.kind === "cancel" ? dialog.request.name || dialog.request.phone : ""}</DialogTitle>
          </DialogHeader>
          {dialog?.kind === "cancel" ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Permintaan dibatalkan, saldo member <strong>{rupiah(dialog.request.current_balance)}</strong> tetap utuh.
                Kartu yang sudah dilepas tidak dipasang kembali otomatis.
              </p>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Alasan pembatalan (opsional)"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={busy} onClick={closeDialog}>Kembali</Button>
                <Button className="gap-2" variant="outline" disabled={busy} onClick={confirmCancel}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                  Batalkan Permintaan
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MemberSummary({ member }: { member: MemberCardRow }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
      <div className="flex justify-between">
        <span className="text-gray-500">UID kartu</span>
        <span className="font-mono">{member.nfc_uid}</span>
      </div>
      <div className="mt-1 flex justify-between">
        <span className="text-gray-500">Saldo ARK</span>
        <span className="font-semibold text-emerald-700">{rupiah(member.ark_coin_balance)}</span>
      </div>
    </div>
  );
}
