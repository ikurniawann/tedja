import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { requireCrmConfigRole, requireCrmInboxAgent } from "@/lib/crm/server";

/**
 * EPIC-012 Fase C — template balasan cepat.
 * Baca: semua agent inbox. Kelola (buat/hapus): super_admin.
 */

const templateSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(2000),
  is_active: z.boolean().default(true),
});

export async function GET() {
  const guard = await requireCrmInboxAgent();
  if (guard.error) return guard.error;

  try {
    const { rows } = await getPool().query(
      `SELECT id, title, body, is_active FROM crm.wa_reply_templates
        WHERE is_active ORDER BY title`
    );
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error("Error fetching WA templates:", error);
    return NextResponse.json(
      { success: false, error: "Gagal memuat template" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const forbidden = await requireCrmConfigRole();
  if (forbidden) return forbidden;

  try {
    const payload = templateSchema.parse(await request.json());
    const pool = getPool();

    if (payload.id) {
      const { rows } = await pool.query(
        `UPDATE crm.wa_reply_templates
            SET title = $2, body = $3, is_active = $4
          WHERE id = $1 RETURNING id, title, body, is_active`,
        [payload.id, payload.title, payload.body, payload.is_active]
      );
      if (rows.length === 0) {
        return NextResponse.json(
          { success: false, error: "Template tidak ditemukan" },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, data: rows[0] });
    }

    const { rows } = await pool.query(
      `INSERT INTO crm.wa_reply_templates (title, body, is_active)
       VALUES ($1, $2, $3) RETURNING id, title, body, is_active`,
      [payload.title, payload.body, payload.is_active]
    );
    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Payload tidak valid" },
        { status: 400 }
      );
    }
    console.error("Error saving WA template:", error);
    return NextResponse.json(
      { success: false, error: "Gagal menyimpan template" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const forbidden = await requireCrmConfigRole();
  if (forbidden) return forbidden;

  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { success: false, error: "Template id wajib diisi" },
        { status: 400 }
      );
    }

    await getPool().query(`DELETE FROM crm.wa_reply_templates WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting WA template:", error);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus template" },
      { status: 500 }
    );
  }
}
