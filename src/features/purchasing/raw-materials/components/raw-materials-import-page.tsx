"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CsvImporter,
  type CsvImporterHandle,
  type CsvImporterState,
  type ImportResult,
} from "@/components/ui/csv-importer";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/modules/purchasing/components/page/purchasing-page-header";
import { RM_ROUTES } from "@/modules/purchasing/constants/items-nav";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { RAW_MATERIAL_IMPORT_COLUMNS } from "../import-config";
import { RAW_MATERIAL_IMPORT_SAMPLE_ROWS } from "../import-sample-rows";

export function RawMaterialsImportPage() {
  const router = useRouter();
  const importerRef = useRef<CsvImporterHandle>(null);
  const [importState, setImportState] = useState<CsvImporterState>({
    isImporting: false,
    canImport: false,
    validCount: 0,
    invalidCount: 0,
  });

  const handleImportSuccess = (result: ImportResult) => {
    const imported = Number(result?.imported ?? 0);
    const updated = Number(result?.updated ?? 0);
    const skipped = Number(result?.skipped ?? 0);

    if (imported > 0 || updated > 0) {
      const parts: string[] = [];
      if (imported > 0) {
        parts.push(`${imported} new record${imported === 1 ? "" : "s"}`);
      }
      if (updated > 0) {
        parts.push(`${updated} updated record${updated === 1 ? "" : "s"}`);
      }
      toast.success(`Import completed: ${parts.join(", ")}.`);
    } else {
      toast.success("Import completed with no changes.");
    }

    if (skipped > 0) {
      toast.warning(
        `${skipped} row${skipped === 1 ? "" : "s"} skipped. Review the results below before leaving.`
      );
      return;
    }

    if (imported > 0 || updated > 0) {
      router.push(RM_ROUTES.materials);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await importerRef.current?.import();
  };

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={RM_ROUTES.materials}
        title="Import Raw Materials"
        description="Upload CSV or Excel to add materials, or re-import an exported file to update stock and master data."
        actions={
          <Button
            type="button"
            variant="outline"
            className="purchasing-secondary-button w-full sm:w-auto"
            onClick={() => importerRef.current?.downloadTemplate()}
          >
            <Download className="mr-2 h-4 w-4" />
            Download Template
          </Button>
        }
      />

      <form
        id="raw-material-import-form"
        onSubmit={handleSubmit}
        className="flex min-h-[calc(100vh-11rem)] flex-col space-y-6"
      >
        <Card className="flex min-h-0 flex-1 flex-col border-gray-200/70 shadow-xs">
          <CardHeader className="shrink-0 border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4 text-pink-600" />
              Upload CSV File
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col space-y-4 p-4">
            <div className="shrink-0 flex items-start gap-3 rounded-lg border border-gray-200/70 bg-gray-50/80 p-4">
              <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-pink-600" />
              <div className="text-sm text-gray-600">
                <p className="font-medium text-gray-900">Before you import</p>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  <li>Export from the materials list, edit <strong>opening_stock</strong> and other fields, then re-import the same file.</li>
                  <li>Existing codes are updated; empty code creates a new material.</li>
                  <li>Stock is applied to the stall in <strong>stall_code</strong> (default MAIN).</li>
                  <li>Supported formats: CSV and Excel (.xlsx).</li>
                  <li>Required columns: name, category code, and large unit code.</li>
                </ul>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <CsvImporter
                ref={importerRef}
                embedded
                expanded
                hideHeader
                hideActions
              suppressSuccessToast
              title="Import Raw Materials"
              description="Upload CSV to add raw materials in bulk."
              templateName="template-raw-materials.csv"
              apiEndpoint="/api/purchasing/import/raw-materials"
              sampleRows={RAW_MATERIAL_IMPORT_SAMPLE_ROWS}
              columns={RAW_MATERIAL_IMPORT_COLUMNS}
              onStateChange={setImportState}
              onSuccess={handleImportSuccess}
              />
            </div>
          </CardContent>
        </Card>

        <div className="shrink-0">
          <PurchasingFormFooter
          formId="raw-material-import-form"
          onCancel={() => router.push(RM_ROUTES.materials)}
          submitLabel={
            importState.validCount > 0
              ? `Import ${importState.validCount} Record${importState.validCount === 1 ? "" : "s"}`
              : "Import"
          }
          loading={importState.isImporting}
          disabled={!importState.canImport}
          />
        </div>
      </form>
    </div>
  );
}
