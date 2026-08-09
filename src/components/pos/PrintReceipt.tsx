"use client";

import type { PosCartItem } from "@/hooks/use-pos-cart";

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

export function printThermalReceipt(payload: ReceiptPayload, label: ThermalPrintLabel) {
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

  // Wider popup so the browser print dialog has room for settings + preview.
  // Receipt content stays 72mm for thermal printers.
  const popupWidth = Math.min(720, Math.max(480, window.screen.availWidth - 80));
  const popupHeight = Math.min(900, Math.max(640, window.screen.availHeight - 80));
  const left = Math.max(0, Math.round((window.screen.availWidth - popupWidth) / 2));
  const top = Math.max(0, Math.round((window.screen.availHeight - popupHeight) / 2));
  const win = window.open(
    "",
    "_blank",
    `width=${popupWidth},height=${popupHeight},left=${left},top=${top},scrollbars=yes,resizable=yes`
  );
  if (!win) {
    alert("Izinkan popup untuk print.");
    return;
  }

  const formatCurrency = (n: number) =>
    "Rp " + new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0 }).format(Math.abs(n));

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

  win.document.write(`<!DOCTYPE html>
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

  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.close();
  }, 400);
}
