import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIpFrom } from "@/lib/public/rate-limit";
import { isLikelyBot, parseAttribution, validateSubmission } from "@/lib/crm/public-forms";
import {
  bumpSubmissionCount, createLeadFromSubmission, formFields, hashIp, loadPublicForm, notifyNewLead, recordSubmission,
} from "@/lib/crm/public-forms-server";

/** EPIC-050 T-5.3 — definisi form untuk dirender halaman publik. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = await loadPublicForm(slug);
  if (!form) return NextResponse.json({ success: false, error: "Form tidak ditemukan" }, { status: 404 });
  return NextResponse.json({
    success: true,
    data: {
      slug: form.slug,
      title: form.title,
      description: form.description,
      fields: formFields(form.fields),
      submit_label: form.submit_label,
      success_message: form.success_message,
      redirect_url: form.redirect_url,
    },
  });
}

/** Kiriman form publik → lead + scoring + workflow + notifikasi sales. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`crm-form:${ip}`, { limit: 5, windowMs: 5 * 60_000 })) {
    return NextResponse.json({ success: false, error: "Terlalu banyak kiriman — coba lagi beberapa menit lagi" }, { status: 429 });
  }

  const form = await loadPublicForm(slug);
  if (!form) return NextResponse.json({ success: false, error: "Form tidak ditemukan" }, { status: 404 });

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Isian tidak terbaca" }, { status: 400 });
  }

  const ipHash = hashIp(ip);
  const userAgent = request.headers.get("user-agent");
  const attribution = parseAttribution(payload);

  // Jebakan bot: balas seolah berhasil supaya bot tidak belajar polanya,
  // tapi tidak ada lead yang dibuat.
  const bot = isLikelyBot(payload);
  if (bot.bot) {
    await recordSubmission({ formId: form.id, leadId: null, payload, utm: attribution, ipHash, userAgent, status: "rejected", reason: bot.reason });
    return NextResponse.json({ success: true, data: { message: form.success_message, redirect_url: form.redirect_url } });
  }

  const submission = validateSubmission(formFields(form.fields), payload);
  if (!submission.ok) {
    await recordSubmission({ formId: form.id, leadId: null, payload, utm: attribution, ipHash, userAgent, status: "rejected", reason: "validasi gagal" });
    return NextResponse.json({ success: false, error: "Periksa kembali isian Anda", details: submission.errors }, { status: 400 });
  }

  const created = await createLeadFromSubmission(form, submission, attribution);
  if (!created) {
    await recordSubmission({ formId: form.id, leadId: null, payload, utm: attribution, ipHash, userAgent, status: "rejected", reason: "venue belum dikonfigurasi" });
    return NextResponse.json({ success: false, error: "Form belum siap menerima kiriman. Hubungi kami lewat WhatsApp." }, { status: 503 });
  }

  await recordSubmission({
    formId: form.id, leadId: created.leadId, payload, utm: attribution, ipHash, userAgent,
    status: created.duplicate ? "duplicate" : "ok",
  });
  await bumpSubmissionCount(form.id);
  // Notifikasi tidak boleh menggagalkan respons ke pengirim form.
  if (!created.duplicate) await notifyNewLead(form, created.leadId, submission, attribution).catch(() => undefined);

  return NextResponse.json({ success: true, data: { message: form.success_message, redirect_url: form.redirect_url } });
}
