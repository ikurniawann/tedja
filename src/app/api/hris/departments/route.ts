// ============================================================
// API Route: Departments (daftar ringkas untuk selektor)
// GET — daftar departemen aktif (id, name, code). Dipakai a.l. selektor
//       target pengumuman & filter lain. Butuh login.
// ============================================================

import { NextResponse } from "next/server";
import { ApiError, requireApiUser } from "@/lib/api/auth";
import { query } from "@/lib/db";

export async function GET() {
  try {
    await requireApiUser();
    const rows = await query(
      `SELECT id, name, code, parent_department_id
       FROM hris.departments
       ORDER BY name ASC`
    );
    return NextResponse.json({ data: rows });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error listing departments:", error);
    return NextResponse.json({ error: "Gagal mengambil departemen" }, { status: 500 });
  }
}
