"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Bot,
  Briefcase,
  Building2,
  Calendar,
  Clock,
  Download,
  Edit3,
  FileText,
  GraduationCap,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  MoreVertical,
  Phone,
  RotateCcw,
  Save,
  User,
  UserCheck,
  Wallet,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { PromoteCandidateButton } from "@/components/hris/PromoteCandidateButton";
import { useCandidateDetail } from "../queries";
import { useUpdateCandidateStatus, useAddCandidateNote } from "../mutations";
import type {
  CandidateView,
  CandidateActivity as Activity,
  CandidateNote as Note,
} from "../types";
import {
  CANDIDATE_STATUS_LABELS,
  CANDIDATE_STATUS_BADGES,
} from "@/lib/recruitment/status";
import type { PipelineStage } from "@/types";
import { StageStepper } from "@/features/hris/pipeline/components/stage-stepper";
import { AppliedActionPanel } from "@/features/hris/pipeline/components/applied-action-panel";
import { ScreeningActionPanel } from "@/features/hris/pipeline/components/screening-action-panel";
import { PsikotesActionPanel } from "@/features/hris/pipeline/components/psikotes-action-panel";
import { InterviewActionPanel } from "@/features/hris/pipeline/components/interview-action-panel";
import { OfferActionPanel } from "@/features/hris/pipeline/components/offer-action-panel";
import { buildWaLink } from "@/lib/recruitment/wa";
import { useCandidateAiAnalysis } from "@/features/hris/pipeline/queries";

const STATUS_LABELS: Record<string, string> = CANDIDATE_STATUS_LABELS;
const STATUS_COLORS: Record<string, string> = CANDIDATE_STATUS_BADGES;

const SOURCE_LABELS: Record<string, string> = {
  portal: "Portal",
  internal: "Internal",
  referral: "Rekomendasi",
  jobstreet: "JobStreet",
  instagram: "Instagram",
  jobfair: "Job Fair",
  walk_in: "Walk-in",
  internal_referral: "Referral Internal",
  headhunter: "Headhunter",
  other: "Lainnya",
};

const AVAILABILITY_LABELS: Record<string, string> = {
  immediate: "Segera",
  "1_week": "1 minggu",
  "2_weeks": "2 minggu",
  "1_month": "1 bulan",
};

function daysInStage(updatedAt: string): number {
  return Math.max(
    0,
    Math.ceil((Date.now() - new Date(updatedAt).getTime()) / 86_400_000)
  );
}

function scoreColor(score: number) {
  if (score >= 75) return "text-emerald-600 bg-emerald-50 ring-emerald-200";
  if (score >= 50) return "text-amber-600 bg-amber-50 ring-amber-200";
  return "text-red-600 bg-red-50 ring-red-200";
}

function InfoField({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-gray-400" />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
        <p className="text-sm font-medium break-words text-gray-800">{value || "—"}</p>
      </div>
    </div>
  );
}

interface TimelineEntry {
  id: string;
  kind: "note" | "activity";
  text: string;
  author: string;
  at: string;
}

