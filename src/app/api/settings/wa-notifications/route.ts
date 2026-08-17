import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import type { UserRole } from "@/types";
import { SETTING_KEYS, getSetting, setSetting } from "@/lib/settings/app-settings";
import {
  MAX_RECIPIENTS,
  WA_NOTIF_SETTING_KEY,
  WA_NOTIF_TYPES,
  normalizeWaRecipient,
  parseWaNotifConfig,
  type WaNotifConfig,
  type WaNotifType,
} from "@/lib/wa/notifications-config";

/**
 * GET/PUT /api/settings/wa-notifications — konfigurasi notifikasi WA owner
 * (EPIC-020): jenis mana yang aktif + nomor penerima + ambang void.
 * Digate super_admin + direksi, sama dengan papan monitoring desktop.
 */

const ALLOWED_ROLES: UserRole[] = ["super_admin", "direksi"];

export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.settingsIntegrations);
    const config = parseWaNotifConfig(await getSetting(WA_NOTIF_SETTING_KEY));
    // Penerima laporan tutup kasir — daftar terpisah dari recipients notifikasi
    // owner: audiensnya beda (supervisor/finance), tapi diatur di halaman sama.
    let shiftReportRecipients: string[] = [];
    try {
      const raw = await getSetting(SETTING_KEYS.POS_SHIFT_REPORT_WA_RECIPIENTS);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) shiftReportRecipients = parsed.map(String);
    } catch {
      // nilai korup dianggap kosong; PUT berikutnya menimpanya dengan bersih
    }
    return NextResponse.json({
      data: { config, catalog: WA_NOTIF_TYPES, shift_report_recipients: shiftReportRecipients },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[wa-notif] GET gagal:", error);
    return NextResponse.json({ error: "Gagal memuat konfigurasi" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsIntegrations);
    const body = (await request.json()) as Partial<WaNotifConfig>;

    // Mulai dari yang tersimpan supaya PUT parsial tidak menghapus field lain.
    const current = parseWaNotifConfig(await getSetting(WA_NOTIF_SETTING_KEY));

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        return NextResponse.json({ error: "enabled tidak valid" }, { status: 400 });
      }
      current.enabled = body.enabled;
    }

    if (body.recipients !== undefined) {
      if (!Array.isArray(body.recipients)) {
        return NextResponse.json({ error: "recipients tidak valid" }, { status: 400 });
      }
      const cleaned: string[] = [];
      for (const raw of body.recipients) {
        if (typeof raw !== "string") continue;
        const n = normalizeWaRecipient(raw);
        if (!n) {
          return NextResponse.json(
            { error: `Nomor tidak valid: ${raw}. Pakai format 08… atau 62…` },
            { status: 400 }
          );
        }
        if (!cleaned.includes(n)) cleaned.push(n);
      }
      if (cleaned.length > MAX_RECIPIENTS) {
        return NextResponse.json(
          { error: `Maksimal ${MAX_RECIPIENTS} nomor penerima` },
          { status: 400 }
        );
      }
      current.recipients = cleaned;
    }

    if (body.types !== undefined) {
      if (!body.types || typeof body.types !== "object") {
        return NextResponse.json({ error: "types tidak valid" }, { status: 400 });
      }
      for (const meta of WA_NOTIF_TYPES) {
        const v = (body.types as Record<WaNotifType, unknown>)[meta.key];
        if (typeof v === "boolean") current.types[meta.key] = v;
      }
    }

    if (body.voidThresholdRp !== undefined) {
      const n = Number(body.voidThresholdRp);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: "Ambang void tidak valid" }, { status: 400 });
      }
      current.voidThresholdRp = Math.round(n);
    }

    if (body.digestHour !== undefined) {
      const n = Number(body.digestHour);
      if (!Number.isInteger(n) || n < 0 || n > 23) {
        return NextResponse.json(
          { error: "Jam ringkasan harus 0-23 (WIB)" },
          { status: 400 }
        );
      }
      current.digestHour = n;
    }

    if (body.omzetAnjlokPct !== undefined) {
      const n = Number(body.omzetAnjlokPct);
      if (!Number.isInteger(n) || n < 1 || n > 99) {
        return NextResponse.json(
          { error: "Ambang omzet harus 1-99 (persen dari baseline)" },
          { status: 400 }
        );
      }
      current.omzetAnjlokPct = n;
    }

    // Penerima laporan tutup kasir (field terpisah dari config EPIC-020).
    // Validasi longgar di sini — normalisasi ketat (08xx→628xx, buang yang
    // rusak) terjadi di sisi PEMBACA saat mengirim, jadi nilai lama yang
    // formatnya beda tidak membuat penyimpanan gagal.
    const bodyExtra = body as { shift_report_recipients?: unknown };
    if (bodyExtra.shift_report_recipients !== undefined) {
      if (!Array.isArray(bodyExtra.shift_report_recipients)) {
        return NextResponse.json({ error: "shift_report_recipients tidak valid" }, { status: 400 });
      }
      const cleaned = [
        ...new Set(
          bodyExtra.shift_report_recipients
            .map((v) => String(v).replace(/[^0-9+]/g, ""))
            .filter((v) => v.length >= 9)
        ),
      ].slice(0, 10);
      await setSetting(
        SETTING_KEYS.POS_SHIFT_REPORT_WA_RECIPIENTS,
        cleaned.length > 0 ? JSON.stringify(cleaned) : null
      );
    }

    await setSetting(WA_NOTIF_SETTING_KEY, JSON.stringify(current));
    return NextResponse.json({ data: { config: current } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[wa-notif] PUT gagal:", error);
    return NextResponse.json({ error: "Gagal menyimpan konfigurasi" }, { status: 500 });
  }
}
