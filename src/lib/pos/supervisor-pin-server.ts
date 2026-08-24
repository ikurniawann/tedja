import { createPgClient } from "@/lib/pg/create-client";
import { findSupervisorByPin } from "./supervisor-pin";

export interface ApprovedSupervisor {
  id: string;
  name: string;
}

/**
 * Verifikasi PIN supervisor POS di sisi server — dipakai gerbang yang
 * membutuhkan persetujuan supervisor (Void/Merge/Owner Comp/metode FOC).
 * Mengembalikan identitas supervisor yang cocok, atau null bila PIN salah.
 */
export async function verifySupervisorPinServer(
  pin: string
): Promise<ApprovedSupervisor | null> {
  const trimmed = String(pin || "").trim();
  if (!trimmed) return null;
  const db = createPgClient();
  const { data } = await db
    .from("users")
    .select("id, full_name, role, pos_pin")
    .eq("role", "pos_supervisor");
  const supervisor = await findSupervisorByPin(
    (data ?? []) as Array<{ id: string; full_name: string | null; pos_pin: string | null }>,
    trimmed
  );
  if (!supervisor) return null;
  return { id: supervisor.id, name: supervisor.full_name || "Supervisor" };
}
