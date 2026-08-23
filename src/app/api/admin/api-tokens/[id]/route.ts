import { NextRequest, NextResponse } from "next/server";
import { requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getSessionUserFromCookies } from "@/lib/auth/session";
import { query } from "@/lib/db";
import { isApiTokenSession } from "@/lib/auth/api-token";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Terjadi kesalahan";
}

/** EPIC-042: cabut token (soft revoke — jejak audit tetap utuh). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sessionUser = await getSessionUserFromCookies();
    if (isApiTokenSession(sessionUser)) {
      return NextResponse.json(
        { success: false, error: "Kelola token hanya lewat login dashboard, bukan token" },
        { status: 403 }
      );
    }
    await requireIamMenuPrefix(IAM.settingsIntegrations);

    const { id } = await params;
    const rows = await query(
      `UPDATE configuration.api_tokens
       SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING id, name`,
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Token tidak ditemukan atau sudah dicabut" },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error) {
    const status = (error as { status?: number })?.status ?? 500;
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status }
    );
  }
}
