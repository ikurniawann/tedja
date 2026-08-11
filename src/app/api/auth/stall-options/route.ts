import { NextResponse } from "next/server";
import { ApiError, requireApiUser } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { getStallAccess } from "@/lib/auth/stall-access";

/**
 * Daftar stall yang boleh dipilih user di switcher / kasir gate.
 * all_access=false → "Semua Stall" tidak tersedia; pilihan terbatas penempatan.
 */
export async function GET() {
  try {
    const user = await requireApiUser();
    const scope = await getApiUserScope();
    const access = await getStallAccess(user.id, user.role, scope?.branchId ?? null);
    const canSwitch =
      user.role === "super_admin" ||
      user.role === "admin" ||
      access.allAccess ||
      access.stalls.length > 1;
    if (!canSwitch) {
      throw ApiError.forbidden("Akun ini tidak perlu mengganti stall");
    }

    return NextResponse.json({
      success: true,
      data: {
        all_access: access.allAccess,
        stalls: access.stalls.map(({ id, name, code }) => ({ id, name, code })),
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const message = error instanceof Error ? error.message : "Failed to load stall options";
    console.error("[api/auth/stall-options] failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
