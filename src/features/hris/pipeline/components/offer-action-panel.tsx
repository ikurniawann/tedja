"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeDollarSign,
  CheckCircle2,
  Circle,
  Copy,
  Handshake,
  Loader2,
  MessageCircle,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PipelineStage } from "@/types";
import { buildWaLink } from "@/lib/recruitment/wa";
import { useCandidateOffers } from "../queries";
import { useLogWaTemplate, useRecordOfferResponse } from "../mutations";
import type { CandidateOffer } from "../api";
import { OfferSendDialog } from "./offer-send-dialog";

export interface OfferPanelCandidate {
  id: string;
  full_name: string;
  phone?: string | null;
  positions?: { title: string } | null;
}

const OFFER_STATUS_META: Record<CandidateOffer["status"], { label: string; badge: string }> = {
  sent: { label: "Menunggu respons", badge: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300" },
  negotiating: { label: "Negosiasi", badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" },
  accepted: { label: "Diterima", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" },
  declined: { label: "Ditolak", badge: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300" },
  expired: { label: "Kedaluwarsa", badge: "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300" },
};

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function ChecklistItem({ done, label, hint }: { done: boolean; label: string; hint?: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {done ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/40" />
      )}
      <div>
        <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** Form pencatatan respons manual utk offer yang masih terbuka. */
function ManualResponseForm({
  offer,
  candidateId,
}: {
  offer: CandidateOffer;
  candidateId: string;
}) {
  const record = useRecordOfferResponse();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const submit = (status: "negotiating" | "accepted" | "declined") => {
    record.mutate(
      { offerId: offer.id, candidateId, payload: { status, note: note.trim() || null } },
      {
        onSuccess: () => {
          setOpen(false);
          setNote("");
          toast.success("Respons kandidat tercatat");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal mencatat respons"),
      }
    );
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
      >
        Catat respons manual (kandidat membalas via WA/telepon)
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-lg bg-muted/50 p-2.5">
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Catatan respons kandidat (opsional utk terima/tolak, wajib jelas utk nego)"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={record.isPending} onClick={() => submit("accepted")}>
          Terima
        </Button>
        <Button size="sm" variant="outline" disabled={record.isPending} onClick={() => submit("negotiating")}>
          Nego
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-red-600 dark:text-red-400"
          disabled={record.isPending}
          onClick={() => submit("declined")}
        >
          Tolak
        </Button>
        <Button size="sm" variant="ghost" disabled={record.isPending} onClick={() => setOpen(false)}>
          Batal
        </Button>
      </div>
    </div>
  );
}

/**
 * Action panel tahap Offer (EPIC-004):
 * 1. Referensi gaji (ekspektasi lamaran + interview AI + budget posisi)
 * 2. Buat/revisi offer (link portal + WA) & riwayat versi + respons kandidat
 * 3. Keputusan (Diterima → Hired digate offer accepted).
 */
export function OfferActionPanel({
  candidate,
  onMove,
  moving = false,
}: {
  candidate: OfferPanelCandidate;
  onMove: (stage: PipelineStage) => void;
  moving?: boolean;
}) {
  const offersQuery = useCandidateOffers(candidate.id);
  const logWa = useLogWaTemplate();
  const [sendOpen, setSendOpen] = useState(false);

  const data = offersQuery.data ?? null;
  const offers = useMemo(() => data?.offers ?? [], [data]);
  const ref = data?.salary_reference ?? null;
  const acceptedOffer = offers.find((o) => o.status === "accepted") ?? null;
  const hasOpenOffer = offers.some((o) => o.status === "sent" || o.status === "negotiating");
  const positionTitle = candidate.positions?.title ?? ref?.position_title ?? "posisi yang dilamar";

  const interviewExpectation = ref?.interview_expectation ?? null;

  const checklist = [
    {
      label: "Offer dibuat & dikirim",
      done: offers.length > 0,
      hint: offers.length > 0 ? `${offers.length} versi` : undefined,
    },
    {
      label: "Respons kandidat tercatat",
      done: offers.some((o) => o.responded_at),
    },
    { label: "Offer diterima kandidat", done: Boolean(acceptedOffer) },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  const copyOfferLink = async (offer: CandidateOffer) => {
    if (!offer.token) return;
    const link = `${window.location.origin}/offer/${offer.token}`;
    await navigator.clipboard.writeText(link).catch(() => undefined);
    toast.success("Link offer disalin");
  };

  const handlePenolakan = () => {
    const message =
      `Halo ${candidate.full_name}, terima kasih atas waktu dan partisipasi Anda dalam proses seleksi posisi ${positionTitle}. ` +
      `Setelah pertimbangan, saat ini kami belum dapat melanjutkan proses Anda ke tahap berikutnya. ` +
      `Data Anda tetap kami simpan untuk peluang yang sesuai di masa mendatang. Semoga sukses selalu.`;
    const link = buildWaLink(candidate.phone, message);
    if (!link) return;
    window.open(link, "_blank", "noopener,noreferrer");
    logWa.mutate({ id: candidate.id, template: "penolakan" });
  };

  if (offersQuery.isLoading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border py-12 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (offersQuery.isError) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border py-10">
        <p className="text-sm text-red-600 dark:text-red-400">
          {offersQuery.error instanceof Error ? offersQuery.error.message : "Gagal memuat data offer"}
        </p>
        <Button size="sm" variant="outline" onClick={() => offersQuery.refetch()}>
          Coba Lagi
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Checklist ── */}
      <div className="rounded-xl border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Handshake className="size-4 text-emerald-500" /> Offering
          </h3>
          <span className="text-xs text-muted-foreground">
            {doneCount}/{checklist.length} langkah
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {checklist.map((item) => (
            <ChecklistItem key={item.label} done={item.done} label={item.label} hint={item.hint} />
          ))}
        </div>
      </div>

      {/* ── Referensi gaji ── */}
      {ref && (
        <div className="rounded-xl border border-border p-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <BadgeDollarSign className="size-4 text-emerald-500" /> Referensi Gaji
          </h4>
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-lg bg-muted/50 p-2.5">
              <p className="text-xs text-muted-foreground">Ekspektasi di lamaran</p>
              <p className="font-semibold text-foreground">
                {ref.expected_salary ? formatRupiah(ref.expected_salary) : "—"}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2.5">
              <p className="text-xs text-muted-foreground">Disebut saat interview AI</p>
              <p className="font-semibold text-foreground">
                {interviewExpectation?.disebutkan ? (interviewExpectation.nilai ?? "disebutkan") : "—"}
              </p>
              {interviewExpectation?.catatan && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {interviewExpectation.catatan}
                </p>
              )}
            </div>
            <div className="rounded-lg bg-muted/50 p-2.5">
              <p className="text-xs text-muted-foreground">Budget posisi</p>
              <p className="font-semibold text-foreground">
                {ref.salary_min || ref.salary_max
                  ? `${ref.salary_min ? formatRupiah(ref.salary_min) : "—"} s/d ${ref.salary_max ? formatRupiah(ref.salary_max) : "—"}`
                  : "belum diatur"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Riwayat offer ── */}
      <div className="rounded-xl border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">Penawaran</h4>
          <Button size="sm" variant="outline" onClick={() => setSendOpen(true)}>
            <Plus className="size-3.5" /> {offers.length > 0 ? "Revisi offer" : "Buat offer"}
          </Button>
        </div>

        {offers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            Belum ada penawaran. Buat offer — kandidat merespons lewat link portal.
          </p>
        ) : (
          <div className="space-y-3">
            {offers.map((offer) => {
              const meta = OFFER_STATUS_META[offer.status];
              const isOpen = offer.status === "sent" || offer.status === "negotiating";
              return (
                <div key={offer.id} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      v{offer.version} · {formatRupiah(offer.base_salary)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.badge}`}>
                      {meta.label}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {offer.sent_at &&
                        new Date(offer.sent_at).toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                        })}
                      {offer.created_by_name ? ` · ${offer.created_by_name}` : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {offer.benefits.length > 0 && <span>{offer.benefits.join(" · ")}</span>}
                    {offer.start_date && (
                      <span>
                        mulai{" "}
                        {new Date(offer.start_date).toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    )}
                    {offer.expires_at && isOpen && (
                      <span>
                        berlaku s/d{" "}
                        {new Date(offer.expires_at).toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    )}
                  </div>
                  {offer.response_note && (
                    <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-foreground">
                      <span className="font-medium">Respons kandidat</span>
                      {offer.response_source === "portal" ? " (via portal)" : " (dicatat manual)"}:{" "}
                      {offer.response_note}
                    </p>
                  )}
                  {offer.notes && (
                    <p className="text-[11px] italic text-muted-foreground">
                      Catatan internal: {offer.notes}
                    </p>
                  )}
                  {isOpen && (
                    <div className="flex flex-wrap items-center gap-3">
                      {offer.token && (
                        <button
                          type="button"
                          onClick={() => copyOfferLink(offer)}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                          <Copy className="size-3" /> salin link
                        </button>
                      )}
                      <ManualResponseForm offer={offer} candidateId={candidate.id} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Keputusan ── */}
      <div className="rounded-xl border border-border p-4">
        <h4 className="mb-3 text-sm font-semibold text-foreground">Keputusan</h4>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={moving || !acceptedOffer} onClick={() => onMove("hired")}>
            Diterima → Hired <ArrowRight className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-pink-600 hover:bg-pink-50 dark:text-pink-400 dark:hover:bg-pink-500/10"
            disabled={moving}
            onClick={() => onMove("talent_pool")}
          >
            Simpan ke Talent Pool
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
            disabled={moving}
            onClick={() => onMove("rejected")}
          >
            Tolak
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!candidate.phone || logWa.isPending}
            onClick={handlePenolakan}
          >
            <MessageCircle className="size-3.5 text-emerald-500" /> WA Penolakan Halus
          </Button>
        </div>
        {!acceptedOffer && (
          <p className="mt-2 text-xs text-muted-foreground">
            Tombol &quot;Diterima → Hired&quot; aktif setelah kandidat menerima offer.
          </p>
        )}
      </div>

      {sendOpen && ref && (
        <OfferSendDialog
          candidate={candidate}
          positionTitle={positionTitle}
          salaryReference={ref}
          hasOpenOffer={hasOpenOffer}
          open
          onOpenChange={setSendOpen}
        />
      )}
    </div>
  );
}
