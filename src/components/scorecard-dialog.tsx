"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Star } from "lucide-react";
import type { Interview, Scorecard, InterviewRecommendation, CandidateStatus } from "@/types";

// ─── Position Category Detection ──────────────────────────────────────────────

type PositionCategory = "kitchen" | "service" | "management" | "general";

function inferPositionCategory(positionTitle: string | undefined): PositionCategory {
  if (!positionTitle) return "general";
  const lower = positionTitle.toLowerCase();
  if (lower.includes("chef") || lower.includes("kitchen")) return "kitchen";
  if (lower.includes("server") || lower.includes("barista") || lower.includes("kasir")) return "service";
  if (lower.includes("manager") || lower.includes("supervisor")) return "management";
  return "general";
}

// ─── Criteria Definitions ─────────────────────────────────────────────────────

interface Criterion {
  key: string;
  label: string;
  desc: string;
}

const KITCHEN_CRITERIA: Criterion[] = [
  { key: "pengalaman_memasak", label: "Pengalaman Memasak", desc: "Pengalaman & skill memasak" },
  { key: "food_hygiene", label: "Food Hygiene", desc: "Kebersihan & keamanan pangan" },
  { key: "kecepatan_efisiensi", label: "Kecepatan & Efisiensi", desc: "Kecepatan dan efisiensi kerja" },
  { key: "kemampuan_resep", label: "Kemampuan Resep", desc: "Pengetahuan & kreativitas resep" },
  { key: "attitude_teamwork", label: "Attitude & Teamwork", desc: "Sikap & kerja tim" },
];

const SERVICE_CRITERIA: Criterion[] = [
  { key: "kemampuan_komunikasi", label: "Kemampuan Komunikasi", desc: "Kemampuan berkomunikasi" },
  { key: "penampilan_grooming", label: "Penampilan & Grooming", desc: "Presentasi diri & kerapihan" },
  { key: "pengetahuan_produk", label: "Pengetahuan Produk", desc: "Pengetahuan produk/layanan" },
  { key: "kecepatan_pelayanan", label: "Kecepatan Pelayanan", desc: "Kecepatan & kualitas layanan" },
  { key: "attitude_customer_service", label: "Attitude Customer Service", desc: "Sikap & pelayanan prima" },
];

const MANAGEMENT_CRITERIA: Criterion[] = [
  { key: "pengalaman_managerial", label: "Pengalaman Managerial", desc: "Pengalaman mengelola tim" },
  { key: "problem_solving", label: "Problem Solving", desc: "Kemampuan solve masalah" },
  { key: "leadership_komunikasi", label: "Leadership & Komunikasi", desc: "Kepemimpinan & komunikasi" },
  { key: "pemahaman_operasional", label: "Pemahaman Operasional", desc: "Pengetahuan operasional outlet" },
  { key: "target_performance", label: "Target & Performance", desc: "Orientasi target & kinerja" },
];

const GENERAL_CRITERIA: Criterion[] = [
  { key: "technical_skills", label: "Technical Skills", desc: "Pengetahuan & skill teknis relevan" },
  { key: "communication", label: "Komunikasi", desc: "Kemampuan berkomunikasi" },
  { key: "attitude", label: "Attitude / Sikap", desc: "Sikap & etika kerja" },
  { key: "appearance", label: "Penampilan", desc: "Presentasi diri" },
  { key: "experience", label: "Pengalaman", desc: "Relevansi pengalaman kerja" },
  { key: "culture_fit", label: "Culture Fit", desc: "Kecocokan dengan budaya perusahaan" },
];

function getCriteria(category: PositionCategory): Criterion[] {
  switch (category) {
    case "kitchen": return KITCHEN_CRITERIA;
    case "service": return SERVICE_CRITERIA;
    case "management": return MANAGEMENT_CRITERIA;
    default: return GENERAL_CRITERIA;
  }
}

function getCategoryLabel(category: PositionCategory): string {
  switch (category) {
    case "kitchen": return "Dapur";
    case "service": return "Service";
    case "management": return "Management";
    default: return "Umum";
  }
}

// ─── Recommendations ───────────────────────────────────────────────────────────

const RECOMMENDATIONS: { value: InterviewRecommendation; label: string; color: string }[] = [
  { value: "proceed", label: "Lanjut ke tahap berikutnya", color: "text-emerald-600" },
  { value: "pool", label: "Masukkan Talent Pool", color: "text-yellow-600" },
  { value: "reject", label: "Ditolak", color: "text-red-600" },
];

// ─── Form Type ───────────────────────────────────────────────────────────────

// Dynamic keys for the criteria
type ScorecardFormValues = {
  [key: string]: number | string | InterviewRecommendation | undefined;
  overall_score: number;
  notes: string;
  recommendation: InterviewRecommendation;
};

// ─── Star Rating Component ────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (val: number) => void;
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((score) => (
        <button
          key={score}
          type="button"
          onClick={() => onChange(score)}
          className="p-0.5 hover:scale-110 transition-transform"
        >
          <Star
            className={`w-5 h-5 ${
              score <= value
                ? "fill-yellow-400 text-yellow-400"
                : "text-gray-300"
            }`}
          />
        </button>
      ))}
      <span className="ml-2 text-sm text-gray-500 self-center">{value}/5</span>
    </div>
  );
}

// ─── Dialog Props ─────────────────────────────────────────────────────────────

