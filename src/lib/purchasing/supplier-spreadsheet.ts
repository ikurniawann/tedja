import * as XLSX from "xlsx";
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

export function buildSupplierWorkbook(rows: Record<string, unknown>[]) {
  const sheetRows = [
    SUPPLIER_SPREADSHEET_HEADERS,
    ...rows.map((row) => buildSupplierExportRow(row)),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Suppliers");
  return workbook;
}

export function workbookToBuffer(workbook: XLSX.WorkBook) {
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
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

export function parseSupplierSpreadsheetFile(buffer: Buffer, fileName: string): string[][] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) {
    return parseCSV(buffer.toString("utf-8"));
  }

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  return rows.map((row) => row.map((cell) => spreadsheetCell(cell)));
}
