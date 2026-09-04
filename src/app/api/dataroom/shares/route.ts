import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamAction, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { DATAROOM_MAX_EXPIRY_DAYS, computeExpiry, normalizeEmails } from "@/lib/dataroom/config";
import { getNode } from "@/lib/dataroom/nodes";
import { createShare, listShares } from "@/lib/dataroom/shares";
import { sendShareLink, shareUrl } from "@/lib/dataroom/mail";

/**
 * GET  /api/dataroom/shares?node_id=  — daftar link (semua bila tanpa node_id).
 * POST /api/dataroom/shares — buat link: publik / email tertentu, PIN opsional,
 *      watermark, masa aktif (hari), opsi kirim email ke penerima.
 */
export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.dataroom);
    const nodeId = request.nextUrl.searchParams.get("node_id") || null;
    const rows = await listShares(nodeId);
    const data = rows.map(({ pin_hash, ...row }) => ({
      ...row, has_pin: Boolean(pin_hash), url: shareUrl(row.token),
    }));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[dataroom] shares GET:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

const createSchema = z.object({
  node_id: z.string().uuid(),
  access_type: z.enum(["public", "email"]),
  emails: z.array(z.string()).optional().default([]),
  pin: z.string().regex(/^\d{4,6}$/, "PIN harus 4–6 digit angka").nullable().optional(),
  watermark: z.boolean().optional().default(false),
  expires_days: z.number().int().min(1).max(DATAROOM_MAX_EXPIRY_DAYS).optional().default(7),
  send_email: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamAction(IAM.dataroom, "create");
    const body = await validateBody(request, createSchema);
    const node = await getNode(body.node_id);
    if (!node) throw ApiError.notFound("Item tidak ditemukan");
    const emails = normalizeEmails(body.emails);
    if (body.access_type === "email" && emails.length === 0) {
      throw ApiError.badRequest("Isi minimal satu email penerima yang valid");
    }
    const expiresAt = computeExpiry(body.expires_days);
    const share = await createShare({
      nodeId: node.id, accessType: body.access_type,
      allowedEmails: body.access_type === "email" ? emails : [],
      pin: body.pin || null, watermark: body.watermark, expiresAt,
      userId: user.id, userName: user.full_name,
    });
    let mail: { sent: number; failed: string[] } | null = null;
    if (body.send_email && emails.length > 0) {
      mail = await sendShareLink({
        emails, shareName: node.name, kind: node.kind, token: share.token,
        senderName: user.full_name, expiresAt, hasPin: Boolean(body.pin),
      });
    }
    const { pin_hash, ...rest } = share;
    return NextResponse.json(
      { success: true, data: { ...rest, has_pin: Boolean(pin_hash), url: shareUrl(share.token), node_name: node.name, node_kind: node.kind, access_count: 0, mail } },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[dataroom] shares POST:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
