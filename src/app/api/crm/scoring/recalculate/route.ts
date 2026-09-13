import { successResponse } from "@/lib/api/auth";
import { requireCrmSettingsUser } from "@/lib/crm/advance-guard";
import { recalculateAllLeadScores } from "@/lib/crm/scoring-server";

/** Hitung ulang skor semua lead (setelah aturan diubah). */
export async function POST() {
  const { error, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const result = await recalculateAllLeadScores(scope?.companyId ?? null);
  return successResponse(result, `${result.total} lead dihitung ulang, ${result.changed} berubah`);
}
