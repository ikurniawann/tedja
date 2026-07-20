import { NextResponse } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { getStallAccess } from "@/lib/auth/stall-access";

/**
 * Daftar stall yang boleh dipilih user di switcher sidebar, berbasis
 * penempatan (user_warehouses). all_access=false berarti "Semua Stall"
 * tidak tersedia dan pilihan terbatas ke stall penempatan.
 */
export async function GET() {
  try {
    const user = await requireApiRole(["super_admin", "admin"]);
    const scope = await getApiUserScope();
    const access = await getStallAccess(user.id, user.role, scope?.branchId ?? null);

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
