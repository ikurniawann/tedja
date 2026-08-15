"use client";

import { toast } from "sonner";
import type { PosCartItem } from "@/hooks/use-pos-cart";
import {
  canUseRawBtPrint,
  printBytesViaRawBt,
} from "@/lib/pos/rawbt-print";
import { encodeEscPosLines, formatReceiptRow, RECEIPT_DIVIDER } from "@/lib/pos/thermal-escpos";
import { printBytesToPairedThermal } from "@/lib/pos/thermal-serial";

export interface ReceiptPayload {
  orderId?: string;
  orderNumber?: string;
  queueNumber?: string | null;
  orderType: string;
  table: string | null;
  items: PosCartItem[];
  notes: string;
  total: number;
  change: number;
  paymentMethod: string;
  customerName?: string;
  /** Stall asal order — dicetak di header semua copy (dapur perlu tahu asal). */
  stallName?: string | null;
  /** Σ harga item SEBELUM diskon apa pun; bila absen dihitung dari items. */
  subtotal?: number;
  discountAmount: number;
  /**
   * Rincian diskon per jenis (item/member/promo/manual) utk struk customer.
   * Bila absen, fallback satu baris "Diskon" dari discountAmount (payload lama).
   */
  discountLines?: Array<{ label: string; amount: number }>;
  taxAmount: number;
  /** Snapshot charge lines (service / fee / rounding / tax) for receipt */
  chargesBreakdown?: Array<{
    code: string;
    name: string;
    kind: string;
    amount: number;
    rate?: number;
    calc_method?: string;
  }>;
  /**
   * EPIC-034 Fase B — kartu yang terbit dari transaksi ini. Kode dicetak di
   * struk pelanggan (keputusan owner: struk adalah jalur utama, WA tambahan).
   * Tidak pernah dicetak di copy dapur/bar — kode = uang.
   */
  giftCards?: Array<{ code: string; initial_value: number; expires_at: string | null }>;
}

export type ThermalPrintLabel = "KITCHEN" | "BAR" | "CUSTOMER" | "PREVIEW_BILL";

function formatCurrency(n: number) {
  return "Rp " + new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0 }).format(Math.abs(n));
}

/** "Tax" + rate percent → "Tax (10%)" supaya pembeli tahu tarifnya. */
function chargeLabel(line: { name: string; rate?: number; calc_method?: string }) {
  return line.calc_method === "percent" && Number(line.rate) > 0
    ? `${line.name} (${line.rate}%)`
    : line.name;
}

function itemsSubtotal(items: PosCartItem[]) {
  return items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
}

export function buildReceiptLines(payload: ReceiptPayload, label: ThermalPrintLabel): string[] {
  return buildReceiptEscPosLayout(payload, label).map((line) => line.text);
}