/** Daftar entri timeline dengan garis + titik penanda. */
function TimelineList({
  entries,
  emptyText,
}: {
  entries: TimelineEntry[];
  emptyText: string;
}) {
  if (entries.length === 0) {
    return <p className="mt-4 text-sm text-gray-400">{emptyText}</p>;
  }
  return (
    <ol className="mt-4 max-h-[420px] overflow-y-auto pr-1">
      {entries.map((entry, idx) => (
        <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
          {idx < entries.length - 1 && (
            <span
              aria-hidden
              className="absolute top-3 left-[5px] h-full w-px bg-gray-200"
            />
          )}
          <span
            aria-hidden
            className={`relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-white ring-1 ring-gray-200 ${
              entry.kind === "note" ? "bg-amber-400" : "bg-blue-400"
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-xs font-semibold text-gray-700">{entry.author}</span>
              <time className="text-[11px] text-gray-400" dateTime={entry.at}>
                {new Date(entry.at).toLocaleString("id-ID", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
            <p
              className={`mt-0.5 text-sm whitespace-pre-wrap ${
                entry.kind === "note"
                  ? "rounded-lg bg-amber-50/60 px-2.5 py-1.5 text-gray-700"
                  : "text-gray-500"
              }`}
            >
              {entry.text}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function CandidateDetailPage() {
  const params = useParams();
  const candidateId = params?.id as string;

  const detailQuery = useCandidateDetail(candidateId);
  const loading = detailQuery.isLoading;
  const candidate = detailQuery.data?.candidate ?? null;
  const activitiesData = detailQuery.data?.activities;
  const notesData = detailQuery.data?.notes;

  const analysisQuery = useCandidateAiAnalysis(candidateId ?? null);
  const analysis = analysisQuery.data;

  const updateStatusMutation = useUpdateCandidateStatus();
  const addNoteMutation = useAddCandidateNote();
  const statusUpdating = updateStatusMutation.isPending;

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  // dua timeline terpisah (tab): catatan HR & aktivitas pipeline
  const { noteEntries, activityEntries } = useMemo(() => {
    const notes: Note[] = notesData ?? [];
    const activities: Activity[] = activitiesData ?? [];
    return {
      noteEntries: notes.map((n) => ({
        id: `note-${n.id}`,
        kind: "note" as const,
        text: n.content,
        author: n.created_by_name || "HR",
        at: n.created_at,
      })),
      // note_added dilewati: isi catatannya sudah tampil di tab Catatan
      activityEntries: activities
        .filter((a) => a.activity_type !== "note_added")
        .map((a) => ({
          id: `act-${a.id}`,
          kind: "activity" as const,
          text: a.description,
          author: a.created_by_name || "Sistem",
          at: a.created_at,
        })),
    };
  }, [notesData, activitiesData]);

  const handleStatusChange = async (newStatus: PipelineStage | string) => {
    if (!candidate || candidate.status === newStatus) return;
    try {
      await updateStatusMutation.mutateAsync({
        id: candidate.id,
        status: newStatus,
        description: "",
      });
      toast.success(`Dipindahkan ke ${STATUS_LABELS[newStatus] ?? newStatus}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengubah tahap");
    }
  };

  const handleAddNote = async () => {
    if (!candidate || !noteDraft.trim()) return;
    try {
      await addNoteMutation.mutateAsync({ id: candidate.id, content: noteDraft.trim() });
      setNoteDraft("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menambahkan catatan");
    }
  };

  const handleDownloadCV = () => {
    if (candidate?.cv_url) window.open(candidate.cv_url, "_blank");
    else toast.error("CV belum diupload");
  };

  const handleSendWhatsApp = () => {
    const link = buildWaLink(
      candidate?.phone,
      `Halo ${candidate?.full_name}, terima kasih telah melamar di perusahaan kami.`
    );
    if (link) window.open(link, "_blank", "noopener,noreferrer");
  };

  const handleSendEmail = () => {
    if (!candidate?.email) return;
    window.location.href = `mailto:${candidate.email}?subject=Proses Rekrutmen&body=Halo ${candidate.full_name},`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="mr-2 size-5 animate-spin" /> Memuat data kandidat…
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="flex items-center justify-center py-16">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <User className="mx-auto mb-4 h-16 w-16 text-gray-300" />
            <h2 className="mb-2 text-xl font-semibold text-gray-900">
              Kandidat Tidak Ditemukan
            </h2>
            <p className="mb-4 text-gray-500">
              Kandidat yang Anda cari tidak ada atau sudah dihapus.
            </p>
            <Link href="/dashboard/hris/candidates">
              <Button>Kembali ke Daftar Kandidat</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const status = candidate.status as PipelineStage;
  const days = daysInStage(candidate.updated_at);
  const isParked = status === "talent_pool" || status === "rejected";

  return (
    <div className="space-y-5">
      {/* ══ Header ══ */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <Link href="/dashboard/hris/candidates" className="mt-1">
              <Button variant="ghost" size="icon" aria-label="Kembali">
                <ArrowLeft className="size-5" />
              </Button>
            </Link>
            <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 text-2xl font-bold text-white shadow-sm">
              {candidate.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">
                  {candidate.full_name}
                </h1>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[status]}`}
                >
                  {STATUS_LABELS[status]}
                </span>
                {days > 7 && !isParked && (
                  <span
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      days > 14 ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                    }`}
                  >
                    <Clock className="size-3" /> {days} hari di tahap ini
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                <span className="flex items-center gap-1.5">
                  <Briefcase className="size-3.5" />
                  {candidate.positions?.title ?? "Posisi belum diisi"}
                </span>
                {candidate.brands?.name && (
                  <span className="flex items-center gap-1.5">
                    <Building2 className="size-3.5" /> {candidate.brands.name}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <Calendar className="size-3.5" />
                  Apply{" "}
                  {new Date(candidate.created_at).toLocaleDateString("id-ID", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <span>{SOURCE_LABELS[candidate.source] || candidate.source}</span>
              </div>
              {/* kontak cepat */}
              <div className="mt-2.5 flex flex-wrap gap-2">
                {candidate.phone && (
                  <button
                    onClick={handleSendWhatsApp}
                    className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                  >
                    <Phone className="size-3" /> {candidate.phone}
                  </button>
                )}
                {candidate.email && (
                  <button
                    onClick={handleSendEmail}
                    className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100"
                  >
                    <Mail className="size-3" /> {candidate.email}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 self-start">
            <Button variant="outline" size="sm" onClick={() => setShowEditDialog(true)}>
              <Edit3 className="size-4" /> Edit
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="icon" aria-label="Menu lainnya" />}
              >
                <MoreVertical className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleDownloadCV}>
                  <Download className="size-4" /> Download CV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSendWhatsApp}>
                  <Phone className="size-4" /> Kirim WhatsApp
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSendEmail}>
                  <Mail className="size-4" /> Kirim Email
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* ── Stage bar ── */}
        <div className="mt-5 border-t border-gray-100 pt-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <StageStepper status={status} onMove={handleStatusChange} size="lg" />
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant={status === "talent_pool" ? "default" : "outline"}
                className={status === "talent_pool" ? "" : "text-pink-600 hover:bg-pink-50"}
                disabled={statusUpdating || status === "talent_pool"}
                onClick={() => handleStatusChange("talent_pool")}
              >
                Talent Pool
              </Button>
              <Button
                size="sm"
                variant={status === "rejected" ? "default" : "outline"}
                className={status === "rejected" ? "" : "text-red-600 hover:bg-red-50"}
                disabled={statusUpdating || status === "rejected"}
                onClick={() => handleStatusChange("rejected")}
              >
                Tolak
              </Button>
            </div>
          </div>
          {statusUpdating && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
              <Loader2 className="size-3 animate-spin" /> Memindahkan kandidat…
            </p>
          )}
        </div>
      </div>

      {/* ══ Main grid ══ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* ── Kiri: action panel per tahap + profil ── */}
        <div className="space-y-5 lg:col-span-2">
          {status === "applied" && (
            <AppliedActionPanel candidate={candidate} showNotes={false} />
          )}

          {status === "screening" && (
            <ScreeningActionPanel
              key={candidate.id}
              candidate={candidate}
              onMove={handleStatusChange}
              moving={statusUpdating}
            />
          )}

          {status === "psikotes" && (
            <PsikotesActionPanel
              key={candidate.id}
              candidate={candidate}
              onMove={handleStatusChange}
              moving={statusUpdating}
            />
          )}

          {status === "interview" && (
            <InterviewActionPanel
              key={candidate.id}
              candidate={candidate}
              onMove={handleStatusChange}
              moving={statusUpdating}
            />
          )}

          {status === "offer" && (
            <OfferActionPanel
              key={candidate.id}
              candidate={candidate}
              onMove={handleStatusChange}
              moving={statusUpdating}
            />
          )}

          {status === "hired" && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5">
              <div className="flex items-start gap-3">
                <div className="flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  <UserCheck className="size-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-emerald-800">
                    Kandidat diterima 🎉
                  </h3>
                  {candidate.promoted_to_employee_id ? (
                    <p className="mt-1 text-sm text-emerald-700">
                      Sudah dipromosikan menjadi karyawan.
                    </p>
                  ) : (
                    <>
                      <p className="mt-1 text-sm text-emerald-700">
                        Langkah berikutnya: promosikan menjadi karyawan agar masuk ke
                        HRIS (onboarding, payroll, absensi).
                      </p>
                      <div className="mt-3">
                        <PromoteCandidateButton
                          candidate={candidate as CandidateView & { status: string }}
                          onSuccess={() => {
                            toast.success("Berhasil dipromosikan menjadi karyawan!");
                            detailQuery.refetch();
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {isParked && (
            <div
              className={`rounded-xl border p-5 ${
                status === "talent_pool"
                  ? "border-pink-200 bg-pink-50/50"
                  : "border-red-200 bg-red-50/50"
              }`}
            >
              <h3
                className={`text-sm font-semibold ${
                  status === "talent_pool" ? "text-pink-800" : "text-red-800"
                }`}
              >
                {status === "talent_pool"
                  ? "Kandidat disimpan di Talent Pool"
                  : "Kandidat ditolak"}
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                {status === "talent_pool"
                  ? "Kandidat potensial untuk kebutuhan mendatang. Bisa dikembalikan ke pipeline kapan saja."
                  : "Kandidat tidak dilanjutkan. Bisa dibuka kembali bila dibutuhkan."}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                disabled={statusUpdating}
                onClick={() => handleStatusChange("applied")}
              >
                <RotateCcw className="size-3.5" /> Kembalikan ke Pipeline (Applied)
              </Button>
              {status === "talent_pool" && !candidate.promoted_to_employee_id && (
                <div className="mt-3">
                  <PromoteCandidateButton
                    candidate={candidate as CandidateView & { status: string }}
                    onSuccess={() => {
                      toast.success("Berhasil dipromosikan menjadi karyawan!");
                      detailQuery.refetch();
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Profil kandidat ── */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-800">
              <User className="size-4 text-gray-400" /> Profil Kandidat
            </h3>
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <InfoField icon={Mail} label="Email" value={candidate.email} />
              <InfoField icon={Phone} label="Telepon" value={candidate.phone} />
              <InfoField icon={MapPin} label="Domisili" value={candidate.domicile} />
              <InfoField
                icon={Calendar}
                label="Tanggal Lahir"
                value={
                  candidate.date_of_birth
                    ? new Date(candidate.date_of_birth).toLocaleDateString("id-ID")
                    : null
                }
              />
              <InfoField
                icon={GraduationCap}
                label="Pendidikan Terakhir"
                value={(candidate as { last_education?: string | null }).last_education}
              />
              <InfoField
                icon={Briefcase}
                label="Pengalaman Terakhir"
                value={(candidate as { last_experience?: string | null }).last_experience}
              />
              <InfoField
                icon={Wallet}
                label="Ekspektasi Gaji"
                value={
                  (candidate as { expected_salary?: number | null }).expected_salary
                    ? `Rp ${new Intl.NumberFormat("id-ID").format(
                        (candidate as { expected_salary?: number | null })
                          .expected_salary as number
                      )}`
                    : null
                }
              />
              <InfoField
                icon={Clock}
                label="Ketersediaan"
                value={
                  AVAILABILITY_LABELS[
                    (candidate as { availability?: string | null }).availability ?? ""
                  ]
                }
              />
            </div>
          </div>
        </div>

        {/* ── Kanan: AI, dokumen, timeline ── */}
        <div className="space-y-5">
          {/* AI summary */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
              <Bot className="size-4 text-sky-500" /> Ringkasan AI
            </h3>
            {analysisQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="size-4 animate-spin" /> Memuat…
              </div>
            ) : analysis ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex size-14 shrink-0 items-center justify-center rounded-full text-lg font-bold ring-4 ${scoreColor(analysis.match_score ?? 0)}`}
                  >
                    {analysis.match_score ?? "?"}
                  </div>
                  <p className="text-xs leading-relaxed text-gray-500">
                    {analysis.match_reason}
                  </p>
                </div>
                {analysis.summary && (
                  <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900">
                    {analysis.summary}
                  </p>
                )}
                <p className="text-[10px] text-gray-400">
                  {analysis.model} ·{" "}
                  {new Date(analysis.updated_at).toLocaleString("id-ID", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                Belum dianalisis.{" "}
                {status === "applied"
                  ? "Jalankan dari panel Applied di sebelah kiri."
                  : "Analisis dilakukan di tahap Applied."}
              </p>
            )}
          </div>

          {/* Dokumen */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
              <FileText className="size-4 text-gray-400" /> Dokumen
            </h3>
            {candidate.cv_url ? (
              <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="size-7 shrink-0 text-red-500" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">CV / Resume</p>
                    <p className="text-xs text-gray-500">
                      {candidate.cv_url.split(".").pop()?.toUpperCase()}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={handleDownloadCV}>
                  <Download className="size-4" />
                </Button>
              </div>
            ) : (
              <p className="text-sm text-gray-400">CV belum diupload.</p>
            )}
          </div>

          {/* Timeline: tab Catatan HR vs Aktivitas pipeline */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
              <MessageSquare className="size-4 text-gray-400" /> Timeline
            </h3>
            <Tabs defaultValue="catatan" className="w-full flex-col">
              <TabsList className="grid h-9 w-full grid-cols-2">
                <TabsTrigger value="catatan">
                  Catatan{noteEntries.length > 0 ? ` (${noteEntries.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="aktivitas">
                  Aktivitas{activityEntries.length > 0 ? ` (${activityEntries.length})` : ""}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="catatan" className="mt-3">
                <Textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Tulis catatan internal…"
                  rows={2}
                  className="w-full text-sm"
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    onClick={handleAddNote}
                    disabled={addNoteMutation.isPending || !noteDraft.trim()}
                  >
                    {addNoteMutation.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    Tambah Catatan
                  </Button>
                </div>
                <TimelineList
                  entries={noteEntries}
                  emptyText="Belum ada catatan. Catatan pertama akan memulai timeline."
                />
              </TabsContent>

              <TabsContent value="aktivitas" className="mt-3">
                <TimelineList
                  entries={activityEntries}
                  emptyText="Belum ada aktivitas pipeline."
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Edit Dialog - Placeholder */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Data Kandidat</DialogTitle>
            <DialogDescription>
              Update informasi kandidat {candidate.full_name}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-8 text-center text-gray-500">
            <Edit3 className="mx-auto mb-4 h-12 w-12 opacity-30" />
            <p>Form edit kandidat akan diimplementasikan selanjutnya</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
