import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { TransactionReportRow } from "../types";
import {
  formatKitchenStatusLabel,
  formatOrderTypeLabel,
  formatPaymentMethodLabel,
  formatPaymentStatusLabel,
  formatSoldFromLabel,
  formatXenditPaymentLabel,
  formatXenditSettlementNote,
  isPaidPaymentStatus,
  isQrisPaymentMethod,
  resolveXenditExternalId,
} from "../utils/transaction-labels";

type OrderItemDetail = {
  id: string;
  product_name?: string | null;
  product_sku?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  total_amount?: number | string | null;
};

export type TransactionOrderDetail = {
  id: string;
  order_number?: string | null;
  ordered_at?: string | null;
  queue_number?: string | null;
  order_type?: string | null;
  notes?: string | null;
  subtotal?: number | string | null;
  discount_amount?: number | string | null;
  tax_amount?: number | string | null;
  service_charge_amount?: number | string | null;
  total_amount?: number | string | null;
  amount_paid?: number | string | null;
  change_amount?: number | string | null;
  ark_coins_used?: number | string | null;
  payment_method?: string | null;
  payment_method_code?: string | null;
  payment_method_name?: string | null;
  payment_status?: string | null;
  status?: string | null;
  sold_from?: string | null;
  checkout_id?: string | null;
  checkout_number?: string | null;
  xendit_external_id?: string | null;
  xendit_qr_id?: string | null;
  customer?: { name?: string | null } | null;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0);

const formatQty = (value: number) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(value || 0);

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function DetailField({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200/70 bg-card">
      <h3 className="border-b border-gray-200/70 px-3 py-2 text-sm font-semibold text-foreground">
        {title}
      </h3>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function TransactionDetailBody({
  row,
  detail,
  items,
}: {
  row: TransactionReportRow | null;
  detail: TransactionOrderDetail | null;
  items: OrderItemDetail[];
}) {
  const paymentStatus = detail?.payment_status ?? row?.payment_status;
  const kitchenStatus = detail?.status ?? row?.status;
  const paymentMethod = detail?.payment_method || row?.payment_method;
  const paymentMethodLabel = formatPaymentMethodLabel(paymentMethod, {
    code: detail?.payment_method_code || row?.payment_method_code,
    name: detail?.payment_method_name || row?.payment_method_name,
  });
  const paid = isPaidPaymentStatus(paymentStatus, kitchenStatus);
  const showXendit = isQrisPaymentMethod(paymentMethod);
  const externalId = resolveXenditExternalId({
    storedExternalId: detail?.xendit_external_id || row?.xendit_external_id,
  });
  const qrId = detail?.xendit_qr_id || row?.xendit_qr_id || null;

  return (
    <div className="space-y-4">
      <SectionCard title="Transaksi">
        <dl className="grid gap-3 sm:grid-cols-3">
          <DetailField
            label="Nomor order"
            value={detail?.order_number || row?.order_number || row?.id.slice(0, 8) || "—"}
          />
          <DetailField
            label="Waktu"
            value={formatDateTime(detail?.ordered_at ?? row?.ordered_at)}
          />
          <DetailField label="Stall" value={row ? formatStallName(row) : "—"} />
          <DetailField
            label="Tipe"
            value={formatOrderTypeLabel(detail?.order_type)}
          />
          <DetailField label="Antrian" value={detail?.queue_number || "—"} />
          <DetailField
            label="Pelanggan"
            value={detail?.customer?.name?.trim() || "Walk-in"}
          />
          <DetailField
            label="Sumber jual"
            value={formatSoldFromLabel(detail?.sold_from ?? row?.sold_from)}
          />
          <DetailField
            label="Checkout"
            value={detail?.checkout_number || row?.checkout_number || "—"}
          />
          <DetailField
            label="Status dapur"
            value={formatKitchenStatusLabel(kitchenStatus)}
          />
          {detail?.notes ? (
            <DetailField label="Catatan" value={detail.notes} className="sm:col-span-3" />
          ) : null}
        </dl>
      </SectionCard>

      <SectionCard title="Pembayaran">
        <dl className="grid gap-3 sm:grid-cols-3">
          <DetailField
            label="Status"
            value={
              <Badge
                variant="outline"
                className={
                  paid
                    ? "border-emerald-200/80 bg-emerald-50 text-emerald-800"
                    : "border-amber-200/80 bg-amber-50 text-amber-800"
                }
              >
                {formatPaymentStatusLabel(paymentStatus, kitchenStatus)}
              </Badge>
            }
          />
          <DetailField label="Metode" value={paymentMethodLabel} />
          <DetailField
            label="Total"
            value={formatCurrency(toNumber(detail?.total_amount ?? row?.total_amount))}
          />
          <DetailField
            label="Subtotal"
            value={formatCurrency(toNumber(detail?.subtotal))}
          />
          <DetailField
            label="Diskon"
            value={formatCurrency(toNumber(detail?.discount_amount))}
          />
          <DetailField
            label="Pajak"
            value={formatCurrency(toNumber(detail?.tax_amount))}
          />
          <DetailField
            label="Service"
            value={formatCurrency(toNumber(detail?.service_charge_amount))}
          />
          <DetailField
            label="Dibayar"
            value={formatCurrency(toNumber(detail?.amount_paid))}
          />
          <DetailField
            label="Kembalian"
            value={formatCurrency(toNumber(detail?.change_amount))}
          />
          <DetailField
            label="ARK digunakan"
            value={formatCurrency(toNumber(detail?.ark_coins_used ?? row?.ark_coins_used))}
            className="sm:col-span-3"
          />
        </dl>
      </SectionCard>

      {showXendit ? (
        <SectionCard title="Xendit (QRIS)">
          <dl className="grid gap-3 sm:grid-cols-2">
            <DetailField
              label="Status pembayaran"
              value={
                <Badge
                  variant="outline"
                  className={
                    paid
                      ? "border-emerald-200/80 bg-emerald-50 text-emerald-800"
                      : "border-amber-200/80 bg-amber-50 text-amber-800"
                  }
                >
                  {formatXenditPaymentLabel(paymentStatus, kitchenStatus)}
                </Badge>
              }
            />
            <DetailField
              label="Cair ke rekening"
              value={formatXenditSettlementNote()}
            />
            <DetailField
              label="External ID"
              value={
                <span className="break-all font-mono text-xs">
                  {externalId || "Tidak tersimpan"}
                </span>
              }
            />
            <DetailField
              label="QR ID"
              value={
                <span className="break-all font-mono text-xs">
                  {qrId || "Tidak tersimpan"}
                </span>
              }
            />
          </dl>
        </SectionCard>
      ) : null}

      <SectionCard title="Item terjual">
        <div className="overflow-x-auto rounded-lg border border-gray-200/70">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-200/70 bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">Produk</th>
                <th className="px-3 py-2.5 text-left font-semibold">SKU</th>
                <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                <th className="px-3 py-2.5 text-right font-semibold">Harga</th>
                <th className="px-3 py-2.5 text-right font-semibold">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200/70">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    Tidak ada item
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2.5 font-medium text-foreground">
                      {item.product_name || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {item.product_sku || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right">{formatQty(toNumber(item.quantity))}</td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground">
                      {formatCurrency(toNumber(item.unit_price))}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      {formatCurrency(toNumber(item.total_amount))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatStallName(row: Pick<TransactionReportRow, "stall_name" | "stall_code">) {
  const name = row.stall_name?.trim();
  if (name && !UUID_RE.test(name)) return name;
  const code = row.stall_code?.trim();
  if (code && !UUID_RE.test(code)) return code;
  return "—";
}
