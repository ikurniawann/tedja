import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { KPI_MANAGE_ROLES } from "@/lib/kpi/roles";

/**
 * Target KPI (EPIC-010 Fase D). Scope: employee > department > role > umum;
 * periode opsional (bulan-eksak / tahun / berlaku umum).
 * Semua method khusus KPI_MANAGE_ROLES.
 */

export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformance);
    const db = await createServerPgClient();
    const { data, error } = await db
      .from("kpi_targets")
      .select(
        `*, indicator:kpi_indicators ( code, name, unit, direction ),
         department:departments ( id, name ),
         employee:employees ( id, full_name, nip )`
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching KPI targets:", error);
    return NextResponse.json({ error: "Gagal mengambil target" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireIamMenuPrefix(IAM.hrisPerformance);
    const db = await createServerPgClient();
    const body = await request.json().catch(() => ({}));

    const indicatorId = body.indicator_id;
    const target = Number(body.target);
    if (!indicatorId || !Number.isFinite(target) || target < 0) {
      return NextResponse.json(
        { error: "indicator_id dan target (angka ≥ 0) wajib" },
        { status: 400 }
      );
    }

    const periodYear =
      body.period_year == null ? null : Number(body.period_year);
    const periodMonth =
      body.period_month == null ? null : Number(body.period_month);
    if (
      (periodYear !== null && !Number.isInteger(periodYear)) ||
      (periodMonth !== null &&
        (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12))
    ) {
      return NextResponse.json({ error: "Periode tidak valid" }, { status: 400 });
    }

    // Scope eksklusif: paling banyak satu dari role/department/employee.
    const scopes = [body.role_code, body.department_id, body.employee_id].filter(
      Boolean
    );
    if (scopes.length > 1) {
      return NextResponse.json(
        { error: "Pilih satu scope saja (role ATAU department ATAU karyawan)" },
        { status: 400 }
      );
    }

    const { data, error } = await db
      .from("kpi_targets")
      .insert({
        indicator_id: indicatorId,
        period_year: periodYear,
        period_month: periodMonth,
        role_code: body.role_code || null,
        department_id: body.department_id || null,
        employee_id: body.employee_id || null,
        target,
        created_by: actor.id,
      })
      .select("*")
      .single();
    if (error) {
      // FK tidak valid (indikator/dept/karyawan tak ada) → 400 yang jelas
      if (error.code === "23503") {
        return NextResponse.json(
          { error: "Indikator/department/karyawan tidak ditemukan" },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { data, message: "Target tersimpan" },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error creating KPI target:", error);
    return NextResponse.json({ error: "Gagal menyimpan target" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformance);
    const db = await createServerPgClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });

    const { error } = await db.from("kpi_targets").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ message: "Target dihapus" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error deleting KPI target:", error);
    return NextResponse.json({ error: "Gagal menghapus target" }, { status: 500 });
  }
}
