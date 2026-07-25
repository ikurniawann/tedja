"use client";

// EPIC-032 A3 — dialog detail campaign: daftar kode (+tambah kode publik,
// generate batch voucher sekali-pakai, export CSV klien) + riwayat
// pemakaian 100 terbaru.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useCreateSingleCode,
  useGenerateBatch,
  usePromoCodes,
  usePromoRedemptions,
  useToggleCode,
} from "../queries";
import type { PromoCampaign, PromoCode } from "../types";

const formatRp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;
const formatTime = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const STATUS_BADGES: Record<string, string> = {
  held: "bg-amber-100 text-amber-700",
  captured: "bg-emerald-100 text-emerald-700",
  released: "bg-gray-100 text-gray-500",
};
const STATUS_LABELS: Record<string, string> = {
  held: "Menunggu bayar",
  captured: "Terpakai",
  released: "Dilepas",
};

/** Unduh daftar kode sebagai CSV — dibangun di klien, tanpa route khusus. */
function downloadCodesCsv(campaignName: string, codes: PromoCode[]) {
  const lines = [
    "code,usage_limit,usage_count,is_active",
    ...codes.map(
      (c) =>
        `${c.code},${c.usage_limit ?? ""},${c.usage_count},${c.is_active ? "1" : "0"}`
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `voucher-${campaignName.replace(/\s+/g, "-").toLowerCase()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface CampaignDetailDialogProps {
  campaign: PromoCampaign | null;
  onOpenChange: (open: boolean) => void;
}

export function CampaignDetailDialog({
  campaign,
  onOpenChange,
}: CampaignDetailDialogProps) {
  const campaignId = campaign?.id ?? null;
  const codesQuery = usePromoCodes(campaignId);
  const redemptionsQuery = usePromoRedemptions(campaignId);
  const toggleMutation = useToggleCode();

  const [singleCode, setSingleCode] = useState("");
  const [batchPrefix, setBatchPrefix] = useState("");
  const [batchCount, setBatchCount] = useState("");
  const createSingle = useCreateSingleCode(() => setSingleCode(""));
  const generateBatch = useGenerateBatch(() => {
    setBatchPrefix("");
    setBatchCount("");
  });

  const codes = codesQuery.data ?? [];
  const redemptions = redemptionsQuery.data ?? [];
  const batchCountNum = Number(batchCount);
  const batchInvalid =
    !/^[A-Za-z0-9]{2,12}$/.test(batchPrefix.trim()) ||
    Number.isNaN(batchCountNum) ||
    batchCountNum < 1 ||
    batchCountNum > 1000;

  return (
    <Dialog open={campaign !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Kode & Riwayat — {campaign?.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Tambah kode */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 rounded-xl border border-gray-200/70 p-3">
              <Label htmlFor="single_code">Kode Publik Baru</Label>
              <div className="flex gap-2">
                <Input
                  id="single_code"
                  placeholder="mis. MERDEKA45"
                  value={singleCode}
                  onChange={(e) => setSingleCode(e.target.value.toUpperCase())}
                />
                <Button
                  size="sm"
                  disabled={
                    !/^[A-Za-z0-9-]{3,40}$/.test(singleCode.trim()) ||
                    createSingle.isPending ||
                    !campaignId
                  }
                  onClick={() =>
                    campaignId &&
                    createSingle.mutate({
                      campaignId,
                      code: singleCode.trim(),
                      usageLimit: null,
                    })
                  }
                >
                  Tambah
                </Button>
              </div>
              <p className="text-xs text-gray-500">
                Kode publik ikut kuota campaign (bisa dipakai berulang).
              </p>
            </div>
            <div className="space-y-1.5 rounded-xl border border-gray-200/70 p-3">
              <Label>Generate Batch Voucher (sekali pakai)</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Prefix — mis. GIFT"
                  value={batchPrefix}
                  onChange={(e) => setBatchPrefix(e.target.value.toUpperCase())}
                  className="w-32"
                />
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  placeholder="Jumlah"
                  value={batchCount}
                  onChange={(e) =>
                    setBatchCount(e.target.value.replace(/\D/g, ""))
                  }
                />
                <Button
                  size="sm"
                  disabled={batchInvalid || generateBatch.isPending || !campaignId}
                  onClick={() =>
                    campaignId &&
                    generateBatch.mutate({
                      campaignId,
                      prefix: batchPrefix.trim(),
                      count: batchCountNum,
                    })
                  }
                >
                  {generateBatch.isPending ? "…" : "Generate"}
                </Button>
              </div>
              <p className="text-xs text-gray-500">
                Maks 1000/batch — tiap kode mati setelah dipakai sekali.
              </p>
            </div>
          </div>

          {/* Daftar kode */}
          <div>
            <div className="flex items-center justify-between">
              <Label>Kode ({codes.length})</Label>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={codes.length === 0 || !campaign}
                onClick={() => campaign && downloadCodesCsv(campaign.name, codes)}
              >
                Export CSV
              </Button>
            </div>
            {codesQuery.isLoading ? (
              <div className="py-6 text-center">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-pink-600" />
              </div>
            ) : codes.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-gray-500">
                Belum ada kode di campaign ini
              </p>
            ) : (
              <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {codes.map((code) => (
                  <div
                    key={code.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-gray-200/70 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold text-gray-900">
                        {code.code}
                      </p>
                      <p className="text-xs text-gray-500">
                        terpakai {code.usage_count}
                        {code.usage_limit !== null ? `/${code.usage_limit}` : ""}
                      </p>
                    </div>
                    <Switch
                      checked={code.is_active}
                      disabled={toggleMutation.isPending}
                      onCheckedChange={(checked) =>
                        toggleMutation.mutate({ id: code.id, isActive: checked })
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Riwayat pemakaian */}
          <div>
            <Label>Riwayat Pemakaian (100 terbaru)</Label>
            {redemptionsQuery.isLoading ? (
              <div className="py-6 text-center">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-pink-600" />
              </div>
            ) : redemptions.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-gray-500">
                Belum ada pemakaian
              </p>
            ) : (
              <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {redemptions.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-gray-200/70 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold text-gray-900">
                        {r.code}
                      </p>
                      <p className="text-xs text-gray-500">
                        {r.phone ?? "tanpa nomor"} · {formatTime(r.created_at)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-medium tabular-nums text-gray-900">
                        −{formatRp(Number(r.discount_amount))}
                      </p>
                      <Badge
                        className={`border-0 font-normal ${STATUS_BADGES[r.status]}`}
                      >
                        {STATUS_LABELS[r.status]}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
