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
import { Textarea } from "@/components/ui/textarea";
import { buildWaLink } from "@/lib/recruitment/wa";
import { useCreateOffer, useLogWaTemplate } from "../mutations";
import type { OfferSalaryReference } from "../api";

interface OfferSendDialogProps {
  candidate: { id: string; full_name: string; phone?: string | null };
  positionTitle: string;
  salaryReference: OfferSalaryReference;
  hasOpenOffer: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_EXPIRES_DAYS = 7;

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Dialog "Buat Offer": gaji pokok + benefit + tanggal mulai + masa berlaku
 * → buat offer (token portal) → link salin / kirim via WA. Peringatan lunak
 * bila gaji melebihi salary_max posisi; revisi baru otomatis meng-expire
 * offer terbuka sebelumnya (di server).
 */
export function OfferSendDialog({
  candidate,
  positionTitle,
  salaryReference,
  hasOpenOffer,
  open,
  onOpenChange,
}: OfferSendDialogProps) {
  const createOffer = useCreateOffer();
  const logWa = useLogWaTemplate();

  const [salary, setSalary] = useState("");
  const [benefitsText, setBenefitsText] = useState("");
  const [startDate, setStartDate] = useState("");
  const [notes, setNotes] = useState("");
  const [expiresDays, setExpiresDays] = useState(String(DEFAULT_EXPIRES_DAYS));
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const salaryNumber = Number(salary.replace(/[^\d]/g, ""));
  const overBudget =
    salaryReference.salary_max != null &&
    salaryNumber > 0 &&
    salaryNumber > salaryReference.salary_max;

  const handleCreate = () => {
    const days = Number(expiresDays);
    if (!Number.isFinite(salaryNumber) || salaryNumber <= 0) {
      toast.error("Isi gaji pokok yang valid");
      return;
    }
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      toast.error("Masa berlaku harus 1–30 hari");
      return;
    }
    const benefits = benefitsText
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean)
      .slice(0, 15);
    createOffer.mutate(
      {
        id: candidate.id,
        payload: {
          base_salary: salaryNumber,
          benefits,
          start_date: startDate || null,
          notes: notes.trim() || null,
          expires_days: days,
        },
      },
      {
        onSuccess: (offer) => {
          setCreatedLink(`${window.location.origin}/offer/${offer.token}`);
          toast.success(`Offer v${offer.version} dibuat`);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal membuat offer"),
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
      `Halo ${candidate.full_name}, selamat! Kami dengan senang hati menawarkan Anda posisi ` +
      `${positionTitle}. Rincian penawaran (gaji, benefit, tanggal mulai) dapat Anda lihat dan ` +
      `respons langsung melalui link berikut: ${createdLink} (berlaku ${expiresDays} hari). ` +
      `Kami tunggu kabar baiknya. Terima kasih.`;
    const link = buildWaLink(candidate.phone, message);
    if (!link) {
      toast.error("Nomor HP kandidat belum diisi");
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
    logWa.mutate({ id: candidate.id, template: "offer_terkirim" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Buat Penawaran Kerja</DialogPanelTitle>
          <DialogPanelDescription>
            Kandidat melihat & merespons offer (terima / nego / tolak) lewat link token tanpa
            login — responsnya otomatis masuk ke panel ini.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {createdLink ? (
            <div className="space-y-3">
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                Offer dibuat. Bagikan link berikut ke kandidat:
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
            <>
              {hasOpenOffer && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  Masih ada offer yang terbuka — membuat offer baru otomatis membatalkan
                  (meng-expire) offer sebelumnya.
                </p>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Gaji Pokok / bulan (Rp)</Label>
                <Input
                  type="number"
                  min={0}
                  value={salary}
                  onChange={(e) => setSalary(e.target.value)}
                  placeholder="mis. 5500000"
                />
                {salaryNumber > 0 && (
                  <p className="text-xs text-muted-foreground">{formatRupiah(salaryNumber)}</p>
                )}
                {overBudget && (
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    Melebihi budget posisi ({formatRupiah(salaryReference.salary_max!)}) — pastikan
                    sudah disetujui atasan.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Benefit & Tunjangan (satu per baris)</Label>
                <Textarea
                  value={benefitsText}
                  onChange={(e) => setBenefitsText(e.target.value)}
                  rows={3}
                  placeholder={"BPJS Kesehatan & Ketenagakerjaan\nTunjangan makan & transport\nTHR"}
                />
              </div>
              <div className="flex flex-wrap gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Tanggal Mulai Kerja</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-40"
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
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Catatan Internal (tidak dilihat kandidat)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="mis. sudah approve BM, band gaji level 2"
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
            <Button type="button" onClick={handleCreate} disabled={createOffer.isPending}>
              {createOffer.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Buat Offer
            </Button>
          )}
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
