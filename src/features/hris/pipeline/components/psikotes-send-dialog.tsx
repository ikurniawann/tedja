"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildWaLink } from "@/lib/recruitment/wa";
import { usePsikotesInstruments } from "@/features/hris/psikotes/queries";
import { useCreatePsikotesSession, useLogWaTemplate } from "../mutations";

interface PsikotesSendDialogProps {
  candidate: { id: string; full_name: string; phone?: string | null };
  positionTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_EXPIRES_DAYS = 3;

/**
 * Dialog "Kirim / jadwalkan tes": pilih instrumen aktif (default semua),
 * masa berlaku → buat sesi + token → tampilkan link (salin / kirim via
 * template WA undangan_psikotes, tercatat di aktivitas).
 */
export function PsikotesSendDialog({
  candidate,
  positionTitle,
  open,
  onOpenChange,
}: PsikotesSendDialogProps) {
  const instrumentsQuery = usePsikotesInstruments(open);
  const createSession = useCreatePsikotesSession();
  const logWa = useLogWaTemplate();

  const activeInstruments = useMemo(
    () => (instrumentsQuery.data ?? []).filter((i) => i.is_active),
    [instrumentsQuery.data]
  );
  // di-mount kondisional oleh panel (spt dialog detail/proctor) — state
  // otomatis segar tiap kali dibuka, undangan kedua tidak terjebak di
  // layar hasil undangan pertama
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [expiresDays, setExpiresDays] = useState(String(DEFAULT_EXPIRES_DAYS));
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const selectedIds = activeInstruments.filter((i) => !excluded.has(i.id)).map((i) => i.id);

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleCreate = () => {
    const days = Number(expiresDays);
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      toast.error("Masa berlaku harus 1–30 hari");
      return;
    }
    if (selectedIds.length === 0) {
      toast.error("Pilih minimal satu instrumen");
      return;
    }
    createSession.mutate(
      { id: candidate.id, payload: { instrument_ids: selectedIds, expires_days: days } },
      {
        onSuccess: (session) => {
          setCreatedLink(`${window.location.origin}/psikotes/${session.token}`);
          toast.success("Undangan tes dibuat");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal membuat undangan"),
      }
    );
  };

  const handleCopy = async () => {
    if (!createdLink) return;
    await navigator.clipboard.writeText(createdLink).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWa = () => {
    if (!createdLink) return;
    const message =
      `Halo ${candidate.full_name}, selamat! Anda diundang mengikuti psikotes online ` +
      `untuk posisi ${positionTitle}. Silakan kerjakan melalui link berikut: ${createdLink} ` +
      `(berlaku ${expiresDays} hari). Kerjakan di tempat tenang dengan koneksi stabil. Terima kasih.`;
    const link = buildWaLink(candidate.phone, message);
    if (!link) {
      toast.error("Nomor HP kandidat belum diisi");
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
    logWa.mutate({ id: candidate.id, template: "undangan_psikotes" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Kirim / Jadwalkan Tes</DialogPanelTitle>
          <DialogPanelDescription>
            Kandidat mengerjakan lewat link token tanpa login — hasil otomatis masuk ke panel ini.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {createdLink ? (
            <div className="space-y-3">
              <p className="text-sm text-emerald-700">
                Undangan dibuat. Bagikan link berikut ke kandidat:
              </p>
              <div className="flex items-center gap-2">
                <Input readOnly value={createdLink} className="text-xs" />
                <Button type="button" variant="outline" size="icon" onClick={handleCopy} aria-label="Salin link">
                  {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                </Button>
              </div>
              <Button type="button" className="w-full" onClick={handleWa} disabled={!candidate.phone}>
                <MessageCircle className="size-4" /> Kirim via WhatsApp
              </Button>
              {!candidate.phone && (
                <p className="text-xs text-amber-700">
                  Nomor HP kandidat belum diisi — salin link secara manual.
                </p>
              )}
            </div>
          ) : instrumentsQuery.isLoading ? (
            <div className="flex justify-center py-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Instrumen Tes</Label>
                <div className="divide-y divide-border rounded-lg border border-border">
                  {activeInstruments.map((instrument) => (
                    <label
                      key={instrument.id}
                      className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm"
                    >
                      <Checkbox
                        checked={!excluded.has(instrument.id)}
                        onCheckedChange={() => toggle(instrument.id)}
                      />
                      <span className="flex-1">{instrument.name}</span>
                      {instrument.kind !== "drawing" && instrument.active_question_count === 0 && (
                        <span className="text-xs text-amber-600">bank soal kosong</span>
                      )}
                    </label>
                  ))}
                  {activeInstruments.length === 0 && (
                    <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                      Tidak ada instrumen aktif — aktifkan di menu Psikotes.
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Masa Berlaku (hari)</Label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={expiresDays}
                  onChange={(e) => setExpiresDays(e.target.value)}
                  className="w-28"
                />
              </div>
            </>
          )}
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {createdLink ? "Tutup" : "Batal"}
          </Button>
          {!createdLink && (
            <Button
              type="button"
              onClick={handleCreate}
              disabled={createSession.isPending || selectedIds.length === 0}
            >
              {createSession.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Buat Undangan
            </Button>
          )}
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
