"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useGrn, useGrnQC } from "../queries";
import { useCreateQCInspection } from "../mutations";
import { resolveOverallQcStatus } from "@/lib/purchasing/grn-qc-utils";
import { RM_ROUTES, PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import type { PurchasingModuleType } from "../api";
import {
  PurchasingFormFooter,
  PurchasingFormHeader,
} from "@/modules/purchasing/components/page/purchasing-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Package,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

const QC_PARAMETERS = [
  "Packaging",
  "Label",
  "Color",
  "Odor",
  "Texture",
  "Moisture",
  "Expiry Date",
] as const;

type QcLineState = {
  grn_item_id: string;
  raw_material_id: string;
  materialName: string;
  materialCode: string;
  unitLabel: string;
  qtyReceived: number;
  qty_inspected: string;
  qty_accepted: string;
  qty_rejected: string;
  catatan: string;
};

type GrnInspectionItem = {
  id: string;
  raw_material_id?: string;
  qty_diterima?: number | null;
  qc_status?: string | null;
  raw_material?: {
    nama?: string | null;
    kode?: string | null;
    satuan_besar?: { nama?: string | null; kode?: string | null } | null;
  } | null;
  satuan?: { nama?: string | null; kode?: string | null } | null;
  purchase_order_item?: {
    satuan?: { nama?: string | null; kode?: string | null } | null;
  } | null;
};

type GrnInspection = {
  id: string;
  nomor_grn?: string | null;
  status?: string | null;
  tanggal_penerimaan?: string | null;
  po_number?: string | null;
  supplier_name?: string | null;
  total_item_diterima?: number | null;
  items?: GrnInspectionItem[];
};

type ExistingQc = {
  id: string;
  status?: string | null;
  inventory_posted?: boolean | null;
  inspected_at?: string | null;
};

function formatNumber(value?: number | null) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function parseQty(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusBadge(status: string) {
  const normalized = status.toLowerCase();
  const styles: Record<string, string> = {
    approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
    partial: "border-amber-200 bg-amber-50 text-amber-700",
    rejected: "border-red-200 bg-red-50 text-red-700",
    pending: "border-slate-200 bg-slate-100 text-slate-700",
  };
  const labels: Record<string, string> = {
    approved: "Approved",
    partial: "Partial",
    rejected: "Rejected",
    pending: "Pending",
  };
  return (
    <Badge variant="outline" className={styles[normalized] || styles.pending}>
      {labels[normalized] || status}
    </Badge>
  );
}

export function QCInspectionPage({
  moduleType = "raw_material",
}: {
  moduleType?: PurchasingModuleType;
}) {
  const isProduct = moduleType === "product";
  const listRoute = isProduct ? PRODUCT_ROUTES.purchasingReceive : RM_ROUTES.purchasingGrn;
  const detailRoute = (id: string) =>
    isProduct ? PRODUCT_ROUTES.purchasingReceiveDetail(id) : RM_ROUTES.purchasingGrnDetail(id);

  const params = useParams();
  const router = useRouter();
  const grnId = params.id as string;

  const grnQuery = useGrn<GrnInspection>(grnId);
  const qcQuery = useGrnQC<ExistingQc | null>(grnId);
  const grn = grnQuery.data ?? null;
  const existingQc = qcQuery.data ?? null;
  const loading = grnQuery.isLoading || qcQuery.isLoading;

  const qcMutation = useCreateQCInspection();
  const saving = qcMutation.isPending;

  const [lines, setLines] = useState<QcLineState[]>([]);
  const [hasilInspeksi, setHasilInspeksi] = useState<Record<string, string>>({});
  const [catatan, setCatatan] = useState("");

  useEffect(() => {
    if (grnQuery.isError) {
      toast.error("Failed to load goods receipt");
    }
  }, [grnQuery.isError]);

  useEffect(() => {
    const initialHasil: Record<string, string> = {};
    QC_PARAMETERS.forEach((param) => {
      initialHasil[param] = "OK";
    });
    setHasilInspeksi(initialHasil);
  }, []);

  useEffect(() => {
    if (!grn?.items?.length) return;

    setLines(
      grn.items
        .filter((item) => Number(item.qty_diterima || 0) > 0)
        .map((item) => {
          const qty = Number(item.qty_diterima || 0);
          const unit =
            item.satuan?.kode ||
            item.satuan?.nama ||
            item.raw_material?.satuan_besar?.kode ||
            item.purchase_order_item?.satuan?.kode ||
            "-";

          return {
            grn_item_id: item.id,
            raw_material_id: item.raw_material_id || "",
            materialName: item.raw_material?.nama || "Unknown material",
            materialCode: item.raw_material?.kode || "-",
            unitLabel: unit,
            qtyReceived: qty,
            qty_inspected: String(qty),
            qty_accepted: String(qty),
            qty_rejected: "0",
            catatan: "",
          };
        })
    );
  }, [grn?.items]);

  const overallStatus = useMemo(() => {
    const payload = lines.map((line) => ({
      grn_item_id: line.grn_item_id,
      raw_material_id: line.raw_material_id,
      qty_inspected: parseQty(line.qty_inspected),
      qty_accepted: parseQty(line.qty_accepted),
      qty_rejected: parseQty(line.qty_rejected),
    }));
    return resolveOverallQcStatus(payload);
  }, [lines]);

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => ({
        inspected: acc.inspected + parseQty(line.qty_inspected),
        accepted: acc.accepted + parseQty(line.qty_accepted),
        rejected: acc.rejected + parseQty(line.qty_rejected),
      }),
      { inspected: 0, accepted: 0, rejected: 0 }
    );
  }, [lines]);

  const parameterSummary = useMemo(() => {
    const values = Object.values(hasilInspeksi);
    return {
      ok: values.filter((value) => value === "OK").length,
      ng: values.filter((value) => value === "NG").length,
      na: values.filter((value) => value === "NA").length,
    };
  }, [hasilInspeksi]);

  const qcLocked =
    existingQc?.inventory_posted === true || (grn?.status && grn.status !== "pending");

  const syncAcceptedRejected = (
    grnItemId: string,
    next: { inspected?: string; accepted?: string; rejected?: string }
  ) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.grn_item_id !== grnItemId) return line;

        const inspected = parseQty(next.inspected ?? line.qty_inspected);
        const maxQty = line.qtyReceived;

        if (next.accepted !== undefined) {
          const accepted = Math.min(maxQty, Math.max(0, parseQty(next.accepted)));
          const rejected = Math.max(0, inspected - accepted);
          return {
            ...line,
            qty_inspected: String(Math.min(maxQty, inspected)),
            qty_accepted: String(accepted),
            qty_rejected: String(rejected),
          };
        }

        if (next.rejected !== undefined) {
          const rejected = Math.min(maxQty, Math.max(0, parseQty(next.rejected)));
          const inspectedValue = Math.min(maxQty, parseQty(next.inspected ?? line.qty_inspected));
          const accepted = Math.max(0, inspectedValue - rejected);
          return {
            ...line,
            qty_inspected: String(inspectedValue),
            qty_accepted: String(accepted),
            qty_rejected: String(rejected),
          };
        }

        const inspectedValue = Math.min(maxQty, Math.max(0, inspected));
        const accepted = Math.min(parseQty(line.qty_accepted), inspectedValue);
        const rejected = Math.max(0, inspectedValue - accepted);
        return {
          ...line,
          qty_inspected: String(inspectedValue),
          qty_accepted: String(accepted),
          qty_rejected: String(rejected),
        };
      })
    );
  };

  const validateForm = () => {
    if (lines.length === 0) {
      toast.error("No received items available for quality control");
      return false;
    }

    for (const line of lines) {
      const inspected = parseQty(line.qty_inspected);
      const accepted = parseQty(line.qty_accepted);
      const rejected = parseQty(line.qty_rejected);

      if (inspected <= 0) {
        toast.error(`Inspected quantity is required for ${line.materialName}`);
        return false;
      }

      if (inspected > line.qtyReceived + 0.0001) {
        toast.error(`Inspected quantity cannot exceed received quantity for ${line.materialName}`);
        return false;
      }

      if (Math.abs(accepted + rejected - inspected) > 0.0001) {
        toast.error(`Accepted and rejected quantities must match inspected quantity for ${line.materialName}`);
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (qcLocked) {
      toast.error("Quality control has already been completed for this goods receipt");
      return;
    }
    if (!validateForm()) return;

    const items = lines.map((line) => ({
      grn_item_id: line.grn_item_id,
      raw_material_id: line.raw_material_id,
      qty_inspected: parseQty(line.qty_inspected),
      qty_accepted: parseQty(line.qty_accepted),
      qty_rejected: parseQty(line.qty_rejected),
      catatan: line.catatan || null,
    }));

    const rekomendasi =
      overallStatus === "rejected" ? "REJECT" : overallStatus === "partial" ? "REWORK" : "ACCEPT";

    try {
      await qcMutation.mutateAsync({
        grnId,
        payload: {
          status: overallStatus,
          parameter_inspeksi: { parameters: [...QC_PARAMETERS] },
          hasil_inspeksi: hasilInspeksi,
          catatan: catatan || null,
          rekomendasi,
          items,
        },
      });

      toast.success("Quality control completed. Stock has been updated.");
      router.push(detailRoute(grnId));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to submit quality control");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-pink-600" />
        Loading quality control workspace...
      </div>
    );
  }

  if (!grn) {
    return (
      <div className="space-y-4">
        <PurchasingFormHeader
          backHref={listRoute}
          title="Quality Control"
          description="Goods receipt not found"
        />
        <Card className="border-gray-200/70">
          <CardContent className="py-12 text-center text-gray-500">
            Unable to load goods receipt data.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={detailRoute(grnId)}
        title="Quality Control"
        description={
          <>
            Inspect received goods for{" "}
            <span className="font-medium text-gray-700">{grn.nomor_grn}</span> before stock is
            posted to inventory.
          </>
        }
        actions={
          qcLocked ? (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              QC Completed
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
              Awaiting Inspection
            </Badge>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-gray-500">Receipt Date</p>
            <p className="text-sm font-medium text-gray-900">{formatDate(grn.tanggal_penerimaan)}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-gray-500">Purchase Order</p>
            <p className="text-sm font-medium text-gray-900">{grn.po_number || "-"}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-gray-500">Good Qty Received</p>
            <p className="text-sm font-medium text-gray-900">{formatNumber(grn.total_item_diterima)}</p>
          </CardContent>
        </Card>
      </div>

      {qcLocked && (
        <Card className="border-emerald-200/80 bg-emerald-50/50">
          <CardContent className="flex items-start gap-3 p-4 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Inspection already completed</p>
              <p className="mt-1 text-emerald-700/90">
                Stock was posted on {formatDate(existingQc?.inspected_at)}. View the goods receipt
                detail for the final result.
              </p>
              <Link href={detailRoute(grnId)} className="mt-2 inline-block">
                <Button variant="outline" size="sm" className="purchasing-secondary-button">
                  View Goods Receipt
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <form id="grn-qc-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-4 w-4 text-pink-600" />
                  Line Item Inspection
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200/70 bg-gray-50/80 text-left text-xs text-gray-500">
                        <th className="px-4 py-3 font-medium">Material</th>
                        <th className="px-4 py-3 font-medium text-right">Received</th>
                        <th className="px-4 py-3 font-medium text-right">Inspected</th>
                        <th className="px-4 py-3 font-medium text-right">Accepted</th>
                        <th className="px-4 py-3 font-medium text-right">Rejected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => (
                        <tr
                          key={line.grn_item_id}
                          className="border-b border-gray-200/60 align-top hover:bg-gray-50/50"
                        >
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">{line.materialName}</p>
                            <p className="text-xs text-gray-500">
                              {line.materialCode} · {line.unitLabel}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-gray-900">
                            {formatNumber(line.qtyReceived)}
                          </td>
                          <td className="px-4 py-3">
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              value={line.qty_inspected}
                              disabled={qcLocked || saving}
                              onChange={(e) =>
                                syncAcceptedRejected(line.grn_item_id, { inspected: e.target.value })
                              }
                              className="h-9 text-right"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              value={line.qty_accepted}
                              disabled={qcLocked || saving}
                              onChange={(e) =>
                                syncAcceptedRejected(line.grn_item_id, { accepted: e.target.value })
                              }
                              className="h-9 text-right border-emerald-200/80 focus-visible:ring-emerald-200"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              value={line.qty_rejected}
                              disabled={qcLocked || saving}
                              onChange={(e) =>
                                syncAcceptedRejected(line.grn_item_id, { rejected: e.target.value })
                              }
                              className="h-9 text-right border-red-200/80 focus-visible:ring-red-200"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardCheck className="h-4 w-4 text-pink-600" />
                  Inspection Parameters
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 pt-4 sm:grid-cols-2">
                {QC_PARAMETERS.map((param) => (
                  <div
                    key={param}
                    className="flex items-center justify-between rounded-xl border border-gray-200/70 bg-gray-50/50 px-3 py-2.5"
                  >
                    <span className="text-sm font-medium text-gray-800">{param}</span>
                    <Select
                      value={hasilInspeksi[param] || "OK"}
                      onValueChange={(value) =>
                        setHasilInspeksi((prev) => ({ ...prev, [param]: value }))
                      }
                    >
                      <SelectTrigger
                        className="h-8 w-[120px] border-gray-200/80"
                        disabled={qcLocked || saving}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="OK">OK</SelectItem>
                        <SelectItem value="NG">NG</SelectItem>
                        <SelectItem value="NA">N/A</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <Label htmlFor="qc-notes" className="sr-only">
                  QC notes
                </Label>
                <Textarea
                  id="qc-notes"
                  value={catatan}
                  onChange={(e) => setCatatan(e.target.value)}
                  placeholder="Add inspection notes, defects found, or follow-up actions..."
                  rows={4}
                  disabled={qcLocked || saving}
                  className="border-gray-200/80"
                />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6 xl:col-span-4">
            <Card className="border-gray-200/70 shadow-xs">
              <CardHeader className="border-b border-gray-200/70 pb-3">
                <CardTitle className="text-base">Inspection Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Overall Result</span>
                  {statusBadge(overallStatus)}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-gray-200/70 bg-gray-50/70 px-3 py-2 text-center">
                    <p className="text-xs text-gray-500">Inspected</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">
                      {formatNumber(totals.inspected)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-center">
                    <p className="text-xs text-emerald-700">Accepted</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-800">
                      {formatNumber(totals.accepted)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-center">
                    <p className="text-xs text-red-700">Rejected</p>
                    <p className="mt-1 text-sm font-semibold text-red-700">
                      {formatNumber(totals.rejected)}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 border-t border-gray-200/70 pt-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Parameters OK</span>
                    <span className="font-medium text-emerald-700">{parameterSummary.ok}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Parameters NG</span>
                    <span className="font-medium text-red-600">{parameterSummary.ng}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Parameters N/A</span>
                    <span className="font-medium text-gray-700">{parameterSummary.na}</span>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Recommendation
                  </p>
                  <div className="mt-2 text-sm font-medium">
                    {overallStatus === "approved" && (
                      <span className="flex items-center gap-2 text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" />
                        Accept and post stock
                      </span>
                    )}
                    {overallStatus === "rejected" && (
                      <span className="flex items-center gap-2 text-red-600">
                        <XCircle className="h-4 w-4" />
                        Reject — no stock movement
                      </span>
                    )}
                    {overallStatus === "partial" && (
                      <span className="flex items-center gap-2 text-amber-700">
                        <AlertTriangle className="h-4 w-4" />
                        Partial accept — post accepted qty only
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-gray-200/70 bg-gray-50/40 shadow-xs">
              <CardContent className="space-y-2 p-4 text-sm text-gray-600">
                <p className="font-medium text-gray-900">Before you submit</p>
                <ul className="list-disc space-y-1 pl-5 text-xs leading-5">
                  <li>Accepted quantity will be posted to warehouse stock.</li>
                  <li>Rejected quantity will not enter available inventory.</li>
                  <li>Inspection results are linked to this goods receipt permanently.</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>

        {!qcLocked && (
          <PurchasingFormFooter
            formId="grn-qc-form"
            onCancel={() => router.push(detailRoute(grnId))}
            submitLabel="Complete Quality Control"
            loading={saving}
            disabled={lines.length === 0}
          />
        )}
      </form>
    </div>
  );
}
