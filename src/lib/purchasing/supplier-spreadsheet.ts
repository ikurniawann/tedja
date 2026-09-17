import { buildXlsxBuffer, parseXlsxToMatrix } from "@/lib/spreadsheet/exceljs-safe";
import { SUPPLIER_IMPORT_COLUMNS } from "@/features/purchasing/suppliers/import-config";

export const SUPPLIER_EXPORT_COLUMNS = SUPPLIER_IMPORT_COLUMNS;

export const SUPPLIER_SPREADSHEET_HEADERS = SUPPLIER_IMPORT_COLUMNS.map((col) => col.key);

const HEADER_ALIASES: Record<string, string> = {
  code: "kode",
  supplier_code: "kode",
  nama: "nama_supplier",
  name: "nama_supplier",
  supplier_name: "nama_supplier",
  contact_person: "pic_name",
  nama_pic: "pic_name",
  contact_phone: "pic_phone",
  telepon_pic: "pic_phone",
  contact_email: "pic_email",
  email_pic: "pic_email",
  phone: "telepon",
  company_phone: "telepon",
  company_email: "email",
  address: "alamat",
  city: "kota",
  tax_id: "npwp",
  payment_term: "payment_terms",
  termin_pembayaran: "payment_terms",
  mata_uang: "currency",
  bank_name: "bank_nama",
  bank_account: "bank_rekening",
  no_rekening: "bank_rekening",
  account_holder: "bank_atas_nama",
  atas_nama: "bank_atas_nama",
  category: "kategori",
  notes: "catatan",
  description: "catatan",
  deskripsi: "catatan",
};

export function normalizeSupplierSpreadsheetHeader(header: string) {
  const key = header.toLowerCase().replace(/\s+/g, "_");
  return HEADER_ALIASES[key] || key;
}

export function spreadsheetCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

export function buildSupplierExportRow(row: Record<string, unknown>) {
  return SUPPLIER_SPREADSHEET_HEADERS.map((key) => spreadsheetCell(row[key]));
}

/** Bangun buffer .xlsx ekspor Suppliers (ExcelJS, gantikan xlsx). */
export async function buildSupplierWorkbookBuffer(rows: Record<string, unknown>[]): Promise<Buffer> {
  const sheetRows = [
    SUPPLIER_SPREADSHEET_HEADERS,
    ...rows.map((row) => buildSupplierExportRow(row)),
  ];
  return buildXlsxBuffer([{ name: "Suppliers", rows: sheetRows }]);
}

function parseCSV(text: string): string[][] {
  const lines = text.split("\n").filter((line) => line.trim());
  return lines.map((line) => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else current += char;
    }
    result.push(current.trim());
    return result;
  });
}

export async function parseSupplierSpreadsheetFile(buffer: Buffer, fileName: string): Promise<string[][]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) {
    return parseCSV(buffer.toString("utf-8"));
  }
  const rows = await parseXlsxToMatrix(buffer);
  return rows.map((row) => row.map((cell) => spreadsheetCell(cell)));
}
