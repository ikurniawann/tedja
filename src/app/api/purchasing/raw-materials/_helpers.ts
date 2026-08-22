type DbError = { message: string; code?: string } | null | undefined;

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

export function throwIfDbError(error: DbError) {
  if (error) throw new Error(error.message);
}

export const UNIT_CONVERSION_SELECT = `
  *,
  satuan:units!satuan_id (*)
`;

export function prepareMaterialBody(body: Record<string, unknown>) {
  const next = { ...body };

  // Legacy / alternate field names from older clients
  if (next.kode == null && typeof next.kode_bahan === "string") {
    next.kode = next.kode_bahan;
  }
  if (next.nama == null && typeof next.nama_bahan === "string") {
    next.nama = next.nama_bahan;
  }

  for (const key of [
    "kode",
    "deskripsi",
    "satuan_kecil_id",
    "storage_condition",
    "coa_production",
    "coa_rnd",
    "coa_asset",
  ] as const) {
    if (next[key] === "") next[key] = null;
  }
  return next;
}

/** Normalisasi kode akun: "1 3 01 001" / "1-301-001" → "1301001" */
export function normalizeCoaAccountCode(raw: unknown): string | null {
  if (raw == null) return null;
  const digits = String(raw).trim().replace(/[\s\-_.]/g, "");
  if (!digits) return null;
  if (!/^\d{7}$/.test(digits)) return null;
  return digits;
}
