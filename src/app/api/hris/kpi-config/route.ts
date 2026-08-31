import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { KPI_MANAGE_ROLES, KPI_SCORECARD_ROLES } from "@/lib/kpi/roles";
import { query, withTransaction } from "@/lib/db";

/**
 * Konfigurasi KPI per peran (permintaan owner 2026-08-30): HRD menceklis
 * indikator mana yang MEMPENGARUHI KPI tiap peran + bobotnya — mis. absen
 * dihitung untuk kasir tapi tidak untuk HRD. Sumber kebenaran perhitungan
 * tetap performance.kpi_role_indicators; halaman ini editornya.
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
    const [indicators, mappings] = await Promise.all([
      query(
        `SELECT id, code, name, description, unit, direction, default_target
         FROM performance.kpi_indicators WHERE is_active = true ORDER BY name`
      ),
      query(
        `SELECT role_code, indicator_id, weight, updated_by, updated_at
         FROM performance.kpi_role_indicators`
      ),
    ]);
    return NextResponse.json({
      data: { roles: KPI_SCORECARD_ROLES, indicators, mappings },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[kpi-config] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface PutBody {
  role_code?: string;
  items?: { indicator_id?: string; enabled?: boolean; weight?: number }[];
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireKpiManager();
    const editorName = user.full_name || "Pengelola KPI";

    const body = (await req.json()) as PutBody;
    const roleCode = String(body.role_code || "");
    if (!(KPI_SCORECARD_ROLES as readonly string[]).includes(roleCode)) {
      return NextResponse.json({ error: "Peran tidak dikenal" }, { status: 400 });
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
        { error: "Minimal satu indikator harus aktif untuk peran ini" },
        { status: 400 }
      );
    }

    await withTransaction(async (client) => {
      // Konfigurasi peran ditulis utuh: yang tidak tercentang dihapus dari
      // mapping (indikator itu berhenti mempengaruhi KPI peran tsb).
      await client.query(
        `DELETE FROM performance.kpi_role_indicators WHERE role_code = $1`,
        [roleCode]
      );
      for (const item of enabled) {
        await client.query(
          `INSERT INTO performance.kpi_role_indicators
             (role_code, indicator_id, weight, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, now())`,
          [roleCode, item.indicator_id, Number(item.weight), editorName]
        );
      }
    });

    return NextResponse.json({
      message: `Konfigurasi KPI peran ${roleCode} disimpan — berlaku mulai snapshot bulan berikutnya`,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[kpi-config] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
