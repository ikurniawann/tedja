import * as XLSX from "xlsx";
import { PRODUCT_IMPORT_COLUMNS } from "@/features/purchasing/products/import-config";

export const PRODUCT_EXPORT_COLUMNS = PRODUCT_IMPORT_COLUMNS;

export const PRODUCT_SPREADSHEET_HEADERS = PRODUCT_IMPORT_COLUMNS.map((col) => col.key);

const HEADER_ALIASES: Record<string, string> = {
  code: "kode",
  product_code: "kode",
  kode_produk: "kode",
  name: "nama",
  product_name: "nama",
  nama_produk: "nama",
  category: "kategori",
  category_code: "kategori",
  unit: "satuan_kode",
  unit_code: "satuan_kode",
  satuan: "satuan_kode",
  description: "deskripsi",
  notes: "deskripsi",
  selling_price: "harga_jual",
  price: "harga_jual",
  cost_price: "harga_modal",
  cost: "harga_modal",
  markup: "markup_persen",
  markup_percent: "markup_persen",
  output_type: "production_output_type",
  production_type: "production_output_type",
  stall: "stall_code",
  stall_code: "stall_code",
  warehouse: "stall_code",
  warehouse_code: "stall_code",
};

export function normalizeProductSpreadsheetHeader(header: string) {
  const key = header.toLowerCase().replace(/\s+/g, "_");
  return HEADER_ALIASES[key] || key;
}

export function spreadsheetCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

export function buildProductExportRow(row: Record<string, unknown>) {
  return PRODUCT_SPREADSHEET_HEADERS.map((key) => spreadsheetCell(row[key]));
}

export function buildProductWorkbook(rows: Record<string, unknown>[]) {
  const sheetRows = [
    PRODUCT_SPREADSHEET_HEADERS,
    ...rows.map((row) => buildProductExportRow(row)),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
  return workbook;
}

export function workbookToBuffer(workbook: XLSX.WorkBook): Uint8Array {
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Uint8Array(buffer);
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

export function parseProductSpreadsheetFile(buffer: Buffer, fileName: string): string[][] {
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
