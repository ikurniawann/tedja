import { NextRequest, NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import { query } from "@/lib/db";

/**
 * GET /api/recruitment/live-monitoring — daftar sesi yang sedang berjalan
 * DAN online (mengirim frame dalam 60 detik terakhir) utk halaman thumbnail
 * Live Monitoring: identitas kandidat, frame terakhir, & aktivitas chat.
 * Sesi in_progress yang basi (kandidat menutup tab tanpa menyelesaikan)
 * tidak ditampilkan.
 */

const ONLINE_WINDOW = "60 seconds";
/** Sesi tanpa frame tetap tampil bila kandidat baru saja chat (butuh balasan). */
const CHAT_WINDOW = "10 minutes";

const MONITOR_ROLES = ["super_admin", "admin", "hrd"] as const;

export async function GET(_req: NextRequest) {
  try {
    await requireApiRole([...MONITOR_ROLES]);

    const rows = await query(
      `SELECT 'psikotes' AS session_type, s.id AS session_id, s.started_at,
              c.full_name AS candidate_name, p.title AS position_title,
              f.updated_at AS frame_updated_at,
              lc.created_at AS last_message_at, lc.sender AS last_message_sender
       FROM recruitment.psikotes_sessions s
       JOIN recruitment.candidates c ON c.id = s.candidate_id
       LEFT JOIN hris.positions p ON p.id = c.position_id
       LEFT JOIN recruitment.live_monitor_frames f
         ON f.session_type = 'psikotes' AND f.session_id = s.id
       LEFT JOIN LATERAL (
         SELECT m.created_at, m.sender FROM recruitment.live_chat_messages m
         WHERE m.session_type = 'psikotes' AND m.session_id = s.id
         ORDER BY m.created_at DESC LIMIT 1
       ) lc ON true
       WHERE s.status IN ('sent', 'in_progress')
         AND (f.updated_at > now() - interval '${ONLINE_WINDOW}'
              OR (lc.sender = 'candidate' AND lc.created_at > now() - interval '${CHAT_WINDOW}'))

       UNION ALL

       SELECT 'interview' AS session_type, s.id AS session_id, s.started_at,
              c.full_name AS candidate_name, p.title AS position_title,
              f.updated_at AS frame_updated_at,
              lc.created_at AS last_message_at, lc.sender AS last_message_sender
       FROM recruitment.interview_ai_sessions s
       JOIN recruitment.candidates c ON c.id = s.candidate_id
       LEFT JOIN hris.positions p ON p.id = c.position_id
       LEFT JOIN recruitment.live_monitor_frames f
         ON f.session_type = 'interview' AND f.session_id = s.id
       LEFT JOIN LATERAL (
         SELECT m.created_at, m.sender FROM recruitment.live_chat_messages m
         WHERE m.session_type = 'interview' AND m.session_id = s.id
         ORDER BY m.created_at DESC LIMIT 1
       ) lc ON true
       WHERE s.status IN ('sent', 'in_progress')
         AND (f.updated_at > now() - interval '${ONLINE_WINDOW}'
              OR (lc.sender = 'candidate' AND lc.created_at > now() - interval '${CHAT_WINDOW}'))

       ORDER BY started_at DESC NULLS LAST`
    );

    return NextResponse.json({ data: rows });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[live-monitoring] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
