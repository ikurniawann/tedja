import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { uploadFile } from "@/lib/storage";
import { requireTicketingContext } from "@/lib/ticketing/server";

const MAX_THUMBNAIL_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Unggah thumbnail ticket — gambar saja, maks 3 MB (pola foto member). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const { id } = await params;
    const product = await queryOne<{ id: string }>(
      `SELECT id FROM ticketing.ticket_products
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (!product) {
      return NextResponse.json(
        { success: false, error: "Ticket tidak ditemukan" },
        { status: 404 }
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { success: false, error: "Format unggahan tidak valid" },
        { status: 400 }
      );
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { success: false, error: "Gambar tidak ditemukan" },
        { status: 400 }
      );
    }
    if (file.size > MAX_THUMBNAIL_BYTES) {
      return NextResponse.json(
        { success: false, error: "Ukuran gambar maksimal 3 MB" },
        { status: 400 }
      );
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: "Format harus JPG, PNG, atau WEBP" },
        { status: 400 }
      );
    }

    const { url, error: uploadError } = await uploadFile(
      "ticketing",
      file,
      ctx.branchId
    );
    if (uploadError || !url) {
      console.error("[ticketing] upload thumbnail gagal:", uploadError);
      return NextResponse.json(
        { success: false, error: "Gagal mengunggah gambar" },
        { status: 500 }
      );
    }

    await query(
      `UPDATE ticketing.ticket_products
       SET thumbnail_url = $2, updated_at = now()
       WHERE id = $1`,
      [id, url]
    );
    return successResponse({ thumbnail_url: url }, "Thumbnail tersimpan");
  } catch (err) {
    console.error("[ticketing] upload thumbnail error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mengunggah thumbnail" },
      { status: 500 }
    );
  }
}
