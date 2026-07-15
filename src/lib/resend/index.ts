// Resend Email integration

import React from "react";
import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  if (!resend) {
    console.warn("RESEND_API_KEY is not set");
    return false;
  }

  try {
    const { error } = await resend!.emails.send({
      from: payload.from || "Talent Pool <onboarding@resend.dev>",
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    });

    if (error) {
      console.error("Resend error:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Email send error:", err);
    return false;
  }
}

// --- Email Templates ---

export function candidateStatusEmail(
  candidateName: string,
  status: string,
  notes?: string
) {
  const statusLabels: Record<string, string> = {
    applied: "Applied",
    screening: "Screening",
    psikotes: "Psikotes",
    interview: "Interview",
    offer: "Offer",
    talent_pool: "Talent Pool",
    hired: "Diterima",
    rejected: "Tidak Diterima",
  };

  return {
    subject: `Update Status Lamaran - ${candidateName}`,
    html: `
      <h2>Hi ${candidateName},</h2>
      <p>Status lamaran kamu saat ini: <strong>${statusLabels[status] || status}</strong></p>
      ${notes ? `<p>Catatan: ${notes}</p>` : ""}
      <p>Terima kasih sudah melamar di Aapex Technology.</p>
    `,
  };
}