/** Layout matching HTML receipt: centered header / footer, left items + totals. */
export function buildReceiptEscPosLayout(
  payload: ReceiptPayload,
  label: ThermalPrintLabel,
): Array<{ text: string; align: "left" | "center" }> {
  const isKitchen = label === "KITCHEN";
  const isBar = label === "BAR";
  const isPreviewBill = label === "PREVIEW_BILL";
  const heading = isPreviewBill ? "PREVIEW BILL" : label;
  const lines: Array<{ text: string; align: "left" | "center" }> = [
    { text: `--- ${heading} ---`, align: "center" },
    { text: payload.orderType.replace(/_/g, "-").toUpperCase(), align: "center" },
  ];
  if (payload.table) lines.push({ text: payload.table, align: "center" });
  if (payload.queueNumber) {
    lines.push({ text: `ANTRIAN ${payload.queueNumber}`, align: "center" });
  }
  lines.push({
    text: `Order #${(payload.orderNumber || "").slice(-8).toUpperCase() || (payload.orderId || "").slice(-8).toUpperCase()}`,
    align: "center",
  });
  lines.push({ text: new Date().toLocaleTimeString("id-ID"), align: "center" });
  if (payload.customerName) {
    lines.push({ text: `Customer: ${payload.customerName}`, align: "center" });
  }
  if (payload.stallName) {
    lines.push({ text: `Stall: ${payload.stallName}`, align: "center" });
  }
  if (isPreviewBill) {
    lines.push({ text: "PRE-SETTLEMENT - UNPAID", align: "center" });
  }
  lines.push({ text: RECEIPT_DIVIDER, align: "left" });

  const withPrices = !isKitchen && !isBar;
  for (const item of payload.items) {
    const qty = Number(item.quantity) || 0;
    if (withPrices) {
      lines.push({
        text: formatReceiptRow(
          `${item.quantity}x ${item.name}`,
          formatCurrency((Number(item.price) || 0) * qty),
        ),
        align: "left",
      });
      if (qty > 1) {
        lines.push({ text: `  @ ${formatCurrency(Number(item.price) || 0)}`, align: "left" });
      }
    } else {
      lines.push({ text: `${item.quantity}x ${item.name}`, align: "left" });
    }
    if (item.stallName && item.stallName !== payload.stallName) {
      lines.push({ text: `  [${item.stallName}]`, align: "left" });
    }
    if (item.variantName) lines.push({ text: `  ${item.variantName}`, align: "left" });
    if (item.modifierNames?.length) {
      lines.push({ text: `  ${item.modifierNames.join(", ")}`, align: "left" });
    }
    if (item.notes) lines.push({ text: `  * ${item.notes}`, align: "left" });
  }

  if (!isKitchen && !isBar) {
    lines.push({ text: RECEIPT_DIVIDER, align: "left" });
    const subtotal = payload.subtotal ?? itemsSubtotal(payload.items);
    lines.push({ text: formatReceiptRow("Subtotal", formatCurrency(subtotal)), align: "left" });
    const discountLines = (payload.discountLines ?? []).filter((d) => d.amount > 0);
    if (discountLines.length > 0) {
      for (const d of discountLines) {
        lines.push({
          text: formatReceiptRow(d.label, `-${formatCurrency(d.amount)}`),
          align: "left",
        });
      }
      if (discountLines.length > 1) {
        lines.push({
          text: formatReceiptRow("Total Diskon", `-${formatCurrency(payload.discountAmount)}`),
          align: "left",
        });
      }
    } else if (payload.discountAmount > 0) {
      lines.push({
        text: formatReceiptRow("Diskon", `-${formatCurrency(payload.discountAmount)}`),
        align: "left",
      });
    }
    if (payload.chargesBreakdown?.length) {
      for (const line of payload.chargesBreakdown) {
        const amountLabel =
          line.amount < 0 ? `-${formatCurrency(Math.abs(line.amount))}` : formatCurrency(line.amount);
        lines.push({ text: formatReceiptRow(chargeLabel(line), amountLabel), align: "left" });
      }
    } else if (payload.taxAmount > 0) {
      lines.push({
        text: formatReceiptRow("PPN", formatCurrency(payload.taxAmount)),
        align: "left",
      });
    }
    lines.push({
      text: formatReceiptRow("TOTAL", formatCurrency(payload.total)),
      align: "left",
    });
    if (isPreviewBill) {
      lines.push({ text: formatReceiptRow("Status", "UNPAID"), align: "left" });
    } else {
      lines.push({
        text: formatReceiptRow(
          `Bayar (${payload.paymentMethod.toUpperCase()})`,
          formatCurrency(payload.total + payload.change),
        ),
        align: "left",
      });
      if (payload.change > 0) {
        lines.push({
          text: formatReceiptRow("Kembalian", formatCurrency(payload.change)),
          align: "left",
        });
      }
    }
  }

  if (!isKitchen && !isBar && !isPreviewBill && payload.giftCards?.length) {
    lines.push({ text: RECEIPT_DIVIDER, align: "left" });
    lines.push({ text: "GIFT CARD", align: "center" });
    for (const card of payload.giftCards) {
      lines.push({ text: card.code, align: "center" });
      lines.push({ text: `Saldo ${formatCurrency(card.initial_value)}`, align: "center" });
    }
  }

  if (payload.notes) {
    lines.push({ text: RECEIPT_DIVIDER, align: "left" });
    lines.push({ text: `Catatan: ${payload.notes}`, align: "left" });
  }
  lines.push({ text: RECEIPT_DIVIDER, align: "left" });
  lines.push({ text: `--- ${heading} COPY ---`, align: "center" });
  return lines;
}

/** ESC/POS bytes for RawBT — same layout as desktop thermal / Chrome tablet HTML. */
export function buildReceiptEscPosBytes(
  payload: ReceiptPayload,
  label: ThermalPrintLabel,
): Uint8Array {
  return encodeEscPosLines(buildReceiptEscPosLayout(payload, label));
}

