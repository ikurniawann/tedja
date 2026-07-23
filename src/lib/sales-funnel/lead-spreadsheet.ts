import * as XLSX from "xlsx";
import { LEAD_IMPORT_COLUMNS } from "@/features/sales-funnel/leads/import-config";

export const LEAD_SPREADSHEET_HEADERS = LEAD_IMPORT_COLUMNS.map((col) => col.key);

const HEADER_ALIASES: Record<string, string> = {
  org_name: "nama_instansi",
  instansi: "nama_instansi",
  company: "nama_instansi",
  org_type: "jenis_instansi",
  jenis: "jenis_instansi",
  pic_name: "nama_pic",
  pic: "nama_pic",
  contact_person: "nama_pic",
  pic_title: "jabatan_pic",
  jabatan: "jabatan_pic",
  pic_phone: "wa_pic",
  phone: "wa_pic",
  no_wa: "wa_pic",
  telepon: "wa_pic",
  pic_email: "email_pic",
  email: "email_pic",
  city: "kota",
  source: "sumber",
  temperature: "suhu",
  notes: "catatan",
  keterangan: "catatan",
};

export function normalizeLeadSpreadsheetHeader(header: string): string {
  const key = header.trim().toLowerCase().replace(/\s+/g, "_");
  return HEADER_ALIASES[key] ?? key;
}

/** Parse file CSV/XLSX menjadi matriks string (baris pertama = header). */
export function parseLeadSpreadsheetFile(
  buffer: Buffer,
  fileName: string
): string[][] {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    raw: false,
    codepage: fileName.toLowerCase().endsWith(".csv") ? 65001 : undefined,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  return rows.map((row) => row.map((cell) => String(cell ?? "").trim()));
}
