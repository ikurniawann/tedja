import { buildXlsxBuffer, parseXlsxToMatrix } from "@/lib/spreadsheet/exceljs-safe";
import { RAW_MATERIAL_IMPORT_COLUMNS } from "@/features/purchasing/raw-materials/import-config";

export const RAW_MATERIAL_EXPORT_COLUMNS = RAW_MATERIAL_IMPORT_COLUMNS;

export const RAW_MATERIAL_SPREADSHEET_HEADERS = RAW_MATERIAL_IMPORT_COLUMNS.map(
  (col) => col.key
);

const HEADER_ALIASES: Record<string, string> = {
  code: "kode",
  name: "nama",
  category: "kategori",
  category_code: "kategori",
  purchase_unit: "satuan_besar_kode",
  satuan_pembelian: "satuan_besar_kode",
  large_unit_code: "satuan_besar_kode",
  usage_unit: "satuan_kecil_kode",
  satuan_penggunaan: "satuan_kecil_kode",
  small_unit_code: "satuan_kecil_kode",
  conversion_factor: "konversi_factor",
  qty_per_unit: "konversi_factor",
  minimum_stock: "stok_minimum",
  maximum_stock: "stok_maximum",
  stok_maksimum: "stok_maximum",
  "shelf_life_(days)": "shelf_life_days",
  shelf_life_days: "shelf_life_days",
  masa_simpan: "shelf_life_days",
  purchase_price: "harga_beli",
  harga_rata_rata: "harga_beli",
  description: "deskripsi",
  opening_stock: "opening_stock",
  initial_stock: "opening_stock",
  stok_awal: "opening_stock",
  qty_onhand: "opening_stock",
  stall_code: "stall_code",
  warehouse_code: "stall_code",
  warehouse_kode: "stall_code",
  gudang_kode: "stall_code",
};

export function normalizeSpreadsheetHeader(header: string) {
  const key = header.toLowerCase().replace(/\s+/g, "_");
  return HEADER_ALIASES[key] || key;
}

export function spreadsheetCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

export function buildRawMaterialExportRow(row: Record<string, unknown>) {
  return RAW_MATERIAL_SPREADSHEET_HEADERS.map((key) => spreadsheetCell(row[key]));
}

/** Bangun buffer .xlsx ekspor Raw Materials (ExcelJS, gantikan xlsx). */
export async function buildRawMaterialWorkbookBuffer(rows: Record<string, unknown>[]): Promise<Buffer> {
  const sheetRows = [
    RAW_MATERIAL_SPREADSHEET_HEADERS,
    ...rows.map((row) => buildRawMaterialExportRow(row)),
  ];
  return buildXlsxBuffer([{ name: "Raw Materials", rows: sheetRows }]);
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

export async function parseSpreadsheetFile(buffer: Buffer, fileName: string): Promise<string[][]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) {
    return parseCSV(buffer.toString("utf-8"));
  }
  const rows = await parseXlsxToMatrix(buffer);
  return rows.map((row) => row.map((cell) => spreadsheetCell(cell)));
}