/**
 * Visible receipt tab — Android Chrome often captures the parent page when
 * printing from a 0×0 hidden iframe (cashier "screenshot dialog" bug).
 * Do not close until afterprint; early close breaks RawBT PDF handoff.
 */
function printViaPopupWindow(html: string) {
  const win = window.open("", "_blank");
  if (!win) {
    toast.error("Gagal membuka jendela print. Izinkan popup di browser.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    try {
      win.close();
    } catch {
      // ignore
    }
  };

  win.addEventListener("afterprint", cleanup);
  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
      return;
    }
    // Safety net if afterprint never fires (some Android browsers)
    window.setTimeout(cleanup, 60_000);
  }, 300);
}

export function buildReceiptHtml(payload: ReceiptPayload, label: ThermalPrintLabel): string {
  const {
    orderId,
    orderNumber,
    queueNumber,
    orderType,
    table,
    items,
    notes,
    total,
    change,
    paymentMethod,
    customerName,
    stallName,
    discountAmount,
    taxAmount,
    chargesBreakdown,
    giftCards,
  } = payload;

  const isKitchenCopy = label === "KITCHEN" || label === "BAR";
  const itemsHtml = items
    .map(
      (item) => {
        const qty = Number(item.quantity) || 0;
        const lineTotal = (Number(item.price) || 0) * qty;
        return `
    <tr>
      <td style="width:28px;vertical-align:top;font-weight:bold;padding:3px 2px">${item.quantity}x</td>
      <td style="padding:3px 2px">
        <strong>${item.name}</strong>
        ${item.stallName && item.stallName !== stallName ? `<br><small style="color:#0369a1;font-weight:600">[${item.stallName}]</small>` : ""}
        ${!isKitchenCopy && qty > 1 ? `<br><small style="color:#555">@ ${formatCurrency(Number(item.price) || 0)}</small>` : ""}
        ${item.variantName ? `<br><small style="color:#555">${item.variantName}</small>` : ""}
        ${item.modifierNames?.length ? `<br><small style="color:#555">${item.modifierNames.join(", ")}</small>` : ""}
        ${item.notes ? `<br><em style="color:#555">* ${item.notes}</em>` : ""}
      </td>
      ${!isKitchenCopy ? `<td style="vertical-align:top;text-align:right;white-space:nowrap;padding:3px 2px">${formatCurrency(lineTotal)}</td>` : ""}
    </tr>
    <tr><td colspan="${isKitchenCopy ? 2 : 3}"><div style="border-top:1px dashed #ccc;margin:2px 0"></div></td></tr>
  `;
      }
    )
    .join("");

  const isKitchen = label === "KITCHEN";
  const isBar = label === "BAR";
  const isPreviewBill = label === "PREVIEW_BILL";
  const heading = isPreviewBill ? "PREVIEW BILL" : label;
  const title = isPreviewBill ? "PREVIEW BILL" : label;

  const receiptSubtotal = payload.subtotal ?? itemsSubtotal(items);
  const visibleDiscountLines = (payload.discountLines ?? []).filter((d) => d.amount > 0);
  const discountRowsHtml =
    visibleDiscountLines.length > 0
      ? visibleDiscountLines
          .map((d) => `<div class="row"><span>${d.label}</span><span>-${formatCurrency(d.amount)}</span></div>`)
          .join("") +
        (visibleDiscountLines.length > 1
          ? `<div class="row"><span>Total Diskon</span><span>-${formatCurrency(discountAmount)}</span></div>`
          : "")
      : discountAmount > 0
        ? `<div class="row"><span>Diskon</span><span>-${formatCurrency(discountAmount)}</span></div>`
        : "";

  const chargeRowsHtml =
    chargesBreakdown && chargesBreakdown.length > 0
      ? chargesBreakdown
          .map((line) => {
            const amountLabel =
              line.amount < 0
                ? `-${formatCurrency(Math.abs(line.amount))}`
                : formatCurrency(line.amount);
            return `<div class="row"><span>${chargeLabel(line)}</span><span>${amountLabel}</span></div>`;
          })
          .join("")
      : taxAmount > 0
        ? `<div class="row"><span>PPN</span><span>${formatCurrency(taxAmount)}</span></div>`
        : "";

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      html, body { min-height: 100%; }
      body {
        font-family: 'Courier New', monospace;
        font-size: 12px;
        background: #fff;
        padding: 8px;
      }
      .ticket {
        width: 76mm; /* kertas 80mm, area cetak efektif */
        max-width: 100%;
        background: #fff;
        padding: 4mm 2mm;
      }
      h1 { font-size:15px; text-align:center; letter-spacing:2px; margin-bottom:4px; }
      .center { text-align:center; }
      .divider { border-top:1px dashed #000; margin:6px 0; }
      .big { font-size:16px; font-weight:bold; text-align:center; }
      .row { display:flex; justify-content:space-between; gap:8px; margin:2px 0; }
      .row.total { font-weight:bold; font-size:14px; margin-top:4px; }
      table { width:100%; border-collapse:collapse; }
      @media print {
        body { background: #fff; padding: 0; }
        .ticket { width: 76mm; padding: 2mm; }
        @page { margin: 0; size: 80mm auto; }
      }
    </style>
  </head>
  <body>
    <div class="ticket">
    <h1>--- ${heading} ---</h1>
    <div class="big">${orderType.replace(/_/g, "-").toUpperCase()}</div>
    ${table ? `<div class="center">${table}</div>` : ""}
    ${queueNumber ? `<div class="big">ANTRIAN ${queueNumber}</div>` : ""}
    <div class="center">Order #${(orderNumber || "").slice(-8).toUpperCase() || (orderId || "").slice(-8).toUpperCase()}</div>
    <div class="center">${new Date().toLocaleTimeString("id-ID")}</div>
    ${customerName ? `<div class="center">Customer: ${customerName}</div>` : ""}
    ${stallName ? `<div class="center">Stall: ${stallName}</div>` : ""}
    ${isPreviewBill ? `<div class="center">PRE-SETTLEMENT · UNPAID</div>` : ""}
    <div class="divider"></div>

    ${!isKitchen && !isBar ? `
      <table>${itemsHtml}</table>
      <div class="divider"></div>
      <div class="row"><span>Subtotal</span><span>${formatCurrency(receiptSubtotal)}</span></div>
      ${discountRowsHtml}
      ${chargeRowsHtml}
      <div class="row total"><span>TOTAL</span><span>${formatCurrency(total)}</span></div>
      ${
        isPreviewBill
          ? `<div class="row"><span>Status</span><span>UNPAID</span></div>`
          : `<div class="row"><span>Bayar (${paymentMethod.toUpperCase()})</span><span>${formatCurrency(total + change)}</span></div>
      ${change > 0 ? `<div class="row"><span>Kembalian</span><span>${formatCurrency(change)}</span></div>` : ""}`
      }
    ` : `
      <table>${itemsHtml}</table>
    `}

    ${
      !isKitchen && !isBar && !isPreviewBill && giftCards && giftCards.length > 0
        ? `<div class="divider"></div>
    <div class="center"><strong>GIFT CARD</strong></div>
    ${giftCards
      .map(
        (card) => `<div class="center" style="margin:4px 0">
      <div style="font-size:15px;font-weight:700;letter-spacing:2px">${card.code}</div>
      <div>Saldo ${formatCurrency(card.initial_value)}</div>
      <div style="font-size:11px">${
        card.expires_at
          ? `Berlaku s/d ${new Date(card.expires_at).toLocaleDateString("id-ID")}`
          : "Tanpa batas waktu"
      }</div>
    </div>`
      )
      .join("")}
    <div class="center" style="font-size:11px">Simpan struk ini — kode berlaku sebagai saldo.</div>`
        : ""
    }

    ${notes ? `<div class="divider"></div>
    <div><strong>Catatan:</strong> ${notes}</div>` : ""}
    <div class="divider"></div>
    <div class="center">--- ${heading} COPY ---</div>
    </div>
  </body>
</html>`;
}

export async function printThermalReceipt(payload: ReceiptPayload, label: ThermalPrintLabel) {
  const escPos = buildReceiptEscPosBytes(payload, label);

  // 1) Android Chrome → RawBT ESC/POS intent
  if (canUseRawBtPrint()) {
    if (printBytesViaRawBt(escPos)) {
      toast.success("Print dikirim ke RawBT");
      return;
    }
  }

  // 2) Desktop / paired Web Serial thermal
  try {
    const sent = await printBytesToPairedThermal(escPos);
    if (sent) {
      toast.success("Print");
      return;
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Print langsung gagal, coba jalur lain");
  }

  // 3) Browser print dialog
  printViaPopupWindow(buildReceiptHtml(payload, label));
}
