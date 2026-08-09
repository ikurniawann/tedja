"use client";

import { toast } from "sonner";
import type { PosCartItem } from "@/hooks/use-pos-cart";
import { encodeEscPosText, formatReceiptRow } from "@/lib/pos/thermal-escpos";
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

function buildReceiptLines(payload: ReceiptPayload, label: ThermalPrintLabel): string[] {
  const isKitchen = label === "KITCHEN";
  const isBar = label === "BAR";
  const isPreviewBill = label === "PREVIEW_BILL";
  const heading = isPreviewBill ? "PREVIEW BILL" : label;
  const lines: string[] = [
    `--- ${heading} ---`,
    payload.orderType.replace(/_/g, "-").toUpperCase(),
  ];
  if (payload.table) lines.push(payload.table);
  if (payload.queueNumber) lines.push(`ANTRIAN ${payload.queueNumber}`);
  lines.push(
    `Order #${(payload.orderNumber || "").slice(-8).toUpperCase() || (payload.orderId || "").slice(-8).toUpperCase()}`
  );
  lines.push(new Date().toLocaleTimeString("id-ID"));
  if (payload.customerName) lines.push(`Customer: ${payload.customerName}`);
  if (isPreviewBill) lines.push("PRE-SETTLEMENT - UNPAID");
  lines.push("--------------------------------");

  for (const item of payload.items) {
    lines.push(`${item.quantity}x ${item.name}`);
    if (item.variantName) lines.push(`  ${item.variantName}`);
    if (item.modifierNames?.length) lines.push(`  ${item.modifierNames.join(", ")}`);
    if (item.notes) lines.push(`  * ${item.notes}`);
  }

  if (!isKitchen && !isBar) {
    lines.push("--------------------------------");
    if (payload.discountAmount > 0) {
      lines.push(formatReceiptRow("Diskon", `-${formatCurrency(payload.discountAmount)}`));
    }
    if (payload.chargesBreakdown?.length) {
      for (const line of payload.chargesBreakdown) {
        const amountLabel =
          line.amount < 0 ? `-${formatCurrency(Math.abs(line.amount))}` : formatCurrency(line.amount);
        lines.push(formatReceiptRow(line.name, amountLabel));
      }
    } else if (payload.taxAmount > 0) {
      lines.push(formatReceiptRow("PPN", formatCurrency(payload.taxAmount)));
    }
    lines.push(formatReceiptRow("TOTAL", formatCurrency(payload.total)));
    if (isPreviewBill) {
      lines.push(formatReceiptRow("Status", "UNPAID"));
    } else {
      lines.push(
        formatReceiptRow(
          `Bayar (${payload.paymentMethod.toUpperCase()})`,
          formatCurrency(payload.total + payload.change)
        )
      );
      if (payload.change > 0) {
        lines.push(formatReceiptRow("Kembalian", formatCurrency(payload.change)));
      }
    }
  }

  if (!isKitchen && !isBar && !isPreviewBill && payload.giftCards?.length) {
    lines.push("--------------------------------");
    lines.push("GIFT CARD");
    for (const card of payload.giftCards) {
      lines.push(card.code);
      lines.push(`Saldo ${formatCurrency(card.initial_value)}`);
    }
  }

  if (payload.notes) {
    lines.push("--------------------------------");
    lines.push(`Catatan: ${payload.notes}`);
  }
  lines.push("--------------------------------");
  lines.push(`--- ${heading} COPY ---`);
  return lines;
}

function printViaHiddenIframe(html: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  if (!win) {
    iframe.remove();
    toast.error("Gagal menyiapkan print. Izinkan popup/iframe di browser.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  const cleanup = () => iframe.remove();
  win.addEventListener("afterprint", cleanup);
  window.setTimeout(() => {
    win.focus();
    win.print();
    window.setTimeout(cleanup, 2000);
  }, 250);
}

export async function printThermalReceipt(payload: ReceiptPayload, label: ThermalPrintLabel) {
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
    discountAmount,
    taxAmount,
    chargesBreakdown,
    giftCards,
  } = payload;

  try {
    const sent = await printBytesToPairedThermal(encodeEscPosText(buildReceiptLines(payload, label)));
    if (sent) {
      toast.success("Struk terkirim ke printer (tanpa preview)");
      return;
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Print langsung gagal, pakai dialog browser");
  }

  const itemsHtml = items
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

  printViaHiddenIframe(`<!DOCTYPE html>
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
        background: #f3f4f6;
        padding: 24px 16px;
        display: flex;
        justify-content: center;
      }
      .ticket {
        width: 72mm;
        max-width: 100%;
        background: #fff;
        padding: 6mm 4mm;
        box-shadow: 0 8px 24px rgba(0,0,0,0.08);
      }
      h1 { font-size:15px; text-align:center; letter-spacing:2px; margin-bottom:4px; }
      .center { text-align:center; }
      .divider { border-top:1px dashed #000; margin:6px 0; }
      .big { font-size:16px; font-weight:bold; text-align:center; }
      .row { display:flex; justify-content:space-between; gap:8px; margin:2px 0; }
      .row.total { font-weight:bold; font-size:14px; margin-top:4px; }
      table { width:100%; border-collapse:collapse; }
      @media print {
        body { background: #fff; padding: 0; display: block; }
        .ticket { width: 72mm; box-shadow: none; padding: 6mm 4mm; }
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
    <div class="center">Order #${(orderNumber || "").slice(-8).toUpperCase() || (orderId || "").slice(-8).toUpperCase()}</div>
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
      // Kode gift card hanya di struk pelanggan — bukan copy dapur/bar.
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
</html>`);
}
