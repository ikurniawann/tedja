import { NextRequest, NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import type { UserRole } from "@/types";
import { getSetting, setSetting } from "@/lib/settings/app-settings";
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
    await requireApiRole(ALLOWED_ROLES);
    const config = parseWaNotifConfig(await getSetting(WA_NOTIF_SETTING_KEY));
    return NextResponse.json({ data: { config, catalog: WA_NOTIF_TYPES } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[wa-notif] GET gagal:", error);
    return NextResponse.json({ error: "Gagal memuat konfigurasi" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireApiRole(ALLOWED_ROLES);
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

    await setSetting(WA_NOTIF_SETTING_KEY, JSON.stringify(current));
    return NextResponse.json({ data: { config: current } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[wa-notif] PUT gagal:", error);
    return NextResponse.json({ error: "Gagal menyimpan konfigurasi" }, { status: 500 });
  }
}
