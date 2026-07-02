import type { UserScope } from "@/lib/api/scope";
import { branchScopeOr, companyScopeOr } from "@/lib/api/scope";
import type { createServerPgClient } from "@/lib/pg/create-client";

type Db = Awaited<ReturnType<typeof createServerPgClient>>;

export function mapPurchaseReturnRow<
  T extends {
    grn_id?: string | null;
    grn_number?: string | null;
    grn?: { id?: string | null; nomor_grn?: string | null; grn_number?: string | null } | null;
  },
>(row: T) {
  const nomorGrn =
    row.grn_number || row.grn?.nomor_grn || row.grn?.grn_number || null;
  const grnId = row.grn_id || row.grn?.id || null;

  if (!nomorGrn && !grnId) return row;

  return {
    ...row,
    grn_number: nomorGrn,
    grn: {
      ...(row.grn || {}),
      id: grnId,
      nomor_grn: nomorGrn,
      grn_number: nomorGrn,
    },
  };
}

/** Batch-load GRN numbers when the embedded relation is missing from list queries. */
export async function enrichPurchaseReturnsWithGrn<
  T extends {
    grn_id?: string | null;
    grn?: { id?: string | null; nomor_grn?: string | null; grn_number?: string | null } | null;
  },
>(db: Db, rows: T[]) {
  const grnIds = [...new Set(rows.map((row) => row.grn_id).filter(Boolean))] as string[];
  if (grnIds.length === 0) {
    return rows.map((row) => mapPurchaseReturnRow(row));
  }

  const { data: grnRows, error } = await db
    .from("grn")
    .select("id, nomor_grn")
    .in("id", grnIds);

  if (error) throw error;

  const grnById = new Map((grnRows || []).map((grn) => [grn.id, grn]));

  return rows.map((row) => {
    const grnFromDb = row.grn_id ? grnById.get(row.grn_id) : undefined;
    return mapPurchaseReturnRow({
      ...row,
      grn: grnFromDb
        ? {
            id: grnFromDb.id,
            nomor_grn: grnFromDb.nomor_grn,
            ...(row.grn || {}),
          }
        : row.grn,
    });
  });
}

/** GRN ids that completed QC and match the user's business scope. */
export async function listScopedQcCompletedGrnIds(
  db: Db,
  scope: UserScope | null
): Promise<string[]> {
  const { data: qcRows, error: qcError } = await db
    .from("grn_qc_inspections")
    .select("grn_id")
    .eq("inventory_posted", true);

  if (qcError) throw qcError;

  const qcGrnIds = (qcRows || []).map((row) => row.grn_id).filter(Boolean) as string[];
  if (qcGrnIds.length === 0) return [];

  let grnQuery = db
    .from("grn")
    .select("id")
    .in("id", qcGrnIds)
    .eq("is_active", true);

  const companyOr = companyScopeOr(scope);
  if (companyOr) grnQuery = grnQuery.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) grnQuery = grnQuery.or(branchOr);

  const { data: grnRows, error: grnError } = await grnQuery;
  if (grnError) throw grnError;

  return (grnRows || []).map((row) => row.id).filter(Boolean) as string[];
}
