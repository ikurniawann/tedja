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
  const slug = getString(body, "slug", slugify(title)).trim();

  return {
    position_id: getString(body, "position_id") || null,
    brand_id: getString(body, "brand_id") || null,
    department_id: getString(body, "department_id") || null,
    title,
    slug,
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
    published_at: status === "published" ? new Date().toISOString() : null,
  };
}

export async function GET() {
  const guard = await requireIamGuard(IAM.hrisRecruitment);
  if (guard.error) return guard.error;
  const db = createPgClient();

  const { data, error } = await db
    .from("job_openings")
    .select("*, brand:brands(id, name), position:positions(id, title, department, level), department_ref:departments(id, name, code)")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data || [] });
}

export async function POST(request: NextRequest) {
  const guard = await requireIamGuard(IAM.hrisRecruitment);
  if (guard.error) return guard.error;
  const db = createPgClient();
  const payload = normalizePayload(await request.json() as Record<string, unknown>);

  if (!payload.title) {
    return NextResponse.json({ error: "Judul lowongan wajib diisi" }, { status: 400 });
  }

  if (!payload.slug) {
    return NextResponse.json({ error: "Slug lowongan wajib diisi" }, { status: 400 });
  }

  if (!["draft", "published", "closed"].includes(payload.status)) {
    return NextResponse.json({ error: "Status lowongan tidak valid" }, { status: 400 });
  }

  const { data, error } = await db
    .from("job_openings")
    .insert(payload)
    .select("*, brand:brands(id, name), position:positions(id, title, department, level), department_ref:departments(id, name, code)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data, message: "Lowongan berhasil dibuat" }, { status: 201 });
}
