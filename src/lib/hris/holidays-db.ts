import { query } from "@/lib/db";
import { indexHolidays, type HolidayIndex, type HolidayRow } from "./holidays";

/**
 * Pemuat hari libur sisi server (EPIC-036). Dipisah dari `holidays.ts` supaya
 * modul murni itu tetap bisa diimpor komponen client tanpa menyeret `@/lib/db`
 * ke dalam bundle browser.
 *
 * Hanya baris `aktif` yang keluar: baris `draft` (hasil impor yang belum
 * disetujui HRD) tidak boleh mempengaruhi perhitungan apa pun.
 */
export async function loadHolidayIndex(
  startIso: string,
  endIso: string
): Promise<HolidayIndex> {
  const rows = await query<HolidayRow>(
    `SELECT holiday_date::text AS holiday_date, name, type, deducts_leave
       FROM hris.public_holidays
      WHERE deleted_at IS NULL
        AND status = 'aktif'
        AND holiday_date BETWEEN $1::date AND $2::date
      ORDER BY holiday_date, name`,
    [startIso, endIso]
  );
  return indexHolidays(rows);
}
