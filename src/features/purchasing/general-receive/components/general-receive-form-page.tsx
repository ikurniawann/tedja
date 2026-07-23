"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { GENERAL_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { ArrowLeft, PackageCheck, Boxes, Receipt } from "lucide-react";
import { toast } from "sonner";
import { toQty } from "@/lib/purchasing/utils";
import {
  getGeneralPOForReceive,
  listWarehouses,
  createGeneralGrn,
  type GeneralGrnItemPayload,
} from "../api";
import type { GeneralPODetail, GeneralPODetailItem } from "../../general-po/types";

interface ReceiveLine {
  poItemId: string;
  supplyItemId: string;
  satuanId?: string;
  kode: string;
  nama: string;
  stockable: boolean;
  ordered: number;
  received: number;
  remaining: number;
  qtyDiterima: string;
}

function buildLines(items: GeneralPODetailItem[]): ReceiveLine[] {
  return items
    .filter((item) => item.supply_item_id)
    .map((item) => {
      const ordered = toQty(item.qty_ordered);
      const received = toQty(item.qty_received);
      const remaining = Math.max(0, ordered - received);
      return {
        poItemId: item.id,
        supplyItemId: item.supply_item_id as string,
        satuanId: item.satuan_id ?? undefined,
        kode: item.supply_item?.kode ?? "-",
        nama: item.supply_item?.nama ?? "Item",
        stockable: Boolean(item.supply_item?.stockable),
        ordered,
        received,
        remaining,
        qtyDiterima: remaining > 0 ? String(remaining) : "0",
      };
    });
}

export function GeneralReceiveFormPage({ poId }: { poId: string }) {
  const router = useRouter();
  const [po, setPo] = useState<GeneralPODetail | null>(null);
  const [lines, setLines] = useState<ReceiveLine[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string; code: string }[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [catatan, setCatatan] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getGeneralPOForReceive(poId), listWarehouses()])
      .then(([poDetail, warehouseList]) => {
        if (cancelled) return;
        setPo(poDetail);
        setLines(buildLines(poDetail.items ?? []));
        setWarehouses(warehouseList);
        if (warehouseList.length === 1) setWarehouseId(warehouseList[0].id);
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Gagal memuat data penerimaan");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [poId]);

  const warehouseOptions = useMemo(
    () => warehouses.map((w) => ({ value: w.id, label: w.code ? `${w.name} (${w.code})` : w.name })),
    [warehouses]
  );

  function updateQty(poItemId: string, value: string) {
    setLines((prev) =>
      prev.map((line) => (line.poItemId === poItemId ? { ...line, qtyDiterima: value } : line))
    );
  }

  const totalDiterima = lines.reduce((sum, line) => sum + toQty(line.qtyDiterima), 0);

  async function handleSubmit() {
    if (!warehouseId) {
      toast.error("Pilih gudang penerimaan terlebih dahulu");
      return;
    }

    const items: GeneralGrnItemPayload[] = [];
    for (const line of lines) {
      const qty = toQty(line.qtyDiterima);
      if (qty <= 0) continue;
      if (qty > line.remaining + 0.0001) {
        toast.error(`Qty ${line.nama} melebihi sisa PO (maks ${line.remaining})`);
        return;
      }
      items.push({
        purchase_order_item_id: line.poItemId,
        supply_item_id: line.supplyItemId,
        satuan_id: line.satuanId,
        qty_diterima: qty,
        qty_ditolak: 0,
      });
    }

    if (items.length === 0) {
      toast.error("Isi minimal satu qty diterima");
      return;
    }

    setSubmitting(true);
    try {
      const result = await createGeneralGrn({
        po_id: poId,
        warehouse_id: warehouseId,
        catatan: catatan || undefined,
        items,
      });
      toast.success(`Penerimaan ${result.nomor_grn ?? ""} tercatat`);
      router.push(GENERAL_ROUTES.purchasingReceive);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan penerimaan");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-500">Memuat data penerimaan...</div>;
  }

  if (!po) {
    return <div className="py-16 text-center text-sm text-gray-500">Purchase order tidak ditemukan.</div>;
  }

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title={`Terima Barang — ${po.nomor_po}`}
        description={`Vendor ${po.vendor_name ?? "-"}. Barang operasional dicatat diterima tanpa langkah pengiriman terpisah.`}
        actions={
          <Button variant="outline" onClick={() => router.push(GENERAL_ROUTES.purchasingReceive)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Kembali
          </Button>
        }
      />

      <PurchasingListSection
        icon={PackageCheck}
        title="Item Diterima"
        description="Isi jumlah barang yang benar-benar diterima. Item stok bertambah di fase lanjut; item expense cukup ditandai diterima."
      >
        <div className="space-y-4 px-5 py-4">
          <div className="max-w-md">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Gudang Penerimaan <span className="text-red-500">*</span>
            </label>
            <Combobox
              options={warehouseOptions}
              value={warehouseId}
              onChange={setWarehouseId}
              placeholder="Pilih gudang..."
              className="h-10 text-sm"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Barang</th>
                  <th className="px-4 py-3 text-center font-semibold">Jenis</th>
                  <th className="px-4 py-3 text-right font-semibold">Dipesan</th>
                  <th className="px-4 py-3 text-right font-semibold">Sudah Diterima</th>
                  <th className="px-4 py-3 text-right font-semibold">Sisa</th>
                  <th className="px-4 py-3 text-right font-semibold">Qty Diterima</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((line) => (
                  <tr key={line.poItemId} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{line.nama}</div>
                      <div className="text-xs text-gray-500">{line.kode}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {line.stockable ? (
                        <Badge className="bg-indigo-100 text-indigo-800">
                          <Boxes className="mr-1 h-3 w-3" /> Stok
                        </Badge>
                      ) : (
                        <Badge className="bg-gray-100 text-gray-700">
                          <Receipt className="mr-1 h-3 w-3" /> Expense
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{line.ordered}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{line.received}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{line.remaining}</td>
                    <td className="px-4 py-3 text-right">
                      <Input
                        type="number"
                        min={0}
                        max={line.remaining}
                        step="any"
                        value={line.qtyDiterima}
                        onChange={(e) => updateQty(line.poItemId, e.target.value)}
                        disabled={line.remaining <= 0}
                        className="h-9 w-28 text-right text-sm"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="max-w-md">
            <label className="mb-1 block text-sm font-medium text-gray-700">Catatan</label>
            <Input
              placeholder="Catatan penerimaan (opsional)"
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              className="h-10 text-sm"
            />
          </div>

          <div className="flex items-center justify-between border-t border-gray-100 pt-4">
            <span className="text-sm text-gray-600">
              Total qty diterima: <span className="font-semibold text-gray-900">{totalDiterima}</span>
            </span>
            <Button
              className="purchasing-main-button"
              onClick={handleSubmit}
              disabled={submitting || totalDiterima <= 0}
            >
              <PackageCheck className="mr-2 h-4 w-4" />
              {submitting ? "Menyimpan..." : "Simpan Penerimaan"}
            </Button>
          </div>
        </div>
      </PurchasingListSection>
    </div>
  );
}
