import { queryOne } from "@/lib/db";

/**
 * EPIC-043: Complimentary orders — KOL (gratis otomatis, tercatat penuh)
 * dan Owner Comp (open bill diselesaikan gratis dengan PIN supervisor).
 *
 * Prinsip: order komplimen tetap tercatat LENGKAP (item, subtotal gross,
 * diskon = subtotal, total 0) supaya laporan bisa menghitung nilai barang
 * yang digratiskan; comp_type + comp_approved_* menjawab "siapa & kenapa".
 */

export const KOL_COMP = "kol_comp";
export const OWNER_COMP = "owner_comp";
export const COMP_TYPES = [KOL_COMP, OWNER_COMP] as const;
export type CompType = (typeof COMP_TYPES)[number];

export function isCompType(value: unknown): value is CompType {
  return value === KOL_COMP || value === OWNER_COMP;
}

/** Label struk/laporan per jenis komplimen. */
export function compReceiptLabel(
  compType?: string | null,
  approvedName?: string | null
): string | null {
  if (compType === KOL_COMP) return "KOL COMPLIMENTARY — GRATIS";
  if (compType === OWNER_COMP) {
    return `OWNER COMP — Disetujui: ${approvedName?.trim() || "-"}`;
  }
  return null;
}

/**
 * Kuota bulanan KOL (pure, unit-testable): limit NULL = tanpa batas;
 * selain itu pemakaian bulan berjalan + order baru tidak boleh melebihi.
 */
export function kolQuotaAllows(input: {
  monthlyLimitIdr: number | null;
  usedThisMonthIdr: number;
  orderGrossIdr: number;
}): { ok: true } | { ok: false; reason: string } {
  if (input.monthlyLimitIdr == null) return { ok: true };
  const after = input.usedThisMonthIdr + input.orderGrossIdr;
  if (after <= input.monthlyLimitIdr + 0.5) return { ok: true };
  const fmt = (n: number) => Math.round(n).toLocaleString("id-ID");
  return {
    ok: false,
    reason: `Kuota komplimen KOL bulan ini terlampaui (terpakai ${fmt(input.usedThisMonthIdr)} dari ${fmt(input.monthlyLimitIdr)}, order ini ${fmt(input.orderGrossIdr)})`,
  };
}

/** Awal bulan berjalan dalam WIB → ISO UTC utk filter ordered_at. */
export function monthStartWibIso(now = new Date()): string {
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
  return new Date(`${y}-${m}-01T00:00:00+07:00`).toISOString();
}

/**
 * Validasi server komplimen KOL: customer harus bertanda is_kol dan kuota
 * bulanan (bila diset) mencukupi. grossIdr = subtotal SEBELUM diskon.
 */
export async function validateKolComp(input: {
  customerId: string;
  grossIdr: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const customer = await queryOne<{
    is_kol: boolean;
    kol_monthly_limit_idr: string | null;
    name: string | null;
  }>(
    `SELECT is_kol, kol_monthly_limit_idr, name
     FROM pos.pos_customers WHERE id = $1`,
    [input.customerId]
  ).catch((error) => {
    // 42703 = kolom belum di-migrate → fitur KOL belum aktif di env ini.
    if ((error as { code?: string })?.code === "42703") return null;
    throw error;
  });
  if (!customer) {
    return { ok: false, reason: "Customer tidak ditemukan / fitur KOL belum aktif (migrasi 015)" };
  }
  if (!customer.is_kol) {
    return { ok: false, reason: `${customer.name || "Customer"} bukan KOL — komplimen KOL ditolak` };
  }

  const limit =
    customer.kol_monthly_limit_idr == null ? null : Number(customer.kol_monthly_limit_idr);
  if (limit == null) return { ok: true };

  const used = await queryOne<{ used: string }>(
    `SELECT COALESCE(SUM(subtotal), 0) AS used
     FROM pos.pos_orders
     WHERE customer_id = $1
       AND comp_type = '${KOL_COMP}'
       AND status NOT IN ('cancelled', 'voided', 'merged')
       AND ordered_at >= $2`,
    [input.customerId, monthStartWibIso()]
  );

  return kolQuotaAllows({
    monthlyLimitIdr: limit,
    usedThisMonthIdr: Number(used?.used) || 0,
    orderGrossIdr: input.grossIdr,
  });
}
