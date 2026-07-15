"use client";

import { useState } from "react";
import { Check, Copy, Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { useCreateInterviewSession, useLogWaTemplate } from "../mutations";

interface InterviewSendDialogProps {
  candidate: { id: string; full_name: string; phone?: string | null };
  positionTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_EXPIRES_DAYS = 3;
const DEFAULT_MAX_QUESTIONS = 8;

/**
 * Dialog "Kirim undangan interview AI": atur jumlah pertanyaan & masa
 * berlaku → buat sesi + token → tampilkan link (salin / kirim via WA,
 * tercatat di aktivitas). Kandidat interview via /interview/[token].
 */
export function InterviewSendDialog({
  candidate,
  positionTitle,
  open,
  onOpenChange,
}: InterviewSendDialogProps) {
  const createSession = useCreateInterviewSession();
  const logWa = useLogWaTemplate();

  const [expiresDays, setExpiresDays] = useState(String(DEFAULT_EXPIRES_DAYS));
  const [maxQuestions, setMaxQuestions] = useState(String(DEFAULT_MAX_QUESTIONS));
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = () => {
    const days = Number(expiresDays);
    const questions = Number(maxQuestions);
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      toast.error("Masa berlaku harus 1–30 hari");
      return;
    }
    if (!Number.isInteger(questions) || questions < 3 || questions > 15) {
      toast.error("Jumlah pertanyaan harus 3–15");
      return;
    }
    createSession.mutate(
      { id: candidate.id, payload: { expires_days: days, max_questions: questions } },
      {
        onSuccess: (session) => {
          setCreatedLink(`${window.location.origin}/interview/${session.token}`);
          toast.success("Undangan interview dibuat");
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
      `Halo ${candidate.full_name}, selamat! Anda diundang mengikuti interview online ` +
      `untuk posisi ${positionTitle}. Interview dipandu AI interviewer kami dengan suara — ` +
      `wajib menggunakan kamera & mikrofon. Silakan mulai melalui link berikut: ${createdLink} ` +
      `(berlaku ${expiresDays} hari). Siapkan tempat tenang dengan koneksi stabil. Terima kasih.`;
    const link = buildWaLink(candidate.phone, message);
    if (!link) {
      toast.error("Nomor HP kandidat belum diisi");
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
    logWa.mutate({ id: candidate.id, template: "undangan_interview" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Kirim Undangan Interview AI</DialogPanelTitle>
          <DialogPanelDescription>
            Kandidat diwawancara AI (suara, wajib on-cam) lewat link token tanpa login — transkrip
            & kesimpulan otomatis masuk ke panel ini.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {createdLink ? (
            <div className="space-y-3">
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                Undangan dibuat. Bagikan link berikut ke kandidat:
              </p>
              <div className="flex items-center gap-2">
                <Input readOnly value={createdLink} className="text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                  aria-label="Salin link"
                >
                  {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                </Button>
              </div>
              <Button type="button" className="w-full" onClick={handleWa} disabled={!candidate.phone}>
                <MessageCircle className="size-4" /> Kirim via WhatsApp
              </Button>
              {!candidate.phone && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Nomor HP kandidat belum diisi — salin link secara manual.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Maks Pertanyaan</Label>
                <Input
                  type="number"
                  min={3}
                  max={15}
                  value={maxQuestions}
                  onChange={(e) => setMaxQuestions(e.target.value)}
                  className="w-28"
                />
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
              <p className="w-full text-xs text-muted-foreground">
                AI menanyakan topik basic: perkenalan & pengalaman, keahlian, motivasi,
                ketersediaan, dan ekspektasi gaji — lalu menyimpulkan relevansi kandidat.
              </p>
            </div>
          )}
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {createdLink ? "Tutup" : "Batal"}
          </Button>
          {!createdLink && (
            <Button type="button" onClick={handleCreate} disabled={createSession.isPending}>
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
