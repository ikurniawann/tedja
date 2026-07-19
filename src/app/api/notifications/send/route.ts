import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/api/auth";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { sendEmail, candidateStatusEmail } from "@/lib/resend";

// Sending candidate notifications is an HR action — restrict to HR roles.
const NOTIFY_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;

interface SendNotificationBody {
  candidate_id: string;
  channel?: "whatsapp" | "email";
  template?: "interview_scheduled" | "status_update";
  message?: string;
  // For interview_scheduled template
  interview_date?: string;
  interview_type?: string;
  mode?: "offline" | "online";
  meeting_link?: string;
  interviewer_name?: string;
}

function buildInterviewScheduledMessage(
  candidateName: string,
  interviewDate: string,
  interviewType: string,
  mode: "offline" | "online",
  meetingLink?: string,
  interviewerName?: string
): string {
  const dateStr = new Date(interviewDate).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  let msg = `Halo ${candidateName}, jadwal interview telah ditentukan:\n\n`;
  msg += `📅 *${interviewType}*\n`;
  msg += `🗓️ Tanggal: ${dateStr}\n`;
  msg += `📍 Mode: ${mode === "online" ? "Online (Zoom/Google Meet)" : "Offline (Tatap Muka)"}`;
  if (mode === "online" && meetingLink) {
    msg += `\n🔗 Link: ${meetingLink}`;
  }
  if (interviewerName) {
    msg += `\n👤 Interviewer: ${interviewerName}`;
  }
  msg += `\n\nMohon konfirmasi kehadiran. Terima kasih!`;
  return msg;
}

export async function POST(request: Request) {
  const authedUser = await getApiUser();
  if (!authedUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!NOTIFY_ROLES.includes(authedUser.role as (typeof NOTIFY_ROLES)[number])) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const db = await createServerPgClient();
  const body: SendNotificationBody = await request.json();

  const { candidate_id, channel = "whatsapp", template, message } = body;

  // Fetch candidate
  const { data: candidate } = await db
    .from("candidates")
    .select("full_name, email, phone, status")
    .eq("id", candidate_id)
    .single();

  if (!candidate) {
    return NextResponse.json({ error: "Kandidat tidak ditemukan" }, { status: 404 });
  }

  let notificationMessage = message;
  let success = false;
  let error = "";

  if (channel === "whatsapp") {
    // Build message from template if provided
    if (template === "interview_scheduled" && !notificationMessage) {
      notificationMessage = buildInterviewScheduledMessage(
        candidate.full_name,
        body.interview_date ?? "",
        body.interview_type ?? "Interview",
        body.mode ?? "offline",
        body.meeting_link,
        body.interviewer_name
      );
    } else if (!notificationMessage) {
      notificationMessage = `Halo ${candidate.full_name}, Status lamaran kamu saat ini: ${candidate.status}`;
    }

    // Format phone number for Fonnte (e.g. 6281234567890)
    const phone = candidate.phone.replace(/\D/g, "");
    const result = await sendWhatsAppText({
      target: phone,
      message: notificationMessage,
    });
    success = result.success;
    error = result.reason || "";
  } else if (channel === "email") {
    if (template === "interview_scheduled" && !notificationMessage) {
      notificationMessage = buildInterviewScheduledMessage(
        candidate.full_name,
        body.interview_date ?? "",
        body.interview_type ?? "Interview",
        body.mode ?? "offline",
        body.meeting_link,
        body.interviewer_name
      );
    }
    const template_ = candidateStatusEmail(
      candidate.full_name,
      candidate.status,
      notificationMessage || undefined
    );
    success = await sendEmail({ to: candidate.email, ...template_ });
    if (!success) error = "Gagal mengirim email";
  } else {
    return NextResponse.json({ error: "Channel tidak valid" }, { status: 400 });
  }

  // Log notification
  await db.from("notifications_log").insert({
    candidate_id,
    channel,
    message: notificationMessage || "Notifikasi",
    status: success ? "sent" : "failed",
    sent_at: success ? new Date().toISOString() : null,
  });

  if (!success) {
    return NextResponse.json({ error: error || "Gagal mengirim notifikasi" }, { status: 500 });
  }

  return NextResponse.json({ message: "Notifikasi terkirim" });
}
