"use client";

import { toast } from "sonner";
import type { PosCartItem } from "@/hooks/use-pos-cart";
import {
  canUseRawBtPrint,
  printBytesViaRawBt,
} from "@/lib/pos/rawbt-print";
import { encodeEscPosLines, formatReceiptRow } from "@/lib/pos/thermal-escpos";
import { printBytesToPairedThermal } from "@/lib/pos/thermal-serial";
import {
  buildReceiptItemLines,
  groupCartItemsByStallName,
  receiptDocumentLabel,
} from "@/lib/pos/receipt-layout";

export interface ReceiptPayload {
  orderId?: string;
  orderNumber?: string;
  checkoutNumber?: string;
  queueNumber?: string | null;
  orderType: string;
  table: string | null;
  items: PosCartItem[];
  notes: string;
  total: number;
  change: number;
  paymentMethod: string;
  customerName?: string;
  discountAmount: number;
  taxAmount: number;
  /** Snapshot charge lines (service / fee / rounding / tax) for receipt */
  chargesBreakdown?: Array<{
    code: string;
    name: string;
    kind: string;
    amount: number;
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
    text: receiptDocumentLabel(payload),
    align: "center",
  });
  lines.push({ text: new Date().toLocaleTimeString("id-ID"), align: "center" });
  if (payload.customerName) {
    lines.push({ text: `Customer: ${payload.customerName}`, align: "center" });
  }
  if (isPreviewBill) {
    lines.push({ text: "PRE-SETTLEMENT - UNPAID", align: "center" });
  }
  lines.push({ text: "--------------------------------", align: "left" });

  lines.push(...buildReceiptItemLines(payload.items));

  if (!isKitchen && !isBar) {
    lines.push({ text: "--------------------------------", align: "left" });
    if (payload.discountAmount > 0) {
      lines.push({
        text: formatReceiptRow("Diskon", `-${formatCurrency(payload.discountAmount)}`),
        align: "left",
      });
    }
    if (payload.chargesBreakdown?.length) {
      for (const line of payload.chargesBreakdown) {
        const amountLabel =
          line.amount < 0 ? `-${formatCurrency(Math.abs(line.amount))}` : formatCurrency(line.amount);
        lines.push({ text: formatReceiptRow(line.name, amountLabel), align: "left" });
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
    lines.push({ text: "--------------------------------", align: "left" });
    lines.push({ text: "GIFT CARD", align: "center" });
    for (const card of payload.giftCards) {
      lines.push({ text: card.code, align: "center" });
      lines.push({ text: `Saldo ${formatCurrency(card.initial_value)}`, align: "center" });
    }
  }

  if (payload.notes) {
    lines.push({ text: "--------------------------------", align: "left" });
    lines.push({ text: `Catatan: ${payload.notes}`, align: "left" });
  }
  lines.push({ text: "--------------------------------", align: "left" });
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

function buildReceiptHtml(payload: ReceiptPayload, label: ThermalPrintLabel): string {
  const {
    queueNumber,
    orderType,
    table,
    items,
    notes,
    total,
    change,
    paymentMethod,
    customerName,
    discountAmount,
    taxAmount,
    chargesBreakdown,
    giftCards,
  } = payload;

  const stallGroups = groupCartItemsByStallName(items);
  const showStallHeaders = stallGroups.length >= 2;
  const itemsHtml = stallGroups
    .map((group) => {
      const header = showStallHeaders
        ? `<tr><td colspan="2" style="text-align:center;font-weight:bold;padding:6px 2px">--- ${group.stallName} ---</td></tr>`
        : "";
      const rows = group.items
        .map(
          (item) => `
    <tr>
      <td style="width:28px;vertical-align:top;font-weight:bold;padding:3px 2px">${item.quantity}x</td>
      <td style="padding:3px 2px">
        <strong>${item.name}</strong>
        ${item.variantName ? `<br><small style="color:#555">${item.variantName}</small>` : ""}
        ${item.modifierNames?.length ? `<br><small style="color:#555">${item.modifierNames.join(", ")}</small>` : ""}
        ${item.notes ? `<br><em style="color:#555">* ${item.notes}</em>` : ""}
      </td>
    </tr>
    <tr><td colspan="2"><div style="border-top:1px dashed #ccc;margin:2px 0"></div></td></tr>
  `
        )
        .join("");
      return `${header}${rows}`;
    })
    .join("");

  const isKitchen = label === "KITCHEN";
  const isBar = label === "BAR";
  const isPreviewBill = label === "PREVIEW_BILL";
  const heading = isPreviewBill ? "PREVIEW BILL" : label;
  const title = isPreviewBill ? "PREVIEW BILL" : label;

  const chargeRowsHtml =
    chargesBreakdown && chargesBreakdown.length > 0
      ? chargesBreakdown
          .map((line) => {
            const amountLabel =
              line.amount < 0
                ? `-${formatCurrency(Math.abs(line.amount))}`
                : formatCurrency(line.amount);
            return `<div class="row"><span>${line.name}</span><span>${amountLabel}</span></div>`;
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
        width: 72mm;
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
        .ticket { width: 72mm; padding: 2mm; }
        @page { margin: 0; size: 72mm auto; }
      }
    </style>
  </head>
  <body>
    <div class="ticket">
    <h1>--- ${heading} ---</h1>
    <div class="big">${orderType.replace(/_/g, "-").toUpperCase()}</div>
    ${table ? `<div class="center">${table}</div>` : ""}
    ${queueNumber ? `<div class="big">ANTRIAN ${queueNumber}</div>` : ""}
    <div class="center">${receiptDocumentLabel(payload)}</div>
    <div class="center">${new Date().toLocaleTimeString("id-ID")}</div>
    ${customerName ? `<div class="center">Customer: ${customerName}</div>` : ""}
    ${isPreviewBill ? `<div class="center">PRE-SETTLEMENT · UNPAID</div>` : ""}
    <div class="divider"></div>

    ${!isKitchen && !isBar ? `
      <table>${itemsHtml}</table>
      <div class="divider"></div>
      ${discountAmount > 0 ? `<div class="row"><span>Diskon</span><span>-${formatCurrency(discountAmount)}</span></div>` : ""}
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
