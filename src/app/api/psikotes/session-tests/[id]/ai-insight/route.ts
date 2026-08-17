import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { readPrivateFile } from "@/lib/storage-private";
import {
  analyzeDrawingObservation,
  describeDrawingImage,
  OpenAiNotConfiguredError,
} from "@/lib/recruitment/psikotes-ai";
import { DeepseekNotConfiguredError } from "@/lib/recruitment/deepseek";

/**
 * POST /api/psikotes/session-tests/[id]/ai-insight — minta insight AI utk
 * tes gambar Baum/DAP/Wartegg. Dua mode:
 * - observation diisi  → mode manual (observasi HR → insight DeepSeek);
 * - observation kosong → mode otomatis: gambar dibaca OpenAI vision jadi
 *   deskripsi objektif, lalu deskripsi itu diinsight-kan DeepSeek
 *   (DeepSeek text-only, tidak bisa menerima gambar langsung).
 * Hasil = bahan pertimbangan indikatif, BUKAN keputusan final; di-cache
 * di kolom ai_insight dan bisa digenerate ulang.
 */

const ALLOWED_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  observation: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .min(20, "Tulis observasi gambar minimal 20 karakter, atau kosongkan agar AI membaca gambarnya")
        .max(4000, "Observasi maksimal 4000 karakter"),
    ])
    .optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID tes tidak valid" }, { status: 400 });
    }
    // panggilan LLM mahal — batasi lebih ketat dari default
    if (!checkRateLimit(`psikotes_ai_insight_${user.id}`, 10).allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan analisis, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: first?.message ?? "Payload tidak valid" },
        { status: 400 }
      );
    }

    const test = await queryOne<{
      id: string;
      status: string;
      attachment_path: string | null;
      instrument_code: string;
      instrument_name: string;
      instrument_kind: string;
      position_title: string | null;
    }>(
      `SELECT t.id, t.status, t.attachment_path,
              i.code AS instrument_code, i.name AS instrument_name,
              i.kind AS instrument_kind, p.title AS position_title
       FROM recruitment.psikotes_session_tests t
       JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
       JOIN recruitment.psikotes_sessions s ON s.id = t.session_id
       JOIN recruitment.candidates c ON c.id = s.candidate_id
       LEFT JOIN hris.positions p ON p.id = c.position_id
       WHERE t.id = $1`,
      [id]
    );
    if (!test) {
      return NextResponse.json({ error: "Tes tidak ditemukan" }, { status: 404 });
    }
    if (test.instrument_kind !== "drawing") {
      return NextResponse.json(
        { error: "Insight AI hanya untuk tes gambar (Baum/DAP/Wartegg)" },
        { status: 400 }
      );
    }
    if (test.status !== "perlu_review" && test.status !== "reviewed") {
      return NextResponse.json(
        { error: "Tes belum selesai dikerjakan kandidat" },
        { status: 409 }
      );
    }

    let observation = parsed.data.observation?.trim() ?? "";
    let observationSource: "manual" | "ai" = "manual";
    let visionModel: string | null = null;

    if (!observation) {
      // Mode otomatis: OpenAI vision membaca gambar → deskripsi objektif.
      if (!test.attachment_path) {
        return NextResponse.json(
          { error: "Tes ini tidak punya gambar terunggah — tulis observasi manual" },
          { status: 400 }
        );
      }
      const { data, mime } = await readPrivateFile(test.attachment_path);
      if (!data) {
        return NextResponse.json(
          { error: "Berkas gambar tidak ditemukan di storage — tulis observasi manual" },
          { status: 404 }
        );
      }
      const described = await describeDrawingImage({
        instrumentCode: test.instrument_code,
        instrumentName: test.instrument_name,
        imageBase64: data.toString("base64"),
        imageMime: mime ?? "image/png",
      });
      observation = described.observation.slice(0, 4000);
      observationSource = "ai";
      visionModel = described.model;
    }

    const { result, model } = await analyzeDrawingObservation({
      instrumentCode: test.instrument_code,
      instrumentName: test.instrument_name,
      observation,
      positionTitle: test.position_title,
    });

    const aiInsight = {
      observation,
      observation_source: observationSource,
      vision_model: visionModel,
      insight: result,
      model,
      created_at: new Date().toISOString(),
      created_by_name: user.full_name,
    };

    await queryOne(
      `UPDATE recruitment.psikotes_session_tests SET ai_insight = $2::jsonb
       WHERE id = $1 RETURNING id`,
      [id, JSON.stringify(aiInsight)]
    );

    return NextResponse.json({ data: aiInsight, message: "Insight AI dibuat" });
  } catch (error) {
    if (error instanceof DeepseekNotConfiguredError || error instanceof OpenAiNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ApiError) return error.toResponse();
    console.error("[psikotes-ai-insight] POST failed:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
