import { NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne, query } from "@/lib/db";
import { extractCvText } from "@/lib/recruitment/cv-extract";
import {
  analyzeCvWithDeepseek,
  DeepseekNotConfiguredError,
} from "@/lib/recruitment/deepseek";

/**
 * GET  /api/candidates/[id]/ai-analysis — hasil analisis tersimpan (null jika belum ada).
 * POST /api/candidates/[id]/ai-analysis — jalankan (ulang) ekstraksi CV + analisis DeepSeek.
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ALLOWED_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { id } = await params;
    const row = await queryOne(
      `SELECT id, candidate_id, extracted, summary, match_score, match_reason,
              job_context, model, created_at, updated_at
         FROM recruitment.candidate_ai_analysis
        WHERE candidate_id = $1`,
      [id]
    );
    return NextResponse.json({ data: row ?? null });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[ai-analysis] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(_req: Request, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { id } = await params;

    const candidate = await queryOne<{
      id: string;
      cv_url: string | null;
      position_id: string | null;
      job_opening_id: string | null;
    }>(
      `SELECT id, cv_url, position_id, job_opening_id
         FROM recruitment.candidates WHERE id = $1`,
      [id]
    );
    if (!candidate) {
      return NextResponse.json({ error: "Kandidat tidak ditemukan" }, { status: 404 });
    }
    if (!candidate.cv_url) {
      return NextResponse.json(
        { error: "Kandidat belum memiliki lampiran CV" },
        { status: 400 }
      );
    }

    // ── konteks pekerjaan: job_opening (paling lengkap) → fallback positions ──
    let jobContext: string | null = null;
    if (candidate.job_opening_id) {
      const job = await queryOne<{ title: string; description: string | null; requirements: string | null }>(
        `SELECT title, description, requirements FROM hris.job_openings WHERE id = $1`,
        [candidate.job_opening_id]
      );
      if (job) {
        jobContext = [
          `Posisi: ${job.title}`,
          job.description ? `Deskripsi: ${job.description}` : null,
          job.requirements ? `Persyaratan: ${job.requirements}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      }
    }
    if (!jobContext && candidate.position_id) {
      const pos = await queryOne<{ title: string; department: string | null; level: string | null }>(
        `SELECT title, department, level FROM hris.positions WHERE id = $1`,
        [candidate.position_id]
      );
      if (pos) {
        jobContext = `Posisi: ${pos.title}${pos.department ? ` — Departemen ${pos.department}` : ""}${pos.level ? ` (level ${pos.level})` : ""}`;
      }
    }

    // ── ekstraksi teks CV (pdf/docx/ocr) ──
    const { text: cvText, method } = await extractCvText(candidate.cv_url);

    // ── analisis DeepSeek ──
    const { result, model } = await analyzeCvWithDeepseek(cvText, jobContext);

    const extracted = {
      nama: result.nama,
      email: result.email,
      no_hp: result.no_hp,
      sumber: result.sumber,
      pendidikan: result.pendidikan,
      pengalaman: result.pengalaman,
      metode_ekstraksi: method,
    };

    const rows = await query(
      `INSERT INTO recruitment.candidate_ai_analysis
         (candidate_id, cv_text, extracted, summary, match_score, match_reason, job_context, model, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, now())
       ON CONFLICT (candidate_id) DO UPDATE SET
         cv_text = EXCLUDED.cv_text,
         extracted = EXCLUDED.extracted,
         summary = EXCLUDED.summary,
         match_score = EXCLUDED.match_score,
         match_reason = EXCLUDED.match_reason,
         job_context = EXCLUDED.job_context,
         model = EXCLUDED.model,
         updated_at = now()
       RETURNING id, candidate_id, extracted, summary, match_score, match_reason,
                 job_context, model, created_at, updated_at`,
      [
        id,
        cvText,
        JSON.stringify(extracted),
        result.ringkasan,
        result.skor_kecocokan,
        result.alasan_kecocokan,
        jobContext,
        model,
      ]
    );

    return NextResponse.json({
      data: rows[0],
      message: "Analisis CV selesai",
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof DeepseekNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const msg = error instanceof Error ? error.message : "Internal server error";
    console.error("[ai-analysis] POST failed:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
