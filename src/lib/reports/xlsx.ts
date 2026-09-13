/** Respons XLSX generik: daftar sheet (array-of-arrays) → file unduhan. */
import { NextResponse } from "next/server";

export type XlsxSheet = { name: string; rows: Array<Array<string | number>> };

export async function xlsxResponse(sheets: XlsxSheet[], filename: string): Promise<NextResponse> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name.slice(0, 31));
  }
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
