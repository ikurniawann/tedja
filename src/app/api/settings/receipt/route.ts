import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";
import {
  RECEIPT_SETTINGS_GLOBAL_ID,
  loadPosReceiptSettingsRows,
  normalizeReceiptLines,
  normalizeReceiptSettings,
} from "@/lib/pos/receipt-settings";

function apiErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Internal server error";
}

/**
 * GET /api/settings/receipt — semua baris konfigurasi struk aktif
 * (global + per-branch + per-warehouse), untuk UI Settings → Business.
 * EPIC-040.
 */
export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.settingsBusiness);
    const db = createPgClient();
    const rows = await loadPosReceiptSettingsRows(db);
    // Opsi scope untuk UI — di-query sendiri supaya halaman ini tidak
    // bergantung pada permission endpoint warehouse milik modul lain.
    const { data: stalls, error: stallsError } = await db
      .from("warehouses")
      .select("id, name, branch_id")
      .order("name", { ascending: true });
    if (stallsError) throw stallsError;
    return NextResponse.json({
      success: true,
      data: rows.map((row) => normalizeReceiptSettings(row)),
      stalls: stalls ?? [],
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[settings/receipt] GET failed:", error);
    return NextResponse.json(
      { success: false, error: apiErrorMessage(error) },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/settings/receipt — upsert satu scope.
 * Body: { warehouse_id?, branch_id?, header_lines, footer_lines, show_stall_name }.
 * Tanpa warehouse_id & branch_id = baris global. Baris disanitasi server-side
 * (jumlah & panjang dibatasi lebar kertas 80mm) — lihat normalizeReceiptLines.
 */
export async function PUT(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsBusiness);
    const body = await request.json().catch(() => ({}));

    const warehouseId =
      typeof body.warehouse_id === "string" && body.warehouse_id ? body.warehouse_id : null;
    const branchId =
      typeof body.branch_id === "string" && body.branch_id ? body.branch_id : null;
    if (warehouseId && !branchId) {
      return NextResponse.json(
        { success: false, error: "Scope warehouse membutuhkan branch_id" },
        { status: 400 }
      );
    }

    const headerLines = normalizeReceiptLines(body.header_lines);
    const footerLines = normalizeReceiptLines(body.footer_lines);
    const showStallName = body.show_stall_name !== false;

    const db = createPgClient();
    const { data: existingRows, error: findError } = await db
      .from("pos_receipt_settings")
      .select("id, branch_id, warehouse_id")
      .eq("is_active", true);
    if (findError) throw findError;

    const existing = ((existingRows as Array<Record<string, unknown>>) ?? []).find((row) =>
      warehouseId
        ? row.warehouse_id === warehouseId
        : branchId
          ? row.branch_id === branchId && !row.warehouse_id
          : !row.branch_id && !row.warehouse_id
    );

    const payload = {
      header_lines: JSON.stringify(headerLines),
      footer_lines: JSON.stringify(footerLines),
      show_stall_name: showStallName,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const { error } = await db
        .from("pos_receipt_settings")
        .update(payload)
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await db.from("pos_receipt_settings").insert({
        // Baris global memakai id tetap supaya seed migrasi & upsert konvergen.
        ...(warehouseId || branchId ? {} : { id: RECEIPT_SETTINGS_GLOBAL_ID }),
        branch_id: branchId,
        warehouse_id: warehouseId,
        is_active: true,
        ...payload,
      });
      if (error) throw error;
    }

    const rows = await loadPosReceiptSettingsRows(db);
    return NextResponse.json({
      success: true,
      data: rows.map((row) => normalizeReceiptSettings(row)),
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[settings/receipt] PUT failed:", error);
    return NextResponse.json(
      { success: false, error: apiErrorMessage(error) },
      { status: 500 }
    );
  }
}