interface ScorecardDialogProps {
  interview: Interview | null;
  positionTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

// ─── Main Dialog ──────────────────────────────────────────────────────────────

export default function ScorecardDialog({
  interview,
  positionTitle,
  open,
  onOpenChange,
  onSaved,
}: ScorecardDialogProps) {
  const [saving, setSaving] = useState(false);

  const category = inferPositionCategory(positionTitle);
  const criteria = getCriteria(category);

  // Build dynamic default values from criteria keys
  const buildDefaultValues = (existing?: Scorecard | null): ScorecardFormValues => {
    const defaults: ScorecardFormValues = {
      overall_score: 0,
      notes: "",
      recommendation: "proceed",
    };
    for (const c of criteria) {
      (defaults as Record<string, unknown>)[c.key] = existing?.[c.key] ?? 0;
    }
    if (existing) {
      defaults.overall_score = existing.overall_score ?? 0;
      defaults.notes = existing.notes ?? "";
    }
    if (interview?.recommendation) {
      defaults.recommendation = interview.recommendation;
    }
    return defaults;
  };

  const form = useForm<ScorecardFormValues>({
    defaultValues: buildDefaultValues(),
  });

  // Reset form when dialog opens with new interview
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen && interview) {
      form.reset(buildDefaultValues(interview.scorecard));
    }
    onOpenChange(newOpen);
  };

  const onSubmit = async (values: ScorecardFormValues) => {
    if (!interview) return;

    setSaving(true);

    const { createBrowserClient } = await import("@/lib/pg/browser-client");
    const db = createBrowserClient();

    // Build scorecard from form values
    const scorecard: Scorecard = { notes: values.notes, overall_score: values.overall_score };
    for (const c of criteria) {
      scorecard[c.key] = (values as Record<string, unknown>)[c.key] as number;
    }

    // Determine new candidate status based on recommendation
    let newStatus: CandidateStatus | null = null;
    if (values.recommendation === "proceed") {
      newStatus = "offer";
    } else if (values.recommendation === "pool") {
      newStatus = "talent_pool";
    } else if (values.recommendation === "reject") {
      newStatus = "rejected";
    }

    // 1. Update interview with scorecard + recommendation
    await db
      .from("interviews")
      .update({
        scorecard,
        recommendation: values.recommendation,
      })
      .eq("id", interview.id);

    // 2. Update candidate status if applicable
    if (newStatus) {
      await db
        .from("candidates")
        .update({ status: newStatus })
        .eq("id", interview.candidate_id);
    }

    // 3. Insert activity log entry
    const logDetails: Record<string, unknown> = {
      interview_id: interview.id,
      recommendation: values.recommendation,
      scorecard,
    };
    if (newStatus) logDetails.new_status = newStatus;

    await db.from("activity_logs").insert({
      candidate_id: interview.candidate_id,
      action: `scorecard_submitted_${values.recommendation}`,
      details: logDetails,
    });

    setSaving(false);
    onOpenChange(false);
    onSaved();
  };

  if (!interview) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Interview Scorecard</DialogTitle>
          <DialogDescription>
            {interview.type === "hrd" ? "Interview HRD" : "Interview Manager"} &mdash;{" "}
            <span className="font-medium">{getCategoryLabel(category)}</span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          {/* Criteria Ratings */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">Penilaian Kriteria</h3>
            {criteria.map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-800">{c.label}</p>
                  <p className="text-xs text-gray-500">{c.desc}</p>
                </div>
                <StarRating
                  value={(form.watch(c.key) as number) ?? 0}
                  onChange={(val) => form.setValue(c.key, val, { shouldValidate: true })}
                />
              </div>
            ))}
          </div>

          {/* Overall Score */}
          <div className="flex items-start justify-between gap-4 p-4 bg-blue-50 rounded-lg">
            <div className="flex-1">
              <p className="text-sm font-semibold text-blue-800">Overall Score</p>
              <p className="text-xs text-blue-600">Rata-rata penilaian keseluruhan</p>
            </div>
            <StarRating
              value={form.watch("overall_score")}
              onChange={(val) => form.setValue("overall_score", val, { shouldValidate: true })}
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Catatan Interview</Label>
            <Textarea
              placeholder="Catatan tambahan dari interview..."
              rows={3}
              {...form.register("notes")}
            />
          </div>

          {/* Recommendation */}
          <div className="space-y-1.5">
            <Label>
              Rekomendasi <span className="text-red-500">*</span>
            </Label>
            <Select
              value={form.watch("recommendation")}
              onValueChange={(v) => form.setValue("recommendation", v as InterviewRecommendation)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECOMMENDATIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    <span className={r.color}>{r.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status preview */}
          {(() => {
            const rec = form.watch("recommendation");
            const previewStatus: Record<string, string> = {
              proceed: interview.type === "hrd" ? "→ Interview Manager" : "→ Diterima (Hired)",
              pool: "→ Talent Pool",
              reject: "→ Ditolak",
            };
            return (
              <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600">
                Setelah disimpan, status kandidat akan berubah ke:{" "}
                <span className="font-medium">{previewStatus[rec] ?? "-"}</span>
              </div>
            );
          })()}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              disabled={
                saving ||
                criteria.some((c) => (form.watch(c.key) as number) === 0) ||
                form.watch("overall_score") === 0
              }
            >
              {saving ? "Menyimpan..." : "Simpan Scorecard"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
