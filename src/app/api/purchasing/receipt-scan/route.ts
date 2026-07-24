import { NextRequest } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { savePrivateDocument } from "@/lib/storage-private";
import { extractAttachmentText, MAX_ATTACHMENT_BYTES } from "@/lib/attachments/extract";
import { parseReceiptText, type ReceiptFields } from "@/lib/purchasing/receipt-scan";

// OCR (tesseract.js) butuh Node runtime penuh.
export const runtime = "nodejs";

/** Selaras dengan role yang boleh mencatat pembayaran vendor. */
const SCAN_ROLES = ["admin", "super_admin", "purchasing_admin", "finance_staff"] as const;

/** Nota = foto atau PDF; spreadsheet/DOCX bukan bentuk nota. */
const ALLOWED_EXT = /\.(jpe?g|png|webp|pdf)$/i;

/**
 * Unggah nota/faktur vendor (EPIC-018 Fase B): file disimpan PERMANEN ke
 * storage/private/purchasing-receipts (arsip bukti), lalu teksnya diekstrak
 * (OCR untuk foto/scan) dan dipetakan ke field form pembayaran.
 *
 * File tetap tersimpan meskipun parsing gagal — arsip nota lebih penting
 * daripada prefill; user tinggal mengisi manual.
 */
export async function POST(request: NextRequest) {
  try {
    await requireApiRole([...SCAN_ROLES]);

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return Response.json({ success: false, message: "Pilih file nota dulu" }, { status: 400 });
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return Response.json(
        { success: false, message: "File terlalu besar — maksimal 10 MB" },
        { status: 400 }
      );
    }
    const originalName = (file.name || "nota").slice(0, 150);
    if (!ALLOWED_EXT.test(originalName)) {
      return Response.json(
        { success: false, message: "Format tidak didukung — gunakan foto (JPG/PNG) atau PDF" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Arsipkan dulu (per bulan supaya foldernya tidak membengkak).
    const now = new Date();
    const folder = `purchasing-receipts/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
    const saved = await savePrivateDocument(buffer, folder);
    if (!saved.path) {
      return Response.json(
        { success: false, message: saved.error || "File tidak bisa disimpan" },
        { status: 400 }
      );
    }

    // Ekstraksi & pemetaan best-effort — kegagalan OCR bukan kegagalan unggah.
    let fields: ReceiptFields = { nomor: null, tanggal: null, total: null };
    try {
      const extracted = await extractAttachmentText(buffer, originalName);
      fields = parseReceiptText(extracted.text);
    } catch (error) {
      console.warn("[purchasing:receipt-scan] ekstraksi gagal:", error);
    }

    return Response.json({
      success: true,
      data: { receipt_path: saved.path, receipt_name: originalName, fields },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error scanning receipt:", error);
    return Response.json(
      { success: false, message: "Nota tidak bisa diproses. Coba lagi." },
      { status: 500 }
    );
  }
}
