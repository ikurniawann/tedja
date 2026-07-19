import { NextRequest, NextResponse } from "next/server";
import { uploadFile } from "@/lib/storage";
import { Resend } from "resend";
import { createPgClient } from "@/lib/pg/create-client";
import type { CandidateSource } from "@/types";

const FROM_EMAIL = process.env.FROM_EMAIL ?? "noreply@aapextechnology.com";

function getAdminDb() {
  return createPgClient();
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const full_name = formData.get("full_name") as string;
    const email = formData.get("email") as string;
    const phone = formData.get("phone") as string;
    const domicile = formData.get("domicile") as string;
    const source = formData.get("source") as string;
    const position_id = formData.get("position_id") as string | null;
    const brand_id = formData.get("brand_id") as string | null;
    const job_opening_id = formData.get("job_opening_id") as string | null;
    const notes = formData.get("notes") as string | null;
    // New fields
    const last_experience = formData.get("last_experience") as string | null;
    const last_education = formData.get("last_education") as string | null;
    const availability = formData.get("availability") as string | null;
    const expected_salary = formData.get("expected_salary") as string | null;

    const cvFile = formData.get("cv") as File | null;
    const photoFile = formData.get("photo") as File | null;

    // --- Basic validation ---
    if (!full_name || !email || !phone || !domicile || !source) {
      return NextResponse.json({ error: "Field wajib belum lengkap" }, { status: 400 });
    }

    // --- Photo is required ---
    if (!photoFile || photoFile.size === 0) {
      return NextResponse.json({ error: "Pas foto wajib diupload" }, { status: 400 });
    }

    // --- Upload files ---
    let cvUrl: string | null = null;
    let photoUrl: string | null = null;

    if (cvFile && cvFile.size > 0) {
      const validTypes = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];
      if (!validTypes.includes(cvFile.type)) {
        return NextResponse.json({ error: "CV harus format PDF atau DOC" }, { status: 400 });
      }
      if (cvFile.size > 2 * 1024 * 1024) {
        return NextResponse.json({ error: "CV maksimal 2MB" }, { status: 400 });
      }
      const result = await uploadFile("cv", cvFile, "candidates");
      if (result.error) {
        return NextResponse.json({ error: "Gagal upload CV: " + result.error }, { status: 500 });
      }
      cvUrl = result.url;
    }

    if (photoFile && photoFile.size > 0) {
      const validTypes = ["image/jpeg", "image/png", "image/webp"];
      if (!validTypes.includes(photoFile.type)) {
        return NextResponse.json({ error: "Foto harus format JPG/PNG" }, { status: 400 });
      }
      if (photoFile.size > 2 * 1024 * 1024) {
        return NextResponse.json({ error: "Foto maksimal 2MB" }, { status: 400 });
      }
      const result = await uploadFile("photos", photoFile, "candidates");
      if (result.error) {
        return NextResponse.json({ error: "Gagal upload foto: " + result.error }, { status: 500 });
      }
      photoUrl = result.url;
    }

    // --- Save to database ---
    const adminDb = getAdminDb();

    // Get position and brand names for email
    let positionTitle = "Belum ditentukan";
    let brandName = "Umum";
    
    if (position_id) {
      const { data: pos } = await adminDb.from("positions").select("title").eq("id", position_id).single();
      if (pos) positionTitle = pos.title;
    }
    if (brand_id) {
      const { data: br } = await adminDb.from("brands").select("name").eq("id", brand_id).single();
      if (br) brandName = br.name;
    }

    const { data: candidate, error: insertError } = await adminDb
      .from("candidates")
      .insert({
        full_name,
        email,
        phone,
        domicile,
        source: source as CandidateSource,
        position_id: position_id || null,
        brand_id: brand_id || null,
        job_opening_id: job_opening_id || null,
        cv_url: cvUrl,
        photo_url: photoUrl,
        notes: notes || null,
        status: "applied",
        // New fields
        last_experience: last_experience || null,
        last_education: last_education || null,
        availability: availability || null,
        expected_salary: expected_salary ? parseInt(expected_salary, 10) : null,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: "Gagal simpan lamaran: " + insertError.message }, { status: 500 });
    }

    // --- Send confirmation email to candidate ---
    if (process.env.RESEND_API_KEY) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: FROM_EMAIL,
          to: email,
          subject: "Lamaran Kamu Sudah Kami Terima",
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1a1a1a;">Terima Kasih, ${full_name}!</h2>
              <p style="color: #555;">Lamaran kamu untuk posisi <strong>${positionTitle}</strong> di <strong>${brandName}</strong> sudah kami terima.</p>
              <p style="color: #555;">Tim HRD akan menghubungi kamu melalui WhatsApp atau email dalam 1-3 hari kerja.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
              <p style="color: #888; font-size: 12px;">Pesan ini dikirim otomatis. Mohon tidak membalas email ini.</p>
            </div>
          `,
        });
      } catch (emailError) {
        console.error("Candidate email error:", emailError);
      }
    }

    // --- Send notification email to HRD ---
    const HRD_EMAIL = process.env.HRD_EMAIL;
    if (process.env.RESEND_API_KEY && HRD_EMAIL) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: FROM_EMAIL,
          to: HRD_EMAIL,
          subject: `[Talent Pool] Lamaran Baru — ${full_name} untuk ${positionTitle}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1a1a1a;">Lamaran Baru Masuk</h2>
              <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
                <tr>
                  <td style="padding: 8px 0; color: #555; width: 140px;">Nama</td>
                  <td style="padding: 8px 0; font-weight: 600; color: #1a1a1a;">${full_name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #555;">Email</td>
                  <td style="padding: 8px 0; color: #1a1a1a;"><a href="mailto:${email}">${email}</a></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #555;">No. WhatsApp</td>
                  <td style="padding: 8px 0; color: #1a1a1a;"><a href="https://wa.me/${phone.replace(/\D/g, "")}">${phone}</a></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #555;">Domisili</td>
                  <td style="padding: 8px 0; color: #1a1a1a;">${domicile}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #555;">Posisi</td>
                  <td style="padding: 8px 0; color: #1a1a1a;">${positionTitle}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #555;">Outlet</td>
                  <td style="padding: 8px 0; color: #1a1a1a;">${brandName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #555;">Sumber</td>
                  <td style="padding: 8px 0; color: #1a1a1a;">${source}</td>
                </tr>
                ${notes ? `<tr><td style="padding: 8px 0; color: #555;">Catatan</td><td style="padding: 8px 0; color: #1a1a1a;">${notes}</td></tr>` : ""}
              </table>
              <div style="margin-top: 24px;">
                <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://arkiv-os.vercel.app"}/dashboard/candidates/${candidate.id}" style="background: #2563eb; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">Lihat di Dashboard</a>
              </div>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
              <p style="color: #888; font-size: 12px;">Pesan ini dikirim otomatis dari sistem Talent Pool.</p>
            </div>
          `,
        });
      } catch (emailError) {
        console.error("HRD email error:", emailError);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Lamaran berhasil dikirim",
      candidate_id: candidate.id,
    });
  } catch (error: unknown) {
    console.error("Portal submit error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Terjadi kesalahan: " + message }, { status: 500 });
  }
}
