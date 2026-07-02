"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Upload, Download, FileText, CheckCircle, XCircle, AlertCircle, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";

interface CsvImporterProps {
  title: string;
  description: string;
  templateName: string;
  apiEndpoint: string;
  onSuccess?: (result: any) => void;
  columns: Array<{
    key: string;
    label: string;
    required?: boolean;
    type?: "text" | "number" | "date" | "email";
    description?: string;
  }>;
}

interface PreviewRow {
  rowNumber: number;
  data: Record<string, string>;
  isValid: boolean;
  errors: string[];
}

interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: Array<{
    row: number;
    message: string;
  }>;
}

export function CsvImporter({
  title,
  description,
  templateName,
  apiEndpoint,
  onSuccess,
  columns,
}: CsvImporterProps) {
  const { toast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<PreviewRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const headers = columns.map((col) => col.label).join(",");
    const exampleRow = columns
      .map((col) => {
        if (col.key === "email") return "email@example.com";
        if (col.key === "status") return "Active";
        if (col.type === "number") return "0";
        if (col.type === "date") return "YYYY-MM-DD";
        return `Contoh ${col.label}`;
      })
      .join(",");
    
    const csvContent = `${headers}\n${exampleRow}`;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = templateName;
    link.click();
  };

  const parseCSV = (text: string): string[][] => {
    const lines = text.split("\n").filter((line) => line.trim());
    return lines.map((line) => {
      const result: string[] = [];
      let current = "";
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
          result.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    });
  };

  const validateRow = (row: Record<string, string>, rowNumber: number): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];
    
    columns.forEach((col) => {
      const value = row[col.key]?.trim();
      
      if (col.required && !value) {
        errors.push(`${col.label} wajib diisi`);
      }
      
      if (value) {
        if (col.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          errors.push(`${col.label} harus email yang valid`);
        }
        
        if (col.type === "number" && isNaN(Number(value))) {
          errors.push(`${col.label} harus angka`);
        }
        
        if (col.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          errors.push(`${col.label} harus format YYYY-MM-DD`);
        }
      }
    });
    
    return { isValid: errors.length === 0, errors };
  };

  const handleFile = useCallback((selectedFile: File) => {
    if (selectedFile.type !== "text/csv" && !selectedFile.name.endsWith(".csv")) {
      toast({
        title: "Format tidak valid",
        description: "File harus berformat CSV",
        variant: "destructive",
      });
      return;
    }

    setFile(selectedFile);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseCSV(text);
      
      if (rows.length < 2) {
        toast({
          title: "File kosong",
          description: "File CSV harus memiliki header dan minimal 1 data",
          variant: "destructive",
        });
        return;
      }

      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, "_"));
      const preview: PreviewRow[] = [];

      for (let i = 1; i < rows.length; i++) {
        const rowData: Record<string, string> = {};
        headers.forEach((header, index) => {
          rowData[header] = rows[i][index] || "";
        });

        const validation = validateRow(rowData, i + 1);
        preview.push({
          rowNumber: i + 1,
          data: rowData,
          ...validation,
        });
      }

      setPreviewData(preview);
    };

    reader.readAsText(selectedFile);
  }, [toast, columns]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFile(droppedFile);
    }
  }, [handleFile]);

  const handleImport = async () => {
    if (!file || previewData.length === 0) return;

    setIsImporting(true);
    
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("columns", JSON.stringify(columns));

      const response = await fetch(apiEndpoint, {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Import gagal");
      }

      setImportResult(result);
      
      toast({
        title: "Import berhasil",
        description: `${result.imported} data berhasil diimport`,
      });

      onSuccess?.(result);
    } catch (error: any) {
      toast({
        title: "Import gagal",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const resetImport = () => {
    setFile(null);
    setPreviewData([]);
    setImportResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const validCount = previewData.filter((r) => r.isValid).length;
  const invalidCount = previewData.filter((r) => !r.isValid).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-pink-600" />
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Button variant="outline" onClick={downloadTemplate} size="sm">
            <Download className="w-4 h-4 mr-2" />
            Download Template
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!file ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging
                ? "border-pink-500 bg-pink-50"
                : "border-gray-300 hover:border-gray-400"
            }`}
          >
            <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
            <p className="text-sm text-gray-600 mb-2">
              Drag & drop file CSV di sini, atau
            </p>
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              Pilih File
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const selectedFile = e.target.files?.[0];
                if (selectedFile) {
                  handleFile(selectedFile);
                }
              }}
            />
            <p className="text-xs text-gray-500 mt-4">
              Format: CSV (Comma Separated Values)
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-3">
                <FileText className="w-8 h-8 text-pink-600" />
                <div>
                  <p className="font-medium text-sm">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024).toFixed(2)} KB • {previewData.length} rows
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={validCount > 0 ? "default" : "secondary"}>
                  <CheckCircle className="w-3 h-3 mr-1" />
                  {validCount} valid
                </Badge>
                {invalidCount > 0 && (
                  <Badge variant="destructive">
                    <XCircle className="w-3 h-3 mr-1" />
                    {invalidCount} error
                  </Badge>
                )}
                <Button variant="ghost" size="icon" onClick={resetImport}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {importResult ? (
              <div className="space-y-3">
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                    <span className="font-medium text-green-900">Import Selesai</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-green-700">Berhasil:</span>
                      <span className="ml-2 font-semibold">{importResult.imported}</span>
                    </div>
                    <div>
                      <span className="text-green-700">Dilewati:</span>
                      <span className="ml-2 font-semibold">{importResult.skipped}</span>
                    </div>
                  </div>
                </div>

                {importResult.errors && importResult.errors.length > 0 && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="w-5 h-5 text-red-600" />
                      <span className="font-medium text-red-900">Error ({importResult.errors.length})</span>
                    </div>
                    <div className="space-y-1 text-sm text-red-800 max-h-40 overflow-y-auto">
                      {importResult.errors.slice(0, 10).map((err, idx) => (
                        <div key={idx}>
                          Row {err.row}: {err.message}
                        </div>
                      ))}
                      {importResult.errors.length > 10 && (
                        <p className="text-xs text-red-600">
                          ...dan {importResult.errors.length - 10} error lainnya
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <Button onClick={resetImport} variant="outline" className="w-full">
                  Import File Lain
                </Button>
              </div>
            ) : (
              <>
                {previewData.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2 border-b">
                      <p className="text-sm font-medium">Preview Data</p>
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left px-4 py-2 font-medium text-gray-600">#</th>
                            {columns.slice(0, 5).map((col) => (
                              <th key={col.key} className="text-left px-4 py-2 font-medium text-gray-600">
                                {col.label}
                              </th>
                            ))}
                            <th className="text-left px-4 py-2 font-medium text-gray-600">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {previewData.slice(0, 10).map((row) => (
                            <tr key={row.rowNumber} className={row.isValid ? "" : "bg-red-50"}>
                              <td className="px-4 py-2 text-gray-500">{row.rowNumber}</td>
                              {columns.slice(0, 5).map((col) => (
                                <td key={col.key} className="px-4 py-2 text-gray-900">
                                  {row.data[col.key] || "-"}
                                </td>
                              ))}
                              <td className="px-4 py-2">
                                {row.isValid ? (
                                  <Badge variant="outline" className="text-green-600 border-green-600">
                                    <CheckCircle className="w-3 h-3 mr-1" />
                                    Valid
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-red-600 border-red-600">
                                    <XCircle className="w-3 h-3 mr-1" />
                                    {row.errors.length} error
                                  </Badge>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {previewData.length > 10 && (
                        <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500 text-center">
                          ...dan {previewData.length - 10} row lainnya
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <Button variant="outline" onClick={resetImport} className="flex-1">
                    Cancel
                  </Button>
                  <Button
                    onClick={handleImport}
                    disabled={isImporting || invalidCount > 0}
                    className="flex-1"
                  >
                    {isImporting ? (
                      <>
                        <Progress className="w-32 mr-2" value={undefined} />
                        Mengimport...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Import {validCount} Data
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
