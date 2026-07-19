import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { KPI_MANAGE_ROLES } from "@/lib/kpi/roles";
import { buildWaLink } from "@/lib/recruitment/wa";

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/**
 * GET /api/hris/kpi/scorecards?period_year&period_month&employee_id
 * HR (isHr) melihat semua; role lain hanya scorecard MILIKNYA sendiri
 * (enforcement server-side, pola payslips).
 * EPIC-010 Fase B (verifikasi data; UI penuh menyusul Fase C).
 */
export async function GET(request: NextRequest) {
  const actor = await getWorkforceActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await createServerPgClient();
  const { searchParams } = new URL(request.url);

  const now = new Date();
  const periodYear = Number(searchParams.get("period_year")) || now.getFullYear();
  const periodMonth =
    Number(searchParams.get("period_month")) || now.getMonth() + 1;

  // Peta label indikator utk render breakdown di klien
  const { data: indicators } = await db
    .from("kpi_indicators")
    .select("id, code, name, unit, direction")
    .eq("is_active", true);

  // Mode TIM (Fase E): atasan langsung melihat scorecard bawahannya
  // (employees.reporting_to = employee penilai) — MSS, bukan HR-only.
  if (searchParams.get("team") === "1") {
    if (!actor.employeeId) return NextResponse.json({ data: [], indicators });
    const { data: reports } = await db
      .from("employees")
      .select("id")
      .eq("reporting_to", actor.employeeId)
      .eq("is_active", true);
    const reportIds = (reports ?? []).map((row: { id: string }) => row.id);
    if (reportIds.length === 0) {
      return NextResponse.json({ data: [], indicators });
    }

    const { data, error } = await db
      .from("kpi_scorecards")
      .select(
        `*, employee:employees ( id, full_name, nip, department_id,
          department:departments ( name ) )`
      )
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth)
      .in("employee_id", reportIds)
      .order("score", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) {
      console.error("Error fetching team scorecards:", error);
      return NextResponse.json(
        { error: "Gagal mengambil scorecard tim" },
        { status: 500 }
      );
    }
    return NextResponse.json({
      data,
      indicators,
      period_year: periodYear,
      period_month: periodMonth,
    });
  }

  const requestedEmployee = searchParams.get("employee_id");
  let employeeFilter: string | null = null;
  if (!actor.isHr) {
    if (!actor.employeeId) return NextResponse.json({ data: [] });
    employeeFilter = actor.employeeId; // non-HR dikunci ke dirinya
  } else if (requestedEmployee && requestedEmployee !== "me") {
    employeeFilter = requestedEmployee;
  } else if (requestedEmployee === "me") {
    employeeFilter = actor.employeeId;
  }

  // Mode riwayat: N scorecard terakhir SATU karyawan (utk ESS/riwayat HRD)
  const historyN = Number(searchParams.get("history")) || 0;
  if (historyN > 0) {
    // Akun tanpa record karyawan (mis. super_admin) minta riwayat dirinya →
    // kosong yang ramah, bukan error.
    if (!employeeFilter && requestedEmployee === "me") {
      return NextResponse.json({ data: [], indicators });
    }
    if (!employeeFilter) {
      return NextResponse.json(
        { error: "history membutuhkan employee_id" },
        { status: 400 }
      );
    }
    const { data, error } = await db
      .from("kpi_scorecards")
      .select("*")
      .eq("employee_id", employeeFilter)
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false })
      .limit(Math.min(24, historyN));
    if (error) {
      console.error("Error fetching KPI history:", error);
      return NextResponse.json(
        { error: "Gagal mengambil riwayat scorecard" },
        { status: 500 }
      );
    }
    return NextResponse.json({ data, indicators });
  }

  let query = db
    .from("kpi_scorecards")
    .select(
      `*, employee:employees ( id, full_name, nip, department_id,
        department:departments ( name ) )`
    )
    .eq("period_year", periodYear)
    .eq("period_month", periodMonth)
    .order("score", { ascending: false, nullsFirst: false })
    .limit(500);

  if (employeeFilter) query = query.eq("employee_id", employeeFilter);

  const { data, error } = await query;
  if (error) {
    console.error("Error fetching KPI scorecards:", error);
    return NextResponse.json(
      { error: "Gagal mengambil scorecard" },
      { status: 500 }
    );
  }
  return NextResponse.json({
    data,
    indicators,
    period_year: periodYear,
    period_month: periodMonth,
  });
}

/**
 * PATCH /api/hris/kpi/scorecards { action: 'finalize'|'reopen', scorecard_id }
 * Finalisasi mengunci scorecard (snapshot & skor beku); reopen membuka lagi.
 */
export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireApiRole([...KPI_MANAGE_ROLES]);
    const db = await createServerPgClient();
    const body = await request.json().catch(() => ({}));
    const { action, scorecard_id: scorecardId } = body;

    if (!scorecardId || (action !== "finalize" && action !== "reopen")) {
      return NextResponse.json(
        { error: "action (finalize|reopen) dan scorecard_id wajib" },
        { status: 400 }
      );
    }

    const { data: existing } = await db
      .from("kpi_scorecards")
      .select("id, status")
      .eq("id", scorecardId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Scorecard tidak ditemukan" }, { status: 404 });
    }

    if (action === "finalize" && existing.status !== "draft") {
      return NextResponse.json({ error: "Scorecard sudah final" }, { status: 409 });
    }
    if (action === "reopen" && existing.status !== "final") {
      return NextResponse.json({ error: "Scorecard masih draft" }, { status: 409 });
    }

    const patch =
      action === "finalize"
        ? {
            status: "final",
            reviewed_by: actor.id,
            reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
        : {
            status: "draft",
            reviewed_by: null,
            reviewed_at: null,
            updated_at: new Date().toISOString(),
          };

    const { data, error } = await db
      .from("kpi_scorecards")
      .update(patch)
      .eq("id", scorecardId)
      .select("*")
      .single();
    if (error) {
      console.error("Error updating scorecard status:", error);
      return NextResponse.json(
        { error: "Gagal mengubah status scorecard" },
        { status: 500 }
      );
    }

    // Fase E: saat FINAL, siapkan link WhatsApp pemberitahuan skor
    // (pola wa.me dibuka UI — konsisten notifikasi slip gaji & cuti).
    let waLink: string | null = null;
    if (action === "finalize" && data) {
      const { data: employee } = await db
        .from("employees")
        .select("full_name, phone")
        .eq("id", data.employee_id)
        .maybeSingle();
      const periodLabel = `${MONTH_NAMES[(data.period_month ?? 1) - 1]} ${data.period_year}`;
      const scoreText =
        data.score === null ? "belum ada data" : Number(data.score).toLocaleString("id-ID");
      waLink = buildWaLink(
        employee?.phone,
        `Halo ${employee?.full_name}, skor KPI Anda periode ${periodLabel} sudah FINAL: ${scoreText}. ` +
          `Lihat rinciannya di portal karyawan: menu Area Karyawan → KPI Saya.`
      );
    }

    return NextResponse.json({
      data,
      wa_link: waLink,
      message: action === "finalize" ? "Scorecard difinalkan" : "Scorecard dibuka kembali",
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error in scorecards PATCH:", error);
    return NextResponse.json(
      { error: "Terjadi kesalahan pada server" },
      { status: 500 }
    );
  }
}
