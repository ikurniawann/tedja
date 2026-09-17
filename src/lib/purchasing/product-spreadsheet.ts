import { buildXlsxBuffer, parseXlsxToMatrix } from "@/lib/spreadsheet/exceljs-safe";
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

/** Bangun buffer .xlsx ekspor Products (ExcelJS, gantikan xlsx). */
export async function buildProductWorkbookBuffer(rows: Record<string, unknown>[]): Promise<Buffer> {
  const sheetRows = [
    PRODUCT_SPREADSHEET_HEADERS,
    ...rows.map((row) => buildProductExportRow(row)),
  ];
  return buildXlsxBuffer([{ name: "Products", rows: sheetRows }]);
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

export async function parseProductSpreadsheetFile(buffer: Buffer, fileName: string): Promise<string[][]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) {
    return parseCSV(buffer.toString("utf-8"));
  }
  const rows = await parseXlsxToMatrix(buffer);
  return rows.map((row) => row.map((cell) => spreadsheetCell(cell)));
}
