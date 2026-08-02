// EPIC-039 Fase C — resolver provider kurir + akses settings pengiriman.

import type { DbClient } from "@/lib/pg/types";
import { biteshipProvider } from "./biteship";
import { rajaongkirProvider } from "./rajaongkir";
import type { ShippingProvider, ShippingProviderName } from "./types";

export * from "./types";

const PROVIDERS: Record<ShippingProviderName, ShippingProvider> = {
  biteship: biteshipProvider,
  rajaongkir: rajaongkirProvider,
};

export function resolveShippingProvider(name: string | null | undefined): ShippingProvider {
  const key = String(name || "biteship").toLowerCase() as ShippingProviderName;
  return PROVIDERS[key] ?? biteshipProvider;
}

export type ShippingSettings = {
  id: string;
  provider: ShippingProviderName;
  origin_area_id: string | null;
  origin_district_id: string | null;
  origin_label: string | null;
  origin_postal_code: string | null;
  origin_address: string | null;
  origin_contact_name: string | null;
  origin_contact_phone: string | null;
  couriers: string;
  markup_amount: number;
  is_active: boolean;
};

export const DEFAULT_COURIERS = "jne,jnt,sicepat";

/** Ambil (atau buat) baris settings pengiriman global. */
export async function getOrCreateShippingSettings(db: DbClient): Promise<ShippingSettings> {
  const { data: existing, error } = await db
    .from("shipping_settings")
    .select("*")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing as ShippingSettings;

  const { data: created, error: createError } = await db
    .from("shipping_settings")
    .insert({ provider: "biteship", couriers: DEFAULT_COURIERS })
    .select("*")
    .single();
  if (createError || !created) {
    throw new Error(createError?.message || "Gagal menyiapkan settings pengiriman");
  }
  return created as ShippingSettings;
}

/** id origin sesuai provider aktif (biteship=area, rajaongkir=district). */
export function resolveOriginId(settings: ShippingSettings): string | null {
  return settings.provider === "rajaongkir"
    ? settings.origin_district_id
    : settings.origin_area_id;
}

export function parseCourierList(value: string | null | undefined): string[] {
  return String(value || DEFAULT_COURIERS)
    .split(",")
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);
}
