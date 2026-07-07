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
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { PRODUCT_IMPORT_COLUMNS } from "../import-config";
import { PRODUCT_IMPORT_SAMPLE_ROWS } from "../import-sample-rows";

export function ProductsImportPage() {
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
      router.push(PRODUCT_ROUTES.products);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await importerRef.current?.import();
  };

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.products}
        title="Import Products"
        description="Upload CSV or Excel to add products, or re-import an exported file to update existing records."
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
        id="product-import-form"
        onSubmit={handleSubmit}
        className="flex min-h-[calc(100vh-11rem)] flex-col space-y-6"
      >
        <Card className="flex min-h-0 flex-1 flex-col border-gray-200/70 shadow-xs">
          <CardHeader className="shrink-0 border-b border-gray-200/70 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4 text-pink-600" />
              Upload Spreadsheet
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col space-y-4 p-4">
            <div className="flex shrink-0 items-start gap-3 rounded-lg border border-gray-200/70 bg-gray-50/80 p-4">
              <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-pink-600" />
              <div className="text-sm text-gray-600">
                <p className="font-medium text-gray-900">Before you import</p>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  <li>Export from the product list, edit fields, then re-import the same file.</li>
                  <li>Existing codes are updated per stall; empty code creates a new product.</li>
                  <li>Supported formats: CSV and Excel (.xlsx).</li>
                  <li>
                    Required columns: product name (<strong>nama</strong>), stall code (
                    <strong>stall_code</strong>), and unit code (<strong>satuan_kode</strong>).
                  </li>
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
                title="Import Products"
                description="Upload CSV or Excel to add products in bulk."
                templateName="template-products.csv"
                apiEndpoint="/api/purchasing/import/products"
                sampleRows={PRODUCT_IMPORT_SAMPLE_ROWS}
                columns={PRODUCT_IMPORT_COLUMNS}
                onStateChange={setImportState}
                onSuccess={handleImportSuccess}
              />
            </div>
          </CardContent>
        </Card>

        <div className="shrink-0">
          <PurchasingFormFooter
            formId="product-import-form"
            onCancel={() => router.push(PRODUCT_ROUTES.products)}
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
