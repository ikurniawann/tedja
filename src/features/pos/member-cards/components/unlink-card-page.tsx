"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Loader2, Nfc, Search, Unlink } from "lucide-react";

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
import { POS_NFC_CARD_EVENT, normalizeNfcUid, usePosNfcOptional } from "@/features/pos/nfc";

/**
 * POS → Member → Unlink Card (permintaan owner 2026-09-01): daftar member
 * berkartu, bisa dicari atau langsung di-tap kartunya lewat pembaca NFC,
 * lalu kartunya dilepas (hilang / dikembalikan) TANPA mereset saldo.
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
interface PageData {
  members: MemberCardRow[];
  recent_unlinks: UnlinkLogRow[];
}

const rupiah = (v: number | string | null | undefined) =>
  `Rp ${Math.round(Number(v) || 0).toLocaleString("id-ID")}`;
const tanggal = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("id-ID", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
      })
    : "—";

export function UnlinkCardPage() {
  const { toasts, showToast, removeToast } = useToast();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [data, setData] = useState<PageData | null>(null);
  const [target, setTarget] = useState<MemberCardRow | null>(null);
  const [reason, setReason] = useState<CardUnlinkReason | null>(null);
  const [notes, setNotes] = useState("");
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
        openDialog(found);
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

  function openDialog(member: MemberCardRow) {
    setTarget(member);
    setReason(null);
    setNotes("");
  }

  async function confirmUnlink() {
    if (!target || !reason || busy) return;
    setBusy(true);
    try {
      const res = await apiPost<{ message: string }>(
        `/api/pos/member-cards/${target.id}/unlink`,
        { reason, notes }
      );
      showToast(res.message ?? "Kartu dilepas");
      setTarget(null);
      load(applied);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal melepas kartu", "error");
    } finally {
      setBusy(false);
    }
  }

  const canConfirm = Boolean(reason) && (reason !== "other" || notes.trim().length >= 3);

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
          hanya tautan kartunya yang dilepas.
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
                <Button
                  variant="outline"
                  className="h-11 w-full gap-2 border-red-200 text-red-700 hover:bg-red-50"
                  onClick={() => openDialog(m)}
                >
                  <Unlink className="h-4 w-4" /> Unlink Kartu
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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

      <Dialog open={target !== null} onOpenChange={(open) => { if (!open && !busy) setTarget(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Unlink kartu — {target?.name || target?.phone}</DialogTitle>
          </DialogHeader>
          {target ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">UID kartu</span>
                  <span className="font-mono">{target.nfc_uid}</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-gray-500">Saldo ARK</span>
                  <span className="font-semibold text-emerald-700">{rupiah(target.ark_coin_balance)}</span>
                </div>
              </div>
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
                <Button variant="outline" disabled={busy} onClick={() => setTarget(null)}>
                  Batal
                </Button>
                <Button
                  className="gap-2 bg-red-600 text-white hover:bg-red-700"
                  disabled={!canConfirm || busy}
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
    </div>
  );
}
