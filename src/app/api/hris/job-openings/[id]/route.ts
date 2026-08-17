import { NextRequest, NextResponse } from "next/server";
import { requireIamGuard } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from "@/lib/pg/create-client";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getString(body: Record<string, unknown>, key: string, fallback = "") {
  const value = body[key];
  return typeof value === "string" ? value : fallback;
}

function normalizePayload(body: Record<string, unknown>) {
  const title = getString(body, "title").trim();
  const status = getString(body, "status", "draft");
  const publishedAt = getString(body, "published_at");

  return {
    position_id: getString(body, "position_id") || null,
    brand_id: getString(body, "brand_id") || null,
    department_id: getString(body, "department_id") || null,
    title,
    slug: getString(body, "slug", slugify(title)).trim(),
    department: getString(body, "department", "Operations").trim(),
    location: getString(body, "location", "Jakarta, ID").trim(),
    employment_type: getString(body, "employment_type", "Full-time").trim(),
    work_mode: getString(body, "work_mode", "On-site").trim(),
    headcount: Number(body.headcount || 1),
    description: getString(body, "description").trim() || null,
    requirements: getString(body, "requirements").trim() || null,
    benefits: getString(body, "benefits").trim() || null,
    status,
    closing_date: getString(body, "closing_date") || null,
    published_at: status === "published" && !publishedAt ? new Date().toISOString() : publishedAt || null,
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireIamGuard(IAM.hrisRecruitment);
  if (guard.error) return guard.error;
  const { id } = await params;
  const db = createPgClient();
  const payload = normalizePayload(await request.json() as Record<string, unknown>);

  if (!payload.title) {
    return NextResponse.json({ error: "Judul lowongan wajib diisi" }, { status: 400 });
  }

  const { data, error } = await db
    .from("job_openings")
    .update(payload)
    .eq("id", id)
    .select("*, brand:brands(id, name), position:positions(id, title, department, level), department_ref:departments(id, name, code)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data, message: "Lowongan berhasil diperbarui" });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireIamGuard(IAM.hrisRecruitment);
  if (guard.error) return guard.error;
  const { id } = await params;
  const db = createPgClient();

  const { error } = await db.from("job_openings").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: "Lowongan berhasil dihapus" });
}
