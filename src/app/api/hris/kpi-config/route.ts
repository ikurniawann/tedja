import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { KPI_MANAGE_ROLES } from "@/lib/kpi/roles";
import { query, withTransaction } from "@/lib/db";

/**
 * Konfigurasi KPI per DEPARTEMEN (owner 2026-08-31 — menggantikan versi
 * per-peran): HRD menceklis indikator mana yang mempengaruhi KPI tiap
 * departemen + bobotnya. Mesin snapshot mengutamakan pemetaan departemen
 * (performance.kpi_department_indicators); departemen yang belum
 * dikonfigurasi memakai pemetaan peran lama sebagai bawaan.
 *
 * Perubahan hanya mempengaruhi snapshot BERIKUTNYA — scorecard yang sudah
 * final tidak pernah dihitung ulang (jaminan lama tetap berlaku).
 */

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireKpiManager() {
  const user = await requireIamMenuPrefix(IAM.hris);
  if (!(KPI_MANAGE_ROLES as readonly string[]).includes(user.role)) {
    throw new ApiError(403, "Hanya pengelola KPI (HRD/admin) yang boleh mengubah konfigurasi");
  }
  return user;
}

export async function GET() {
  try {
    await requireKpiManager();
    const [departments, indicators, mappings] = await Promise.all([
      query(`SELECT id, name FROM hris.departments ORDER BY name`),
      query(
        `SELECT id, code, name, description, unit, direction, default_target
         FROM performance.kpi_indicators WHERE is_active = true ORDER BY name`
      ),
      query(
        `SELECT department_id, indicator_id, weight, updated_by, updated_at
         FROM performance.kpi_department_indicators`
      ),
    ]);
    return NextResponse.json({
      data: { departments, indicators, mappings },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[kpi-config] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface PutBody {
  department_id?: string;
  items?: { indicator_id?: string; enabled?: boolean; weight?: number }[];
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireKpiManager();
    const editorName = user.full_name || "Pengelola KPI";

    const body = (await req.json()) as PutBody;
    const departmentId = String(body.department_id || "");
    if (!uuidRe.test(departmentId)) {
      return NextResponse.json({ error: "Departemen tidak valid" }, { status: 400 });
    }
    const dept = await query<{ id: string; name: string }>(
      `SELECT id, name FROM hris.departments WHERE id = $1`,
      [departmentId]
    );
    if (dept.length === 0) {
      return NextResponse.json({ error: "Departemen tidak ditemukan" }, { status: 404 });
    }
    const items = body.items ?? [];
    for (const item of items) {
      if (!item.indicator_id || !uuidRe.test(item.indicator_id)) {
        return NextResponse.json({ error: "ID indikator tidak valid" }, { status: 400 });
      }
      if (item.enabled) {
        const w = Number(item.weight);
        if (!Number.isFinite(w) || w <= 0 || w > 100) {
          return NextResponse.json(
            { error: "Bobot indikator aktif harus 1–100" },
            { status: 400 }
          );
        }
      }
    }
    const enabled = items.filter((i) => i.enabled);
    if (enabled.length === 0) {
      return NextResponse.json(
        { error: "Minimal satu indikator harus aktif untuk departemen ini" },
        { status: 400 }
      );
    }

    await withTransaction(async (client) => {
      // Konfigurasi departemen ditulis utuh: yang tidak tercentang dihapus
      // (indikator itu berhenti mempengaruhi KPI departemen tsb).
      await client.query(
        `DELETE FROM performance.kpi_department_indicators WHERE department_id = $1`,
        [departmentId]
      );
      for (const item of enabled) {
        await client.query(
          `INSERT INTO performance.kpi_department_indicators
             (department_id, indicator_id, weight, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, now())`,
          [departmentId, item.indicator_id, Number(item.weight), editorName]
        );
      }
    });

    return NextResponse.json({
      message: `Konfigurasi KPI departemen ${dept[0].name} disimpan — berlaku mulai snapshot bulan berikutnya`,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[kpi-config] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
